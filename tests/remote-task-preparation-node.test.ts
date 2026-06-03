import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { remoteTaskPreparationNode } from "../src/workflow/nodes/remoteTaskPreparation/index.js";

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
        type: "continuation",
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
  assert.equal(result.remoteBuildSuccess, true);
});

test("remoteTaskPreparationNode requires a remote task instead of local case passthrough", async () => {
  await assert.rejects(
    () =>
      remoteTaskPreparationNode({
        caseDir: "/tmp/remote-task-only",
        sourceCasePath: "/tmp/local-case",
        caseInput: {
          caseId: "local-case",
          promptText: "local prompt",
          originalProjectPath: "/tmp/local-case/original",
          generatedProjectPath: "/tmp/local-case/workspace",
          originalProjectProvided: true,
        },
      } as never),
    /Workflow requires remoteTask/,
  );
});

test("remoteTaskPreparationNode uses fixed remote task type without prompt inference", async (t) => {
  const originalUrl = "https://remote.example.com/fixed-type-original.json";
  const workspaceUrl = "https://remote.example.com/fixed-type-workspace.json";
  const patchUrl = "https://remote.example.com/fixed-type.patch";
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
      taskId: 44,
      testCase: {
        id: 88,
        name: "fixed-type-case",
        type: "full_generation",
        description: "修复登录页按钮无响应",
        input: "请修复登录失败问题",
        expectedOutput: "",
        fileUrl: originalUrl,
      },
      executionResult: {
        isBuildSuccess: false,
        outputCodeUrl: workspaceUrl,
        diffFileUrl: patchUrl,
      },
      callback: "https://remote.example.com/callback",
    },
  } as never);

  assert.equal(result.taskType, "full_generation");
  assert.equal(result.remoteBuildSuccess, false);
});

test("remoteTaskPreparationNode maps management console task types", async (t) => {
  const workspaceUrl = "https://remote.example.com/management-type-workspace.json";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
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

  const cases = [
    { remoteType: "new_development", taskType: "full_generation" },
    { remoteType: "incremental", taskType: "continuation" },
    { remoteType: "bugfix", taskType: "bug_fix" },
  ] as const;

  for (const item of cases) {
    const result = await remoteTaskPreparationNode({
      caseDir: tempCaseDir,
      remoteTask: {
        taskId: 90,
        testCase: {
          id: 190,
          name: `management-${item.remoteType}`,
          type: item.remoteType,
          description: "管理台提交任务",
          input: "按固定任务类型评分",
          expectedOutput: "",
          fileUrl: "",
        },
        executionResult: {
          isBuildSuccess: true,
          outputCodeUrl: workspaceUrl,
        },
        callback: "https://remote.example.com/callback",
      },
    } as never);

    assert.equal(result.taskType, item.taskType);
  }
});

test("remoteTaskPreparationNode rejects unsupported remote task type", async (t) => {
  const workspaceUrl = "https://remote.example.com/unsupported-type-workspace.json";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: number = 1;\n")), {
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

  await assert.rejects(
    () =>
      remoteTaskPreparationNode({
        caseDir: tempCaseDir,
        remoteTask: {
          taskId: 45,
          testCase: {
            id: 89,
            name: "unsupported-type-case",
            type: "requirement",
            description: "新增登录页",
            input: "实现登录页",
            expectedOutput: "",
            fileUrl: "",
          },
          executionResult: {
            isBuildSuccess: true,
            outputCodeUrl: workspaceUrl,
          },
          callback: "https://remote.example.com/callback",
        },
      } as never),
    /Unsupported remote task type: requirement/,
  );
});

test("remoteTaskPreparationNode supports full generation tasks without original project URL", async (t) => {
  const workspaceUrl = "https://remote.example.com/workspace.json";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let generatedValue: number = 2;\n")), {
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
      taskId: 98,
      testCase: {
        id: 45,
        name: "full_generation_007",
        type: "full_generation",
        description: "从0到1生成茶饮元服务",
        input: "实现茶饮订单元服务",
        expectedOutput: "",
        fileUrl: "",
      },
      executionResult: {
        isBuildSuccess: true,
        outputCodeUrl: workspaceUrl,
        diffFileUrl: "",
      },
      token: "remote-token",
      callback: "https://remote.example.com/callback",
    },
  } as never);

  assert.equal(result.caseInput?.caseId, "remote-task-98");
  assert.equal(result.originalFileCount, 0);
  assert.equal(result.workspaceFileCount, 1);
  assert.equal(result.caseInput?.originalProjectProvided, false);
  assert.ok(result.sourceCasePath);
  assert.deepEqual(requestedUrls, [workspaceUrl]);
  assert.deepEqual(await fs.readdir(path.join(result.sourceCasePath, "original")), []);
  assert.equal(
    await fs.readFile(
      path.join(result.sourceCasePath, "workspace", "entry/src/main/ets/pages/Index.ets"),
      "utf-8",
    ),
    "let generatedValue: number = 2;\n",
  );
});

