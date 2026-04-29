import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { API_DEFINITIONS, API_PATHS } from "../src/api/apiDefinitions.js";
import {
  createApp,
  createCorsMiddleware,
  createGetRemoteTaskResultHandler,
  createRunRemoteTaskHandler,
} from "../src/api/app.js";
import { createRemoteTaskRegistry } from "../src/api/remoteTaskRegistry.js";
import {
  acceptRemoteEvaluationTask,
  executeAcceptedRemoteEvaluationTask,
  prepareRemoteEvaluationTask,
  runRemoteEvaluationTask,
} from "../src/service.js";
import type { LoadedRubricSnapshot } from "../src/types.js";
import type { OpencodeRunner } from "../src/workflow/scoreWorkflow.js";

function createResponse() {
  const responseState: { statusCode: number; body?: Record<string, unknown> } = {
    statusCode: 200,
  };
  const response = {
    status(code: number) {
      responseState.statusCode = code;
      return response;
    },
    json(body: Record<string, unknown>) {
      responseState.body = body;
      return response;
    },
  };
  return { response, responseState };
}

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-network-execution-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function createManifest(content: string): { files: Array<{ path: string; content: string }> } {
  return {
    files: [{ path: "entry/src/main/ets/pages/Index.ets", content }],
  };
}

function createResultRequest(taskId: number, token?: string) {
  return {
    params: { taskId: String(taskId) },
    header(name: string) {
      return name.toLowerCase() === "token" ? token : undefined;
    },
  };
}

function createStoredResultJson(totalScore = 88): Record<string, unknown> {
  return {
    basic_info: { task_type: "continuation" },
    overall_conclusion: {
      total_score: totalScore,
      hard_gate_triggered: false,
      summary: "测试结果摘要",
    },
    dimension_results: [],
    rule_violations: [],
    bound_rule_packs: [],
    risks: [],
    strengths: [],
    main_issues: [],
    human_review_items: [],
    final_recommendation: "建议通过",
    rule_audit_results: [],
    case_rule_results: [],
    report_meta: {
      report_file_name: "report.html",
      result_json_file_name: "result.json",
      unit_name: "remote-case",
      generated_at: "2026-04-28T10:20:30.000Z",
    },
  };
}

function assertRemoteCallbackPayloadShape(body: Record<string, unknown>) {
  assert.equal("body" in body, false, "callback payload must not be wrapped in a body field");
  const allowedKeys = new Set([
    "success",
    "taskId",
    "status",
    "totalScore",
    "maxScore",
    "resultData",
    "errorMessage",
  ]);
  for (const key of Object.keys(body)) {
    assert.equal(allowedKeys.has(key), true, `unexpected callback payload key: ${key}`);
  }
}

function assertCompletedCallbackSummary(
  body: Record<string, unknown>,
  resultJson: Record<string, unknown>,
) {
  const resultData = body.resultData as Record<string, unknown>;
  const overallConclusion = resultJson.overall_conclusion as Record<string, unknown>;
  assert.equal(body.success, true);
  assert.equal(body.totalScore, overallConclusion.total_score);
  assert.equal(body.maxScore, overallConclusion.max_score ?? 100);
  assert.deepEqual(resultData, {
    basic_info: resultJson.basic_info,
    overall_conclusion: resultJson.overall_conclusion,
  });
  assert.equal("dimension_results" in resultData, false);
  assert.equal("rule_violations" in resultData, false);
  assert.equal("rule_audit_results" in resultData, false);
}

async function waitForAssertion(assertion: () => Promise<void>, attempts = 20): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function parsePromptPayload<T>(prompt: string, marker: string): T {
  const index = prompt.lastIndexOf(`${marker}:\n`);
  if (index < 0) {
    throw new Error(`missing prompt marker ${marker}`);
  }
  return JSON.parse(prompt.slice(index + marker.length + 2)) as T;
}

function buildRubricFinalAnswer(rubricSnapshot: LoadedRubricSnapshot): Record<string, unknown> {
  return {
    summary: {
      overall_assessment: "测试环境通过 opencode mock 完成评分。",
      overall_confidence: "medium",
    },
    item_scores: rubricSnapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => ({
        dimension_name: dimension.name,
        item_name: item.name,
        score: item.scoring_bands[0]?.score ?? item.weight,
        max_score: item.weight,
        matched_band_score: item.scoring_bands[0]?.score ?? item.weight,
        rationale: "测试 mock 按最高档返回，验证远端执行链路。",
        evidence_used: ["generated/entry/src/main/ets/pages/Index.ets"],
        confidence: "medium",
        review_required: false,
      })),
    ),
    hard_gate_candidates: rubricSnapshot.hard_gates.map((gate) => ({
      gate_id: gate.id,
      triggered: false,
      reason: "测试 mock 未触发硬门槛。",
      confidence: "medium",
    })),
    risks: [],
    strengths: ["测试 mock 覆盖远端评分执行链路"],
    main_issues: [],
  };
}

