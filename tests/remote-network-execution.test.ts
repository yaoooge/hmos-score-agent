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
  });

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
  });

  assert.equal(accepted.taskId, 5);
  assert.equal(accepted.message, "任务接收成功，结果将通过 callback 返回");
  assert.equal(callbackCalls.length, 0);

  const uploadMessage = await executeAcceptedRemoteEvaluationTask(accepted);

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
        testCase: { id: 1, name: "x", type: "requirement", description: "", input: "", expectedOutput: "", fileUrl: "https://remote.example.com/original.json" },
        executionResult: { isBuildSuccess: true, outputCodeUrl: "https://remote.example.com/workspace.json" },
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
  assert.match(preflightResponseState.headers["access-control-allow-headers"] ?? "", /content-type/i);
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