test("remoteTaskPreparationNode logs remote download diagnostics", async (t) => {
  const originalUrl = "https://remote.example.com/log-original.json";
  const workspaceUrl = "https://remote.example.com/log-workspace.json";
  const patchUrl = "https://remote.example.com/log-changes.patch";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));
  const messages: string[] = [];

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

  await remoteTaskPreparationNode(
    {
      caseDir: tempCaseDir,
      remoteTask: {
        taskId: 108,
        testCase: {
          id: 208,
          name: "download-log-case",
          type: "continuation",
          description: "新增下载诊断日志",
          input: "实现下载诊断日志",
          expectedOutput: "",
          fileUrl: originalUrl,
        },
        executionResult: {
          isBuildSuccess: true,
          outputCodeUrl: workspaceUrl,
          diffFileUrl: patchUrl,
        },
        callback: "https://remote.example.com/callback",
      },
    } as never,
    {
      logger: {
        info: async (message: string) => {
          messages.push(message);
        },
        error: async (message: string) => {
          messages.push(message);
        },
      },
    },
  );

  assert.ok(
    messages.some((message) =>
      message.includes(`remote_download_started label=original_project url=${originalUrl}`),
    ),
  );
  assert.ok(
    messages.some((message) =>
      message.includes(`remote_download_response label=workspace_project url=${workspaceUrl}`),
    ),
  );
  assert.ok(
    messages.some((message) =>
      message.includes(`remote_download_completed label=diff_patch url=${patchUrl}`),
    ),
  );
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
        type: "continuation",
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
    await fs.readFile(
      path.join(casePath, "original", "entry/src/main/ets/pages/Index.ets"),
      "utf-8",
    ),
    "let originalValue: number = 1;\n",
  );
  assert.equal(
    await fs.readFile(
      path.join(casePath, "workspace", "entry/src/main/ets/pages/Index.ets"),
      "utf-8",
    ),
    "let workspaceValue: number = 2;\n",
  );
});

test("remoteTaskPreparationNode normalizes backslash zip entry paths", async (t) => {
  const originalUrl = "https://remote.example.com/original-windows.zip";
  const workspaceUrl = "https://remote.example.com/workspace-windows.zip";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));
  const originalArchive = await createZipArchive(t, [
    {
      path: "entry\\src\\main\\ets\\pages\\Index.ets",
      content: "let originalValue: number = 1;\n",
    },
  ]);
  const workspaceArchive = await createZipArchive(t, [
    {
      path: "entry\\src\\main\\ets\\pages\\Index.ets",
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

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    await fs.rm(tempCaseDir, { recursive: true, force: true });
  });

  const result = await remoteTaskPreparationNode({
    caseDir: tempCaseDir,
    remoteTask: {
      taskId: 7,
      testCase: {
        id: 11,
        name: "remote-case-windows-zip",
        type: "continuation",
        description: "新增本地资讯",
        input: "实现本地资讯",
        expectedOutput: "本地资讯展示成功",
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

  assert.equal(result.caseInput?.caseId, "remote-task-7");
  assert.ok(result.sourceCasePath);
  assert.equal(
    await fs.readFile(
      path.join(result.sourceCasePath, "original", "entry/src/main/ets/pages/Index.ets"),
      "utf-8",
    ),
    "let originalValue: number = 1;\n",
  );
  assert.equal(
    await fs.readFile(
      path.join(result.sourceCasePath, "workspace", "entry/src/main/ets/pages/Index.ets"),
      "utf-8",
    ),
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
        type: "continuation",
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

test("remoteTaskPreparationNode materializes top-level list expected constraint yaml", async (t) => {
  const workspaceUrl = "https://remote.example.com/workspace.json";
  const originalFetch = globalThis.fetch;
  const tempCaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-"));
  const expectedConstraintsYaml = [
    "- id: MALL-MUST-01",
    "  name: '主导航必须采用四 Tab 结构'",
    "  priority: P0",
    "  kit:",
    "    - 'ArkUI: Tabs / TabContent'",
    "  rules:",
    "    - target: '**/pages/MainPage.ets'",
    "      llm: '检查底部导航栏是否使用 Tabs + TabContent 组件实现'",
  ].join("\n");

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("Tabs() {}\n")), {
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
      taskId: 12,
      testCase: {
        id: 12,
        name: "remote-case-with-list-constraints",
        type: "full_generation",
        description: "实现商城首页",
        input: "实现商城首页",
        expectedOutput: expectedConstraintsYaml,
        fileUrl: "",
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
    await fs.readFile(path.join(result.sourceCasePath, "expected_constraints.yaml"), "utf-8"),
    expectedConstraintsYaml,
  );
  assert.equal(result.caseInput?.expectedConstraintsPath, path.join(result.sourceCasePath, "expected_constraints.yaml"));
});