function createOpencodeRunnerMock(): OpencodeRunner {
  return {
    async runPrompt(request) {
      if (request.requestTag.startsWith("task-understanding-")) {
        return {
          requestTag: request.requestTag,
          rawText: JSON.stringify({
            explicitConstraints: ["远端任务需要实现登录页"],
            contextualConstraints: ["保持工程结构"],
            implicitConstraints: ["基于 patch 评估"],
            classificationHints: ["continuation", "has_patch"],
          }),
          rawEvents: "",
          elapsedMs: 1,
        };
      }

      if (request.requestTag.startsWith("rubric-scoring-")) {
        const payload = parsePromptPayload<{ rubric_summary: LoadedRubricSnapshot }>(
          request.prompt,
          "scoring_payload",
        );
        return {
          requestTag: request.requestTag,
          rawText: JSON.stringify(buildRubricFinalAnswer(payload.rubric_summary)),
          rawEvents: "",
          elapsedMs: 1,
        };
      }

      if (request.requestTag.startsWith("rule-assessment-")) {
        const payload = parsePromptPayload<{
          assisted_rule_candidates: Array<{ rule_id: string }>;
        }>(request.prompt, "bootstrap_payload");
        return {
          requestTag: request.requestTag,
          rawText: JSON.stringify({
            summary: {
              assistant_scope: "测试环境通过 opencode mock 完成规则判定。",
              overall_confidence: "medium",
            },
            rule_assessments: payload.assisted_rule_candidates.map((candidate) => ({
              rule_id: candidate.rule_id,
              decision: "uncertain",
              confidence: "low",
              reason: "测试 mock 不读取真实上下文，交由人工复核。",
              evidence_used: [],
              needs_human_review: true,
            })),
          }),
          rawEvents: "",
          elapsedMs: 1,
        };
      }

      throw new Error(`unexpected opencode requestTag=${request.requestTag}`);
    },
  };
}

test("API definitions include the remote task result endpoint", () => {
  assert.equal(API_PATHS.remoteTaskResult, "/score/remote-tasks/:taskId/result");
  assert.ok(
    API_DEFINITIONS.some(
      (definition) =>
        definition.method === "GET" && definition.path === "/score/remote-tasks/:taskId/result",
    ),
  );
});

test("API definitions omit the deprecated local score endpoint", () => {
  assert.equal("scoreRun" in API_PATHS, false);
  assert.equal(
    API_DEFINITIONS.some((definition) => definition.path === "/score/run"),
    false,
  );
});

test("API definitions include unified request and response schemas", () => {
  const runRemoteTask = API_DEFINITIONS.find(
    (definition) => definition.method === "POST" && definition.path === API_PATHS.runRemoteTask,
  ) as Record<string, unknown> | undefined;
  const runRemoteTaskRequest = runRemoteTask?.request as Record<string, unknown> | undefined;
  const runRemoteTaskBody = runRemoteTaskRequest?.body as Record<string, unknown> | undefined;
  const runRemoteTaskProperties = runRemoteTaskBody?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;

  assert.equal(runRemoteTaskProperties?.taskId?.type, "number");
  assert.equal(runRemoteTaskProperties?.testCase?.required, true);
  assert.equal(runRemoteTaskProperties?.executionResult?.required, true);
  assert.equal(runRemoteTaskProperties?.token?.required, false);
  assert.equal(runRemoteTaskProperties?.callback?.type, "string");

  const runRemoteTaskResponses = runRemoteTask?.responses as
    | Array<Record<string, unknown>>
    | undefined;
  const runRemoteTaskSuccessBody = runRemoteTaskResponses?.find(
    (response) => response.status === 200,
  )?.body as Record<string, unknown> | undefined;
  const runRemoteTaskSuccessProperties = runRemoteTaskSuccessBody?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  assert.equal(runRemoteTaskSuccessProperties?.success?.type, "boolean");
  assert.equal(runRemoteTaskSuccessProperties?.taskId?.type, "number");
  assert.equal(runRemoteTaskSuccessProperties?.message?.type, "string");

  const remoteTaskResult = API_DEFINITIONS.find(
    (definition) => definition.method === "GET" && definition.path === API_PATHS.remoteTaskResult,
  ) as Record<string, unknown> | undefined;
  const remoteTaskResultRequest = remoteTaskResult?.request as Record<string, unknown> | undefined;
  const remoteTaskResultPathParams = remoteTaskResultRequest?.pathParams as
    | Record<string, Record<string, unknown>>
    | undefined;
  assert.equal("headers" in (remoteTaskResultRequest ?? {}), false);
  assert.equal(remoteTaskResultPathParams?.taskId?.type, "number");

  const runRemoteTaskCallbacks = runRemoteTask?.callbacks as
    | Array<Record<string, unknown>>
    | undefined;
  const remoteTaskCallback = runRemoteTaskCallbacks?.find(
    (callback) => callback.name === "remoteTaskCallback",
  );
  const remoteTaskCallbackBody = remoteTaskCallback?.body as Record<string, unknown> | undefined;
  const remoteTaskCallbackProperties = remoteTaskCallbackBody?.properties as
    | Record<string, Record<string, unknown>>
    | undefined;
  assert.equal(remoteTaskCallback?.method, "POST");
  assert.equal("headers" in (remoteTaskCallback ?? {}), false);
  assert.equal(remoteTaskCallbackProperties?.taskId?.type, "number");
  assert.equal(remoteTaskCallbackProperties?.status?.type, "enum");
  assert.deepEqual(remoteTaskCallbackProperties?.status?.values, [
    "pending",
    "running",
    "completed",
    "failed",
  ]);
  assert.equal(remoteTaskCallbackProperties?.success?.required, false);
  assert.equal(remoteTaskCallbackProperties?.totalScore?.required, false);
  assert.equal(remoteTaskCallbackProperties?.maxScore?.required, false);
  assert.equal(remoteTaskCallbackProperties?.resultData?.type, "object");
});

