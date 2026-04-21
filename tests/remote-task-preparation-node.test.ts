import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { remoteTaskPreparationNode } from "../src/nodes/remoteTaskPreparationNode.js";

const execFileAsync = promisify(execFile);

function createManifest(content: string): { files: Array<{ path: string; content: string }> } {
  return {
    files: [{ path: "entry/src/main/ets/pages/Index.ets", content }],
  };
}

async function createZipArchive(
  t: test.TestContext,
  files: Array<{ path: string; content: string }>,
): Promise<Buffer> {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-zip-src-"));
  const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-zip-out-"));
  const archivePath = path.join(archiveDir, "bundle.zip");

  for (const file of files) {
    const filePath = path.join(sourceDir, file.path);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, file.content, "utf-8");
  }

  await execFileAsync("zip", ["-qr", archivePath, "."], { cwd: sourceDir });
  const archive = await fs.readFile(archivePath);

  t.after(async () => {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(archiveDir, { recursive: true, force: true });
  });

  return archive;
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

test("remoteTaskPreparationNode accepts zip archives for original and workspace bundles", async (t) => {
  const originalUrl = "https://remote.example.com/original.zip";
  const workspaceUrl = "https://remote.example.com/workspace.zip";
  const patchUrl = "https://remote.example.com/changes.patch";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));
  const originalArchive = await createZipArchive(t, [
    {
      path: "entry/src/main/ets/pages/Index.ets",
      content: "let originalValue: number = 1;\n",
    },
  ]);
  const workspaceArchive = await createZipArchive(t, [
    {
      path: "entry/src/main/ets/pages/Index.ets",
      content: "let workspaceValue: number = 2;\n",
    },
  ]);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(originalArchive, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(workspaceArchive, {
        status: 200,
        headers: { "Content-Type": "application/zip" },
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
      taskId: 5,
      testCase: {
        id: 9,
        name: "remote-case-zip",
        type: "requirement",
        description: "新增本地资讯",
        input: "实现本地资讯",
        expectedOutput: "本地资讯展示成功",
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

  assert.equal(result.caseInput?.caseId, "remote-task-5");
  assert.equal(result.originalFileCount, 1);
  assert.equal(result.workspaceFileCount, 1);
  assert.ok(result.sourceCasePath);
  const casePath = result.sourceCasePath;
  assert.equal(
    await fs.readFile(path.join(casePath, "original", "entry/src/main/ets/pages/Index.ets"), "utf-8"),
    "let originalValue: number = 1;\n",
  );
  assert.equal(
    await fs.readFile(path.join(casePath, "workspace", "entry/src/main/ets/pages/Index.ets"), "utf-8"),
    "let workspaceValue: number = 2;\n",
  );
});

test("remoteTaskPreparationNode materializes expected constraint yaml for remote tasks", async (t) => {
  const originalUrl = "https://remote.example.com/original.json";
  const workspaceUrl = "https://remote.example.com/workspace.json";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));
  const expectedConstraintsYaml = [
    "constraints:",
    "  - id: HM-REQ-010-01",
    "    name: 首页必须新增当前位置或本地频道展示区",
    "    description: 首页必须新增当前位置或本地频道展示区",
    "    priority: P0",
    "    rules:",
    "      - target: '**/Home*.ets'",
    "        llm: 检查首页是否新增当前位置展示区",
  ].join("\n");

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === originalUrl) {
      return new Response(JSON.stringify(createManifest("let originalValue: number = 1;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let workspaceValue: number = 2;\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
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
      taskId: 6,
      testCase: {
        id: 10,
        name: "remote-case-with-constraints",
        type: "requirement",
        description: "新增本地资讯",
        input: "实现本地资讯",
        expectedOutput: expectedConstraintsYaml,
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
      },
      token: "remote-token",
      callback: "https://remote.example.com/callback",
    },
  } as never);

  assert.ok(result.sourceCasePath);
  assert.equal(
    result.caseInput?.expectedConstraintsPath,
    path.join(result.sourceCasePath, "expected_constraints.yaml"),
  );
  assert.equal(
    await fs.readFile(path.join(result.sourceCasePath, "expected_constraints.yaml"), "utf-8"),
    expectedConstraintsYaml,
  );
});
