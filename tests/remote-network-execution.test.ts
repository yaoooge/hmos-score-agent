import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp, createRunRemoteHandler } from "../src/index.js";
import { runRemoteTask } from "../src/service.js";

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

test("runRemoteTask downloads remote case artifacts and uploads callback payload with token header", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const originalLocalCaseRoot = process.env.LOCAL_CASE_ROOT;
  const originalReferenceRoot = process.env.DEFAULT_REFERENCE_ROOT;
  process.env.LOCAL_CASE_ROOT = localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  const downloadUrl = "https://remote.example.com/api/evaluation-tasks/next";
  const originalUrl = "https://remote.example.com/assets/original.json";
  const workspaceUrl = "https://remote.example.com/assets/workspace.json";
  const patchUrl = "https://remote.example.com/assets/changes.patch";
  const callbackUrl = "https://remote.example.com/api/evaluation-tasks/callback";
  const callbackCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === downloadUrl) {
      return new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

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

  const result = await runRemoteTask(downloadUrl);

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

test("createApp exposes POST /score/run-remote and forwards the downloadUrl", async () => {
  const calls: string[] = [];
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    runRemoteTask: async (downloadUrl: string) => {
      calls.push(downloadUrl);
      return { caseDir: "/tmp/remote-case", taskId: 99, uploadMessage: "callback uploaded" };
    },
  };
  const app = createApp(deps);
  const routerStack = (
    app as unknown as {
      router?: {
        stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }>;
      };
    }
  ).router?.stack;
  const route = routerStack?.find((layer) => layer.route?.path === "/score/run-remote");
  const handler = createRunRemoteHandler(deps);
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
  await handler(
    {
      body: {
        downloadUrl: "https://remote.example.com/api/evaluation-tasks/next",
      },
    } as never,
    response as never,
  );

  assert.equal(responseState.statusCode, 200);
  assert.deepEqual(calls, ["https://remote.example.com/api/evaluation-tasks/next"]);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 99);
  assert.equal(responseState.body?.caseDir, "/tmp/remote-case");
});