test("createGetRemoteTaskResultHandler returns completed resultData without token", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const caseDir = path.join(localCaseRoot, "remote-case-1");
  const resultJson = createStoredResultJson(91);
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "outputs", "result.json"), JSON.stringify(resultJson));

  const registry = createRemoteTaskRegistry(localCaseRoot);
  await registry.upsert({
    taskId: 701,
    status: "completed",
    caseDir,
    token: "remote-token",
    testCaseId: 1701,
  });
  const handler = createGetRemoteTaskResultHandler(registry);
  const { response, responseState } = createResponse();

  await handler(createResultRequest(701) as never, response as never);

  assert.equal(responseState.statusCode, 200);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 701);
  assert.equal(responseState.body?.status, "completed");
  assert.deepEqual(responseState.body?.resultData, resultJson);
  assert.equal(
    "executionLog" in (responseState.body?.resultData as Record<string, unknown>),
    false,
  );
});

test("createGetRemoteTaskResultHandler ignores invalid token", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const caseDir = path.join(localCaseRoot, "remote-case-unauthorized");
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "outputs", "result.json"),
    JSON.stringify(createStoredResultJson()),
  );

  const registry = createRemoteTaskRegistry(localCaseRoot);
  await registry.upsert({
    taskId: 702,
    status: "completed",
    caseDir,
    token: "remote-token",
    testCaseId: 1702,
  });
  const handler = createGetRemoteTaskResultHandler(registry);
  const { response, responseState } = createResponse();

  await handler(createResultRequest(702, "wrong-token") as never, response as never);

  assert.equal(responseState.statusCode, 200);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 702);
});

test("createGetRemoteTaskResultHandler reports running task as result unavailable", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const registry = createRemoteTaskRegistry(localCaseRoot);
  await registry.upsert({
    taskId: 703,
    status: "running",
    caseDir: path.join(localCaseRoot, "remote-case-running"),
    token: "remote-token",
    testCaseId: 1703,
  });
  const handler = createGetRemoteTaskResultHandler(registry);
  const { response, responseState } = createResponse();

  await handler(createResultRequest(703) as never, response as never);

  assert.equal(responseState.statusCode, 409);
  assert.equal(responseState.body?.success, false);
  assert.equal(responseState.body?.taskId, 703);
  assert.equal(responseState.body?.status, "running");
  assert.equal(responseState.body?.message, "Result is not available yet");
});

test("createGetRemoteTaskResultHandler reports unknown task", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const registry = createRemoteTaskRegistry(localCaseRoot);
  const handler = createGetRemoteTaskResultHandler(registry);
  const { response, responseState } = createResponse();

  await handler(createResultRequest(704, "remote-token") as never, response as never);

  assert.equal(responseState.statusCode, 404);
  assert.equal(responseState.body?.success, false);
  assert.equal(responseState.body?.taskId, 704);
  assert.equal(responseState.body?.message, "Remote task not found");
});

test("remote task registry reloads persisted records after restart", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const caseDir = path.join(localCaseRoot, "remote-case-persisted");
  const resultJson = createStoredResultJson(77);
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "outputs", "result.json"), JSON.stringify(resultJson));

  const firstRegistry = createRemoteTaskRegistry(localCaseRoot);
  await firstRegistry.upsert({
    taskId: 705,
    status: "completed",
    caseDir,
    token: "remote-token",
    testCaseId: 1705,
  });

  const secondRegistry = createRemoteTaskRegistry(localCaseRoot);
  const handler = createGetRemoteTaskResultHandler(secondRegistry);
  const { response, responseState } = createResponse();

  await handler(createResultRequest(705) as never, response as never);

  assert.equal(responseState.statusCode, 200);
  assert.deepEqual(responseState.body?.resultData, resultJson);
});

test("createRunRemoteTaskHandler persists completed task for result handler", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const caseDir = path.join(localCaseRoot, "remote-case-handler-completed");
  const resultJson = createStoredResultJson(83);
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "outputs", "result.json"), JSON.stringify(resultJson));

  const registry = createRemoteTaskRegistry(localCaseRoot);
  const deps = {
    acceptRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => ({
      taskId: Number(remoteTask.taskId),
      caseDir,
      message: "任务接收成功，结果将通过 callback 返回",
      remoteTask: {
        ...remoteTask,
        token: "remote-token",
        testCase: { id: 1806 },
      } as never,
      workflowState: { stage: "accepted", caseDir } as never,
    }),
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async () => undefined,
  };
  const runHandler = createRunRemoteTaskHandler(deps as never, registry);
  const runResponse = createResponse();

  await runHandler(
    {
      body: {
        taskId: 806,
        token: "remote-token",
        testCase: { id: 1806 },
      },
    } as never,
    runResponse.response as never,
  );

  await waitForAssertion(async () => {
    const resultHandler = createGetRemoteTaskResultHandler(createRemoteTaskRegistry(localCaseRoot));
    const resultResponse = createResponse();

    await resultHandler(createResultRequest(806) as never, resultResponse.response as never);

    assert.equal(resultResponse.responseState.statusCode, 200);
    assert.deepEqual(resultResponse.responseState.body?.resultData, resultJson);
  });
});

