import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { remoteTaskPreparationNode } from "../src/nodes/remoteTaskPreparationNode.js";

function createManifest(content: string): { files: Array<{ path: string; content: string }> } {
  return {
    files: [{ path: "entry/src/main/ets/pages/Index.ets", content }],
  };
}

test("remoteTaskPreparationNode converts RemoteEvaluationTask into caseInput", async (t) => {
  const originalUrl = "https://remote.example.com/original.json";
  const workspaceUrl = "https://remote.example.com/workspace.json";
  const patchUrl = "https://remote.example.com/changes.patch";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));

  globalThis.fetch = (async (input: string | URL | Request) => {
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
      return new Response("diff --git a/a b/a\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(tempCaseDir, { recursive: true, force: true });
  });

  const result = await remoteTaskPreparationNode({
    caseDir: tempCaseDir,
    remoteTask: {
      taskId: 4,
      testCase: {
        id: 8,
        name: "remote-case",
        type: "requirement",
        description: "新增登录页",
        input: "实现登录页",
        expectedOutput: "登录成功",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
        diffFileUrl: patchUrl,
      },
      token: "remote-token",
      callback: "https://remote.example.com/callback",
    },
  } as never);

  assert.equal(result.caseInput?.caseId, "remote-task-4");
  assert.equal(typeof result.sourceCasePath, "string");
  assert.equal(typeof result.remoteTaskRootDir, "string");
});
