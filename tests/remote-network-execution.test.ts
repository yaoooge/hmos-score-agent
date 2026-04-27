import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp, createCorsMiddleware, createRunRemoteTaskHandler } from "../src/index.js";
import {
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
        const payload = parsePromptPayload<{ assisted_rule_candidates: Array<{ rule_id: string }> }>(
          request.prompt,
          "bootstrap_payload",
        );
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

  const result = await runRemoteEvaluationTask({
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
  }, { opencodeRunner: createOpencodeRunnerMock() });

  assert.equal(result.taskId, 4);
  assert.equal(callbackCalls.length, 1);
  assert.equal(callbackCalls[0]?.headers.get("token"), "remote-token");
  assert.equal(callbackCalls[0]?.body.taskId, 4);
  assert.equal(callbackCalls[0]?.body.status, "completed");
  assert.equal(callbackCalls[0]?.body.maxScore, 100);
  assert.equal(typeof callbackCalls[0]?.body.totalScore, "number");
  assert.equal(typeof callbackCalls[0]?.body.resultData, "object");
  const resultJson = JSON.parse(
    await fs.readFile(path.join(result.caseDir, "outputs", "result.json"), "utf-8"),
  );
  assert.equal(callbackCalls[0]?.body.totalScore, resultJson.overall_conclusion.total_score);
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

  const accepted = await prepareRemoteEvaluationTask({
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
  }, { opencodeRunner: createOpencodeRunnerMock() });

  assert.equal(accepted.taskId, 5);
  assert.equal(accepted.message, "任务接收成功，结果将通过 callback 返回");
  assert.equal(callbackCalls.length, 0);

  const uploadMessage = await executeAcceptedRemoteEvaluationTask(accepted, {
    opencodeRunner: createOpencodeRunnerMock(),
  });

  assert.equal(uploadMessage, "callback 上传成功。");
  assert.equal(callbackCalls.length, 1);
  assert.equal(callbackCalls[0]?.headers.get("token"), "remote-token");
  assert.equal(callbackCalls[0]?.body.taskId, 5);
  assert.equal(callbackCalls[0]?.body.status, "completed");
});

test("createApp exposes POST /score/run-remote-task and removes the old downloadUrl route", async () => {
  let resolveBackgroundExecution: (() => void) | undefined;
  const calls: string[] = [];
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    prepareRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => {
      calls.push(`prepare:${String(remoteTask.taskId)}`);
      return {
        taskId: 99,
        caseDir: "/tmp/remote-case",
        message: "任务接收成功，结果将通过 callback 返回",
        remoteTask: remoteTask as never,
        workflowState: {} as never,
      };
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      calls.push("execute");
      await new Promise<void>((resolve) => {
        resolveBackgroundExecution = resolve;
      });
    },
    runRemoteEvaluationTask: async () => {
      throw new Error("runRemoteEvaluationTask should not be used by the HTTP handler");
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
  assert.deepEqual(calls, ["prepare:100", "execute"]);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 99);
  assert.equal(responseState.body?.caseDir, "/tmp/remote-case");
  assert.equal(responseState.body?.message, "任务接收成功，结果将通过 callback 返回");

  resolveBackgroundExecution?.();
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
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    prepareRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => {
      calls.push(`prepare:${String(remoteTask.taskId)}`);
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
    runRemoteEvaluationTask: async () => {
      throw new Error("runRemoteEvaluationTask should not be used by the HTTP handler");
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

test("createRunRemoteTaskHandler returns 504 when a task never enters execution or queue before timeout", async () => {
  const originalTimeout = process.env.REMOTE_TASK_ACCEPT_TIMEOUT_MS;
  process.env.REMOTE_TASK_ACCEPT_TIMEOUT_MS = "10";
  const calls: string[] = [];
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    prepareRemoteEvaluationTask: async (remoteTask: Record<string, unknown>) => {
      calls.push(`prepare:start:${String(remoteTask.taskId)}`);
      await new Promise<void>(() => undefined);
      throw new Error("unreachable");
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      calls.push("execute");
    },
    runRemoteEvaluationTask: async () => {
      throw new Error("runRemoteEvaluationTask should not be used by the HTTP handler");
    },
  };
  const handler = createRunRemoteTaskHandler(deps as never);
  const { response, responseState } = createResponse();

  try {
    await handler({ body: { taskId: 77 } } as never, response as never);
  } finally {
    if (originalTimeout === undefined) {
      delete process.env.REMOTE_TASK_ACCEPT_TIMEOUT_MS;
    } else {
      process.env.REMOTE_TASK_ACCEPT_TIMEOUT_MS = originalTimeout;
    }
  }

  assert.equal(responseState.statusCode, 504);
  assert.equal(responseState.body?.success, false);
  assert.equal(responseState.body?.taskId, 77);
  assert.match(String(responseState.body?.message ?? ""), /超时/);
  assert.deepEqual(calls, ["prepare:start:77"]);
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
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    prepareRemoteEvaluationTask: async () => {
      throw new Error("download failed");
    },
    executeAcceptedRemoteEvaluationTask: async () => undefined,
    runRemoteEvaluationTask: async () => {
      throw new Error("runRemoteEvaluationTask should not be used by the HTTP handler");
    },
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

test("createRunRemoteTaskHandler returns 500 when preprocessing fails", async () => {
  let executeCalled = false;
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    prepareRemoteEvaluationTask: async () => {
      throw new Error("download original manifest failed");
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      executeCalled = true;
    },
    runRemoteEvaluationTask: async () => {
      throw new Error("runRemoteEvaluationTask should not be used when preprocessing fails");
    },
  };
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

  await handler(
    {
      body: {
        taskId: 101,
      },
    } as never,
    response as never,
  );

  assert.equal(responseState.statusCode, 500);
  assert.equal(responseState.body?.success, false);
  assert.match(String(responseState.body?.message ?? ""), /download original manifest failed/);
  assert.equal(executeCalled, false);
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