test("runRemoteEvaluationTask executes a pushed remote task and uploads callback payload", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const originalUrl = "https://remote.example.com/assets/original.json";
  const workspaceUrl = "https://remote.example.com/assets/workspace.json";
  const patchUrl = "https://remote.example.com/assets/changes.patch";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/callback";
  const callbackCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: any = 2;\nvar count = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === patchUrl) {
      return new Response(
        "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets\n@@ -1 +1,2 @@\n-let value: number = 1;\n+let value: any = 2;\n+var count = 1;\n",
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }

    if (url === callbackUrl) {
      callbackCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = originalLocalCaseRoot;
    }
    if (originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = originalReferenceRoot;
    }
  });

  const result = await runRemoteEvaluationTask(
    {
      taskId: 4,
      testCase: {
        id: 8,
        name: "remote-case",
        type: "requirement",
        description: "新增页面",
        input: "请实现登录页",
        expectedOutput: "实现登录页",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
        diffFileUrl: patchUrl,
      },
      token: "remote-token",
      callback: callbackUrl,
    },
    { opencodeRunner: createOpencodeRunnerMock() },
  );

  assert.equal(result.taskId, 4);
  assert.deepEqual(
    callbackCalls.map((call) => call.body.status),
    ["pending", "running", "running", "completed"],
  );
  for (const callbackCall of callbackCalls) {
    assert.equal(callbackCall.headers.get("token"), null);
    assert.equal(callbackCall.body.taskId, 4);
    assertRemoteCallbackPayloadShape(callbackCall.body);
    assert.equal(
      "caseDir" in ((callbackCall.body.resultData as Record<string, unknown> | undefined) ?? {}),
      false,
    );
  }
  assert.equal("resultData" in callbackCalls[0].body, false);
  assert.equal("resultData" in callbackCalls[1].body, false);
  assert.equal("resultData" in callbackCalls[2].body, false);
  const finalCallback = callbackCalls.at(-1);
  assert.equal(typeof finalCallback?.body.resultData, "object");
  const resultJson = JSON.parse(
    await fs.readFile(path.join(result.caseDir, "outputs", "result.json"), "utf-8"),
  );
  const finalResultData = finalCallback?.body.resultData as Record<string, unknown>;
  assertCompletedCallbackSummary(finalCallback?.body ?? {}, resultJson);
  assert.equal("executionLog" in finalResultData, false);
  assert.equal("resultUrl" in finalResultData, false);
  const logText = await fs.readFile(path.join(result.caseDir, "logs", "run.log"), "utf-8");
  assert.match(
    logText,
    /回调结果 .*status=pending phase=execution_accepted .*message=callback 上传成功。/,
  );
  assert.match(
    logText,
    /回调结果 .*status=running phase=workflow_started .*message=callback 上传成功。/,
  );
  assert.match(
    logText,
    /回调结果 .*status=running phase=result_persisted .*message=callback 上传成功。/,
  );
  assert.match(
    logText,
    /回调结果 .*status=completed phase=completed .*message=callback 上传成功。/,
  );
  assert.match(logText, /本次用例评分耗时=\d{2}min\d{2}s/);
});

test("prepareRemoteEvaluationTask accepts a pushed task before executeAcceptedRemoteEvaluationTask uploads callback payload", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const originalUrl = "https://remote.example.com/assets/original.json";
  const workspaceUrl = "https://remote.example.com/assets/workspace.json";
  const patchUrl = "https://remote.example.com/assets/changes.patch";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/callback";
  const callbackCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: any = 2;\nvar count = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === patchUrl) {
      return new Response(
        "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets\n@@ -1 +1,2 @@\n-let value: number = 1;\n+let value: any = 2;\n+var count = 1;\n",
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }

    if (url === callbackUrl) {
      callbackCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = originalLocalCaseRoot;
    }
    if (originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = originalReferenceRoot;
    }
  });

  const requestTags: string[] = [];
  const opencodeRunner = createOpencodeRunnerMock();
  const sharedOpencodeRunner: OpencodeRunner = {
    async runPrompt(request) {
      requestTags.push(request.requestTag);
      return opencodeRunner.runPrompt(request);
    },
  };

  const accepted = await prepareRemoteEvaluationTask(
    {
      taskId: 5,
      testCase: {
        id: 9,
        name: "remote-case-prepare",
        type: "requirement",
        description: "新增页面",
        input: "请实现登录页",
        expectedOutput: "实现登录页",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
        diffFileUrl: patchUrl,
      },
      token: "remote-token",
      callback: callbackUrl,
    },
    { opencodeRunner: sharedOpencodeRunner },
  );

  assert.equal(accepted.taskId, 5);
  assert.equal(accepted.message, "任务接收成功，结果将通过 callback 返回");
  assert.equal(callbackCalls.length, 0);

  const uploadMessage = await executeAcceptedRemoteEvaluationTask(accepted);

  assert.equal(uploadMessage, "callback 上传成功。");
  assert.ok(requestTags.some((tag) => tag.startsWith("task-understanding-")));
  assert.ok(requestTags.some((tag) => tag.startsWith("rubric-scoring-")));
  assert.ok(requestTags.some((tag) => tag.startsWith("rule-assessment-")));
  assert.deepEqual(
    callbackCalls.map((call) => call.body.status),
    ["pending", "running", "running", "completed"],
  );
  for (const callbackCall of callbackCalls) {
    assert.equal(callbackCall.headers.get("token"), null);
    assert.equal(callbackCall.body.taskId, 5);
    assertRemoteCallbackPayloadShape(callbackCall.body);
  }
  assert.equal("resultData" in callbackCalls[0].body, false);
  assert.equal("resultData" in callbackCalls[1].body, false);
  assert.equal("resultData" in callbackCalls[2].body, false);
});

test("executeAcceptedRemoteEvaluationTask runs post-completed hook after completed callback without blocking return", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const originalUrl = "https://remote.example.com/assets/post-hook-original.json";
  const workspaceUrl = "https://remote.example.com/assets/post-hook-workspace.json";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/post-hook-callback";
  const callbackCalls: Array<{ body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 2;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === callbackUrl) {
      callbackCalls.push({
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = originalLocalCaseRoot;
    }
    if (originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = originalReferenceRoot;
    }
  });

  const accepted = await prepareRemoteEvaluationTask(
    {
      taskId: 6,
      testCase: {
        id: 10,
        name: "remote-case-post-completed-hook",
        type: "requirement",
        description: "新增页面",
        input: "请实现登录页",
        expectedOutput: "实现登录页",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
      },
      token: "remote-token",
      callback: callbackUrl,
    },
    { opencodeRunner: createOpencodeRunnerMock() },
  );

  let releasePostHook: (() => void) | undefined;
  let postHookCallbackCount = 0;
  const uploadPromise = executeAcceptedRemoteEvaluationTask(accepted, {
    onCompletedCallbackUploaded: async () => {
      postHookCallbackCount = callbackCalls.length;
      await new Promise<void>((resolve) => {
        releasePostHook = resolve;
      });
    },
  });

  await waitForAssertion(async () => {
    assert.equal(callbackCalls.length, 4);
  });
  const raceResult = await Promise.race([
    uploadPromise.then((message) => ({ kind: "returned", message })),
    new Promise<{ kind: "timeout" }>((resolve) =>
      setTimeout(() => resolve({ kind: "timeout" }), 50),
    ),
  ]);

  assert.deepEqual(
    callbackCalls.map((call) => call.body.status),
    ["pending", "running", "running", "completed"],
  );
  assert.deepEqual(raceResult, { kind: "returned", message: "callback 上传成功。" });
  await waitForAssertion(async () => {
    assert.equal(postHookCallbackCount, 4);
  });
  releasePostHook?.();
});

test("executeAcceptedRemoteEvaluationTask still uploads completed callback when completion hook fails", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const originalUrl = "https://remote.example.com/assets/hook-original.json";
  const workspaceUrl = "https://remote.example.com/assets/hook-workspace.json";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/hook-callback";
  const callbackCalls: Array<{ body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 2;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === callbackUrl) {
      callbackCalls.push({
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = originalLocalCaseRoot;
    }
    if (originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = originalReferenceRoot;
    }
  });

  const accepted = await prepareRemoteEvaluationTask(
    {
      taskId: 7,
      testCase: {
        id: 11,
        name: "remote-case-hook-failure",
        type: "requirement",
        description: "新增页面",
        input: "请实现登录页",
        expectedOutput: "实现登录页",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
      },
      token: "remote-token",
      callback: callbackUrl,
    },
    { opencodeRunner: createOpencodeRunnerMock() },
  );

  const uploadMessage = await executeAcceptedRemoteEvaluationTask(accepted, {
    onCompleted: async () => {
      throw new Error("stats store unavailable");
    },
  });

  assert.equal(uploadMessage, "callback 上传成功。");
  assert.deepEqual(
    callbackCalls.map((call) => call.body.status),
    ["pending", "running", "running", "completed"],
  );
});

test("executeAcceptedRemoteEvaluationTask uploads failed callback when workflow execution fails", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const originalUrl = "https://remote.example.com/assets/original-execution-fails.json";
  const workspaceUrl = "https://remote.example.com/assets/workspace-execution-fails.json";
  const patchUrl = "https://remote.example.com/assets/execution-fails.patch";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/execution-fails-callback";
  const callbackCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: any = 2;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === patchUrl) {
      return new Response(
        "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets\n@@ -1 +1 @@\n-let value: number = 1;\n+let value: any = 2;\n",
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }

    if (url === callbackUrl) {
      callbackCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = originalLocalCaseRoot;
    }
    if (originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = originalReferenceRoot;
    }
  });

  const baseRunner = createOpencodeRunnerMock();
  const failingRunner: OpencodeRunner = {
    async runPrompt(request) {
      if (request.requestTag.startsWith("rubric-scoring-")) {
        throw new Error("rubric scoring crashed");
      }
      return baseRunner.runPrompt(request);
    },
  };
  const accepted = await prepareRemoteEvaluationTask(
    {
      taskId: 6,
      testCase: {
        id: 10,
        name: "remote-case-execution-fails",
        type: "requirement",
        description: "新增页面",
        input: "请实现登录页",
        expectedOutput: "实现登录页",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
        diffFileUrl: patchUrl,
      },
      token: "remote-token",
      callback: callbackUrl,
    },
    { opencodeRunner: failingRunner },
  );

  await assert.rejects(
    () => executeAcceptedRemoteEvaluationTask(accepted),
    /rubric scoring crashed/,
  );

  assert.deepEqual(
    callbackCalls.map((call) => call.body.status),
    ["pending", "running", "failed"],
  );
  const failedCallback = callbackCalls.at(-1);
  assert.equal(failedCallback?.headers.get("token"), null);
  assertRemoteCallbackPayloadShape(failedCallback?.body ?? {});
  assert.equal(failedCallback?.body.taskId, 6);
  assert.equal(failedCallback?.body.status, "failed");
  assert.equal("resultData" in (failedCallback?.body ?? {}), false);
  assert.match(String(failedCallback?.body.errorMessage ?? ""), /rubric scoring crashed/);
});

test("createApp exposes POST /score/run-remote-task and removes the old downloadUrl route", async () => {
  let resolveBackgroundExecution: (() => void) | undefined;
  const calls: string[] = [];
  const deps = {
    acceptRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => {
      calls.push(`accept:${String(remoteTask.taskId)}`);
      return {
        taskId: 99,
        caseDir: "/tmp/remote-case",
        message: "任务接收成功，结果将通过 callback 返回",
        remoteTask: remoteTask as never,
        workflowState: {} as never,
      };
    },
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      calls.push("execute");
      await new Promise<void>((resolve) => {
        resolveBackgroundExecution = resolve;
      });
    },
  };
  const app = createApp(deps as never);
  const routerStack = (
    app as unknown as {
      router?: {
        stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
      };
    }
  ).router?.stack;
  const route = routerStack?.find((layer) => layer.route?.path === "/score/run-remote-task");
  const oldRoute = routerStack?.find((layer) => layer.route?.path === "/score/run-remote");
  const deprecatedLocalScoreRoute = routerStack?.find(
    (layer) => layer.route?.path === "/score/run",
  );
  const handler = createRunRemoteTaskHandler(deps as never);
  const responseState: {
    statusCode: number;
    body?: Record<string, unknown>;
  } = { statusCode: 200 };
  const response = {
    status(code: number) {
      responseState.statusCode = code;
      return response;
    },
    json(body: Record<string, unknown>) {
      responseState.body = body;
      return response;
    },
  };

  assert.equal(route?.route?.methods?.post, true);
  assert.equal(oldRoute, undefined);
  assert.equal(deprecatedLocalScoreRoute, undefined);
  await handler(
    {
      body: {
        taskId: 100,
        testCase: {
          id: 1,
          name: "x",
          type: "requirement",
          description: "",
          input: "",
          expectedOutput: "",
          fileUrl: "https://remote.example.com/original.json",
        },
        executionResult: {
          isBuildSuccess: true,
          outputCodeUrl: "https://remote.example.com/workspace.json",
        },
        token: "remote-token",
        callback: "https://remote.example.com/callback",
      },
    } as never,
    response as never,
  );

  assert.equal(responseState.statusCode, 200);
  assert.deepEqual(calls, ["accept:100", "execute"]);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 99);
  assert.equal("caseDir" in (responseState.body ?? {}), false);
  assert.equal(responseState.body?.message, "任务接收成功，结果将通过 callback 返回");

  resolveBackgroundExecution?.();
});

test("createRunRemoteTaskHandler returns success before remote preprocessing finishes", async () => {
  let executeStarted = false;
  let releaseExecution: (() => void) | undefined;
  const deps = {
    acceptRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => ({
      taskId: Number(remoteTask.taskId),
      caseDir: "/tmp/remote-case-early-ack",
      message: "任务接收成功，结果将通过 callback 返回",
      remoteTask: { ...remoteTask, testCase: { id: 201 } } as never,
      workflowState: {
        stage: "accepted",
        caseDir: "/tmp/remote-case-early-ack",
      } as never,
    }),
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      executeStarted = true;
      await new Promise<void>((resolve) => {
        releaseExecution = resolve;
      });
    },
  };
  const handler = createRunRemoteTaskHandler(deps as never);
  const { response, responseState } = createResponse();

  await handler({ body: { taskId: 201, testCase: { id: 201 } } } as never, response as never);

  assert.equal(responseState.statusCode, 200);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 201);
  assert.equal(responseState.body?.message, "任务接收成功，结果将通过 callback 返回");
  assert.equal("caseDir" in (responseState.body ?? {}), false);
  assert.equal(executeStarted, true);

  releaseExecution?.();
});

test("createRunRemoteTaskHandler executes at most three remote tasks concurrently", async () => {
  const releases = new Map<number, () => void>();
  const calls: string[] = [];
  const activeTaskIds = new Set<number>();
  const startedTaskIds = new Set<number>();
  let maxActiveExecutions = 0;
  let startedCount = 0;
  let startedCountResolve: (() => void) | undefined;
  let fourthExecutionStartedResolve: (() => void) | undefined;
  const fourthExecutionStarted = new Promise<void>((resolve) => {
    fourthExecutionStartedResolve = resolve;
  });
  const deps = {
    acceptRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => {
      calls.push(`accept:${String(remoteTask.taskId)}`);
      const taskId = Number(remoteTask.taskId);
      return {
        taskId,
        caseDir: `/tmp/remote-case-${String(remoteTask.taskId)}`,
        message: "任务接收成功，结果将通过 callback 返回",
        remoteTask: {
          ...remoteTask,
          testCase: { id: taskId + 100 },
        } as never,
        workflowState: {} as never,
      };
    },
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async (acceptedTask: { taskId: number }) => {
      calls.push(`execute:start:${String(acceptedTask.taskId)}`);
      activeTaskIds.add(acceptedTask.taskId);
      startedTaskIds.add(acceptedTask.taskId);
      maxActiveExecutions = Math.max(maxActiveExecutions, activeTaskIds.size);
      startedCount += 1;
      if (startedCount === 3) {
        startedCountResolve?.();
      }
      if (acceptedTask.taskId === 4) {
        fourthExecutionStartedResolve?.();
      }
      await new Promise<void>((resolve) => {
        releases.set(acceptedTask.taskId, resolve);
      });
      activeTaskIds.delete(acceptedTask.taskId);
      calls.push(`execute:end:${String(acceptedTask.taskId)}`);
    },
  };
  const handler = createRunRemoteTaskHandler(deps as never);

  const responses = [1, 2, 3, 4].map(() => createResponse());
  await Promise.all(
    [1, 2, 3, 4].map((taskId, index) =>
      handler(
        { body: { taskId, testCase: { id: taskId + 100 } } } as never,
        responses[index]?.response as never,
      ),
    ),
  );
  await Promise.race([
    new Promise<void>((resolve) => {
      startedCountResolve = resolve;
      if (startedCount >= 3) {
        resolve();
      }
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 20)),
  ]);

  assert.deepEqual(
    responses.map(({ responseState }) => responseState.statusCode),
    [200, 200, 200, 200],
  );
  assert.deepEqual(
    [...startedTaskIds].sort((left, right) => left - right),
    [1, 2, 3],
  );
  assert.equal(activeTaskIds.size, 3);
  assert.equal(maxActiveExecutions, 3);

  releases.get(1)?.();
  await fourthExecutionStarted;

  assert.deepEqual(
    [...startedTaskIds].sort((left, right) => left - right),
    [1, 2, 3, 4],
  );
  assert.equal(maxActiveExecutions, 3);

  releases.get(2)?.();
  releases.get(3)?.();
  releases.get(4)?.();
});

test("createRunRemoteTaskHandler logs remote API request, response, and errors", async () => {
  const originalInfo = console.info;
  const originalError = console.error;
  const logs: string[] = [];
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  const deps = {
    acceptRemoteEvaluationTask: async () => {
      throw new Error("download failed");
    },
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async () => undefined,
  };
  const handler = createRunRemoteTaskHandler(deps as never);
  const { response } = createResponse();

  try {
    await handler({ body: { taskId: 88, testCase: { id: 188 } } } as never, response as never);
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }

  assert.match(
    logs.join("\n"),
    /api_request_triggered route=POST \/score\/run-remote-task taskId=88 testCaseId=188/,
  );
  assert.match(
    logs.join("\n"),
    /api_request_failed route=POST \/score\/run-remote-task taskId=88 testCaseId=188 error=download failed/,
  );
  assert.match(
    logs.join("\n"),
    /api_response_sent route=POST \/score\/run-remote-task taskId=88 testCaseId=188 status=500 success=false/,
  );
});

test("remote fetch helpers log request, response, and error details", async () => {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalError = console.error;
  const logs: string[] = [];
  console.info = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("ok.json")) {
      return new Response(JSON.stringify({ files: [{ path: "Index.ets", content: "ok" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("network down");
  }) as typeof fetch;

  try {
    const { downloadManifestToDirectory } = await import("../src/io/downloader.js");
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-network-log-"));
    await downloadManifestToDirectory("https://remote.example.com/ok.json", tempDir);
    await assert.rejects(
      () => downloadManifestToDirectory("https://remote.example.com/fail.json", tempDir),
      /network down/,
    );
    await fs.rm(tempDir, { recursive: true, force: true });
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
  }

  assert.match(
    logs.join("\n"),
    /network_request_triggered method=GET url=https:\/\/remote\.example\.com\/ok\.json/,
  );
  assert.match(
    logs.join("\n"),
    /network_response_received method=GET url=https:\/\/remote\.example\.com\/ok\.json status=200 ok=true/,
  );
  assert.match(
    logs.join("\n"),
    /network_request_failed method=GET url=https:\/\/remote\.example\.com\/fail\.json error=network down/,
  );
});

test("createRunRemoteTaskHandler reports preprocessing failures through callback after acknowledgement", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const originalUrl = "https://remote.example.com/assets/original-fails.json";
  const workspaceUrl = "https://remote.example.com/assets/workspace.json";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/callback";
  const callbackCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === originalUrl) {
      throw new Error("download original manifest failed");
    }
    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: any = 2;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === callbackUrl) {
      callbackCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >,
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalLocalCaseRoot === undefined) {
      delete process.env.LOCAL_CASE_ROOT;
    } else {
      process.env.LOCAL_CASE_ROOT = originalLocalCaseRoot;
    }
    if (originalReferenceRoot === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = originalReferenceRoot;
    }
  });

  let backgroundFinished: Promise<void> | undefined;
  const deps = {
    acceptRemoteEvaluationTask,
    prepareRemoteEvaluationTask: async () => {
      throw new Error("prepareRemoteEvaluationTask should not be used by the HTTP handler");
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      throw new Error("executeAcceptedRemoteEvaluationTask should be wrapped below");
    },
  };
  deps.executeAcceptedRemoteEvaluationTask = async (acceptedTask: never) => {
    backgroundFinished = executeAcceptedRemoteEvaluationTask(acceptedTask).then(
      () => undefined,
      () => undefined,
    );
    await backgroundFinished;
  };
  const handler = createRunRemoteTaskHandler(deps as never);
  const { response, responseState } = createResponse();

  await handler(
    {
      body: {
        taskId: 101,
        testCase: {
          id: 301,
          name: "remote-case-preprocess-failure",
          type: "requirement",
          description: "新增页面",
          input: "请实现登录页",
          expectedOutput: "实现登录页",
          fileUrl: originalUrl,
        },
        executionResult: {
          isBuildSuccess: true,
          outputCodeUrl: workspaceUrl,
        },
        token: "remote-token",
        callback: callbackUrl,
      },
    } as never,
    response as never,
  );
  await backgroundFinished;

  assert.equal(responseState.statusCode, 200);
  assert.equal(responseState.body?.success, true);
  assert.equal("caseDir" in (responseState.body ?? {}), false);
  assert.equal(callbackCalls.at(-1)?.headers.get("token"), null);
  assertRemoteCallbackPayloadShape(callbackCalls.at(-1)?.body ?? {});
  assert.equal(callbackCalls.at(-1)?.body.taskId, 101);
  assert.equal(callbackCalls.at(-1)?.body.status, "failed");
  assert.equal("resultData" in (callbackCalls.at(-1)?.body ?? {}), false);
  assert.match(
    String(callbackCalls.at(-1)?.body.errorMessage ?? ""),
    /download original manifest failed/,
  );
});

test("createCorsMiddleware handles preflight and non-preflight remote task requests", async () => {
  const middleware = createCorsMiddleware();
  const origin = "http://47.100.28.161:3000";

  const preflightResponseState: {
    statusCode?: number;
    headers: Record<string, string>;
    ended: boolean;
  } = {
    headers: {},
    ended: false,
  };
  let preflightNextCalled = false;
  const preflightResponse = {
    setHeader(name: string, value: string) {
      preflightResponseState.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      preflightResponseState.statusCode = code;
      return preflightResponse;
    },
    end() {
      preflightResponseState.ended = true;
      return preflightResponse;
    },
  };

  await middleware(
    {
      method: "OPTIONS",
      header(name: string) {
        const headers: Record<string, string> = {
          origin,
          "access-control-request-headers": "content-type",
        };
        return headers[name.toLowerCase()];
      },
    } as never,
    preflightResponse as never,
    () => {
      preflightNextCalled = true;
    },
  );

  assert.equal(preflightResponseState.statusCode, 204);
  assert.equal(preflightResponseState.headers["access-control-allow-origin"], origin);
  assert.match(preflightResponseState.headers["access-control-allow-methods"] ?? "", /POST/);
  assert.match(
    preflightResponseState.headers["access-control-allow-headers"] ?? "",
    /content-type/i,
  );
  assert.equal(preflightResponseState.ended, true);
  assert.equal(preflightNextCalled, false);

  const requestResponseState: {
    headers: Record<string, string>;
  } = {
    headers: {},
  };
  let nextCalled = false;
  const requestResponse = {
    setHeader(name: string, value: string) {
      requestResponseState.headers[name.toLowerCase()] = value;
    },
  };

  await middleware(
    {
      method: "POST",
      header(name: string) {
        const headers: Record<string, string> = {
          origin,
        };
        return headers[name.toLowerCase()];
      },
    } as never,
    requestResponse as never,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(requestResponseState.headers["access-control-allow-origin"], origin);
  assert.equal(nextCalled, true);
});
