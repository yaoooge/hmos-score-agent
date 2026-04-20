# Cloud-Pushed Remote Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cloud-callable local HTTP endpoint that accepts `RemoteEvaluationTask`, converts it into a standard case through a new workflow preparation node, runs the existing scoring flow, and reports the result to the task callback URL.

**Architecture:** Keep local `casePath` execution intact, delete the old `downloadUrl` pull-based remote path, and introduce one new workflow ingress node named `remoteTaskPreparationNode`. The API layer receives the remote task, the workflow standardizes it into `CaseInput`, and the service layer remains responsible for callback reporting and temp cleanup.

**Tech Stack:** TypeScript, LangGraph, Express, Node.js fetch, node:test, tsx

---

## File Map

- Modify: `src/types.ts`
  Responsibility: keep the remote contract centered on `RemoteEvaluationTask` and remove obsolete types only if they are no longer referenced.

- Modify: `src/workflow/state.ts`
  Responsibility: store remote ingress state such as `remoteTask`, `sourceCasePath`, and `remoteTaskRootDir`.

- Create: `src/nodes/remoteTaskPreparationNode.ts`
  Responsibility: turn a pushed remote task into a temporary local case and return `caseInput`.

- Modify: `src/workflow/scoreWorkflow.ts`
  Responsibility: accept local or remote workflow input and insert `remoteTaskPreparationNode` ahead of `taskUnderstandingNode`.

- Modify: `src/workflow/observability/types.ts`
  Responsibility: add the new workflow node ID.

- Modify: `src/workflow/observability/nodeLabels.ts`
  Responsibility: add the Chinese label for the new node.

- Modify: `src/workflow/observability/nodeSummaries.ts`
  Responsibility: summarize local passthrough and remote conversion for the new node.

- Modify: `src/service.ts`
  Responsibility: add `runRemoteEvaluationTask(remoteTask)`, remove `downloadUrl` remote flow, and keep callback reporting in one place.

- Modify: `src/index.ts`
  Responsibility: add `POST /score/run-remote-task` and remove the old `/score/run-remote` route.

- Modify: `tests/remote-network-execution.test.ts`
  Responsibility: test the direct remote-task service path and the new HTTP endpoint, then remove old `downloadUrl` expectations.

- Modify: `tests/workflow-node-summary.test.ts`
  Responsibility: verify the new node label and summary output.

- Create: `tests/remote-task-preparation-node.test.ts`
  Responsibility: test remote task preparation behavior independently from the rest of the workflow.

- Modify: `README.md`
  Responsibility: document the cloud-pushed remote endpoint and remove `downloadUrl` usage.

---

### Task 1: Add Failing Tests For The New Workflow Ingress Node

**Files:**
- Create: `tests/remote-task-preparation-node.test.ts`
- Modify: `tests/workflow-node-summary.test.ts`

- [ ] **Step 1: Write a failing test for remote task materialization**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { remoteTaskPreparationNode } from "../src/nodes/remoteTaskPreparationNode.js";

function createManifest(content: string) {
  return {
    files: [{ path: "entry/src/main/ets/pages/Index.ets", content }],
  };
}

test("remoteTaskPreparationNode converts RemoteEvaluationTask into caseInput", async (t) => {
  const originalUrl = "https://remote.example.com/original.json";
  const workspaceUrl = "https://remote.example.com/workspace.json";
  const patchUrl = "https://remote.example.com/changes.patch";
  const originalFetch = globalThis.fetch;

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

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await remoteTaskPreparationNode({
    caseDir: await fs.mkdtemp(path.join(os.tmpdir(), "remote-task-node-")),
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
```

- [ ] **Step 2: Add a failing observability assertion for the new node**

```ts
assert.equal(getNodeLabel("remoteTaskPreparationNode"), "远端任务预处理");

assert.equal(
  summarizeNodeUpdate("remoteTaskPreparationNode", {
    mode: "remote",
    originalFileCount: 1,
    workspaceFileCount: 1,
    hasPatch: true,
  }),
  "mode=remote originalFiles=1 workspaceFiles=1 hasPatch=true",
);
```

- [ ] **Step 3: Run the targeted tests and verify they fail for the missing node**

Run:

```bash
npm test -- tests/remote-task-preparation-node.test.ts tests/workflow-node-summary.test.ts
```

Expected:

- `ERR_MODULE_NOT_FOUND` for `remoteTaskPreparationNode`, or
- assertion failure for the missing node label and summary

- [ ] **Step 4: Add the minimal workflow observability scaffolding**

```ts
export type WorkflowNodeId =
  | "remoteTaskPreparationNode"
  | "taskUnderstandingNode"
  | "inputClassificationNode"
  | "featureExtractionNode"
  | "ruleAuditNode"
  | "rubricPreparationNode"
  | "agentPromptBuilderNode"
  | "agentAssistedRuleNode"
  | "ruleMergeNode"
  | "scoringOrchestrationNode"
  | "reportGenerationNode"
  | "artifactPostProcessNode"
  | "persistAndUploadNode";
```

- [ ] **Step 5: Re-run the targeted tests**

Run:

```bash
npm test -- tests/remote-task-preparation-node.test.ts tests/workflow-node-summary.test.ts
```

Expected:

- observability assertions may now pass
- node behavior test still fails until the node is implemented

---

### Task 2: Implement `remoteTaskPreparationNode` And Extend Workflow State

**Files:**
- Create: `src/nodes/remoteTaskPreparationNode.ts`
- Modify: `src/workflow/state.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `src/workflow/observability/types.ts`
- Modify: `src/workflow/observability/nodeLabels.ts`
- Modify: `src/workflow/observability/nodeSummaries.ts`

- [ ] **Step 1: Implement the new node with local passthrough and remote conversion**

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCaseFromPath } from "../io/caseLoader.js";
import { downloadManifestToDirectory, downloadToFile } from "../io/downloader.js";
import type { ScoreGraphState } from "../workflow/state.js";

function buildRemotePrompt(task: RemoteEvaluationTask): string {
  return [
    task.testCase.description ? `任务描述：${task.testCase.description}` : "",
    task.testCase.input ? `输入要求：${task.testCase.input}` : "",
    task.testCase.expectedOutput ? `期望输出：${task.testCase.expectedOutput}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function remoteTaskPreparationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  if (state.caseInput) {
    return {
      caseInput: state.caseInput,
      sourceCasePath: state.sourceCasePath,
      mode: "local",
      passthrough: true,
    } as never;
  }

  if (!state.remoteTask) {
    throw new Error("Workflow requires either caseInput or remoteTask.");
  }

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-remote-task-"));
  const casePath = path.join(rootDir, `remote-task-${state.remoteTask.taskId}`);
  await fs.mkdir(casePath, { recursive: true });
  await fs.writeFile(path.join(casePath, "input.txt"), buildRemotePrompt(state.remoteTask), "utf-8");
  const originalFiles = await downloadManifestToDirectory(
    state.remoteTask.testCase.fileUrl,
    path.join(casePath, "original"),
  );
  const workspaceFiles = await downloadManifestToDirectory(
    state.remoteTask.executionResult.outputCodeUrl,
    path.join(casePath, "workspace"),
  );

  if (state.remoteTask.executionResult.diffFileUrl) {
    await downloadToFile(
      state.remoteTask.executionResult.diffFileUrl,
      path.join(casePath, "diff", "changes.patch"),
    );
  }

  return {
    caseInput: await loadCaseFromPath(casePath),
    sourceCasePath: casePath,
    remoteTaskRootDir: rootDir,
    originalFileCount: originalFiles.length,
    workspaceFileCount: workspaceFiles.length,
    hasPatch: Boolean(state.remoteTask.executionResult.diffFileUrl),
    mode: "remote",
  } as never;
}
```

- [ ] **Step 2: Extend workflow state for remote ingress**

```ts
export const ScoreState = Annotation.Root({
  remoteTask: Annotation<RemoteEvaluationTask>(),
  caseInput: Annotation<CaseInput>(),
  sourceCasePath: Annotation<string>(),
  remoteTaskRootDir: Annotation<string>(),
  caseDir: Annotation<string>(),
  effectivePatchPath: Annotation<string>(),
});
```

- [ ] **Step 3: Add the node to the graph before `taskUnderstandingNode`**

```ts
const graph = new StateGraph(ScoreState)
  .addNode("remoteTaskPreparationNode", (s) => remoteTaskPreparationNode(s))
  .addNode("taskUnderstandingNode", (s, nodeConfig) =>
    taskUnderstandingNode(
      s,
      { agentClient, artifactStore: input.artifactStore, logger },
      nodeConfig,
    ),
  )
  .addEdge(START, "remoteTaskPreparationNode")
  .addEdge("remoteTaskPreparationNode", "taskUnderstandingNode");
```

- [ ] **Step 4: Update workflow input handling**

```ts
const initialState =
  "remoteTask" in input
    ? {
        remoteTask: input.remoteTask,
        caseDir: input.caseDir,
      }
    : {
        caseInput: input.caseInput,
        sourceCasePath: input.sourceCasePath,
        caseDir: input.caseDir,
      };
```

- [ ] **Step 5: Re-run the targeted tests and verify they pass**

Run:

```bash
npm test -- tests/remote-task-preparation-node.test.ts tests/workflow-node-summary.test.ts
```

Expected:

- `PASS` for remote task materialization
- `PASS` for new node label and summary

---

### Task 3: Refactor The Service Layer To Use Direct Remote Tasks

**Files:**
- Modify: `src/service.ts`
- Modify: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write a failing service test for direct remote task execution**

```ts
test("runRemoteEvaluationTask executes a pushed remote task and uploads callback payload", async (t) => {
  const callbackCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url === "https://remote.example.com/original.json") {
      return new Response(
        JSON.stringify({ files: [{ path: "entry/src/main/ets/pages/Index.ets", content: "let a = 1;" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url === "https://remote.example.com/workspace.json") {
      return new Response(
        JSON.stringify({ files: [{ path: "entry/src/main/ets/pages/Index.ets", content: "let a: any = 2;" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url === "https://remote.example.com/callback") {
      callbackCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    throw new Error(`Unexpected fetch url: ${url}`);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await runRemoteEvaluationTask({
    taskId: 4,
    testCase: {
      id: 8,
      name: "remote-case",
      type: "requirement",
      description: "新增页面",
      input: "实现登录页",
      expectedOutput: "登录成功",
      fileUrl: "https://remote.example.com/original.json",
    },
    executionResult: {
      isBuildSuccess: true,
      outputCodeUrl: "https://remote.example.com/workspace.json",
    },
    token: "remote-token",
    callback: "https://remote.example.com/callback",
  });

  assert.equal(result.taskId, 4);
  assert.equal(callbackCalls.length, 1);
  assert.equal(callbackCalls[0]?.headers.get("token"), "remote-token");
  assert.equal(callbackCalls[0]?.body.status, "completed");
});
```

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
npm test -- tests/remote-network-execution.test.ts
```

Expected:

- failure because the service still exposes or depends on the old `downloadUrl` flow

- [ ] **Step 3: Refactor `src/service.ts` so the workflow accepts `remoteTask` directly**

```ts
export async function runRemoteEvaluationTask(
  remoteTask: RemoteEvaluationTask,
): Promise<{ caseDir: string; taskId: number; uploadMessage?: string }> {
  const config = getConfig();
  const artifactStore = new ArtifactStore(config.localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir(
    buildRunCaseId({
      taskType: "full_generation",
      uniqueId: randomUUID().replace(/-/g, "").slice(0, 8),
    }),
  );
  let workflowResult: Record<string, unknown> | undefined;

  try {
    workflowResult = await runScoreWorkflow({
      remoteTask,
      caseDir,
      referenceRoot: config.referenceRoot,
      artifactStore,
      uploadEndpoint: config.uploadEndpoint,
      uploadToken: config.uploadToken,
    });

    const upload = await uploadTaskCallback(
      remoteTask.callback,
      remoteTask.token,
      buildRemoteCallbackPayload({
        taskId: remoteTask.taskId,
        status: "completed",
        resultData: (workflowResult.resultJson as Record<string, unknown> | undefined) ?? {},
      }),
    );

    return {
      caseDir,
      taskId: remoteTask.taskId,
      uploadMessage: upload.message,
    };
  } catch (error) {
    await uploadTaskCallback(
      remoteTask.callback,
      remoteTask.token,
      buildRemoteCallbackPayload({
        taskId: remoteTask.taskId,
        status: "failed",
        resultData: { error: error instanceof Error ? error.message : String(error) },
      }),
    );
    throw error;
  } finally {
    if (typeof workflowResult?.remoteTaskRootDir === "string") {
      await fsp.rm(workflowResult.remoteTaskRootDir, { recursive: true, force: true });
    }
  }
}
```

- [ ] **Step 4: Delete the old `runRemoteTask(downloadUrl)` path and its helper usage**

```ts
// Remove:
// - downloadRemoteTask as fetchRemoteTask import
// - materializeRemoteCase()
// - runRemoteTask(downloadUrl)
```

- [ ] **Step 5: Re-run the service test**

Run:

```bash
npm test -- tests/remote-network-execution.test.ts
```

Expected:

- `PASS` for direct remote task execution
- no remaining assertions about `downloadUrl`

---

### Task 4: Add The New HTTP Endpoint And Remove The Old One

**Files:**
- Modify: `src/index.ts`
- Modify: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Add a failing API test for `POST /score/run-remote-task`**

```ts
test("createApp exposes POST /score/run-remote-task and forwards RemoteEvaluationTask", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    runRemoteEvaluationTask: async (task: Record<string, unknown>) => {
      calls.push(task);
      return { caseDir: "/tmp/remote-case", taskId: 99, uploadMessage: "callback uploaded" };
    },
  };

  const app = createApp(deps as never);
  const routerStack = (
    app as unknown as {
      router?: { stack?: Array<{ route?: { path?: string; methods?: Record<string, boolean> } }> };
    }
  ).router?.stack;
  const route = routerStack?.find((layer) => layer.route?.path === "/score/run-remote-task");

  assert.equal(route?.route?.methods?.post, true);
  assert.equal(
    routerStack?.some((layer) => layer.route?.path === "/score/run-remote"),
    false,
  );
});
```

- [ ] **Step 2: Run the API test and confirm it fails**

Run:

```bash
npm test -- tests/remote-network-execution.test.ts
```

Expected:

- failure because `/score/run-remote-task` does not exist yet
- or failure because `/score/run-remote` still exists

- [ ] **Step 3: Implement the new handler and route**

```ts
type AppDeps = {
  runSingleCase: typeof runSingleCase;
  runRemoteEvaluationTask: typeof runRemoteEvaluationTask;
};

export function createRunRemoteTaskHandler(deps: AppDeps) {
  return async (req: Request, res: Response) => {
    try {
      const result = await deps.runRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}

app.post("/score/run-remote-task", createRunRemoteTaskHandler(deps));
```

- [ ] **Step 4: Remove the old route and dependency**

```ts
// Remove:
// - createRunRemoteHandler()
// - runRemoteTask dependency
// - app.post("/score/run-remote", ...)
```

- [ ] **Step 5: Re-run the API tests**

Run:

```bash
npm test -- tests/remote-network-execution.test.ts
```

Expected:

- `PASS` for the new route
- `PASS` that the old route is gone

---

### Task 5: Update Documentation And Run Final Verification

**Files:**
- Modify: `README.md`
- Modify: `tests/remote-network-execution.test.ts`
- Test: `tests/remote-task-preparation-node.test.ts`
- Test: `tests/workflow-node-summary.test.ts`

- [ ] **Step 1: Replace the remote API example in `README.md`**

~~~md
触发云端直接下发任务评分：

```bash
curl -X POST http://localhost:3000/score/run-remote-task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": 4,
    "testCase": {
      "id": 8,
      "name": "remote-case",
      "type": "requirement",
      "description": "新增登录页",
      "input": "实现登录页",
      "expectedOutput": "登录成功",
      "fileUrl": "https://example.com/original.json"
    },
    "executionResult": {
      "isBuildSuccess": true,
      "outputCodeUrl": "https://example.com/workspace.json",
      "diffFileUrl": "https://example.com/changes.patch"
    },
    "token": "remote-token",
    "callback": "https://example.com/api/evaluation-tasks/callback"
  }'
```
~~~

- [ ] **Step 2: Remove all README and test references to `downloadUrl` remote mode**

```ts
// Remove any remaining references to:
// - POST /score/run-remote
// - downloadUrl
// - "next task" pulling terminology
```

- [ ] **Step 3: Run the focused regression suite**

Run:

```bash
npm test -- tests/remote-task-preparation-node.test.ts tests/remote-network-execution.test.ts tests/workflow-node-summary.test.ts
```

Expected:

- all targeted tests `PASS`

- [ ] **Step 4: Run the full verification commands**

Run:

```bash
npm run build
npm test
```

Expected:

- `tsc -p tsconfig.json` exits with code `0`
- full test suite passes

- [ ] **Step 5: Commit the completed feature**

```bash
git add README.md src/index.ts src/service.ts src/types.ts src/workflow/state.ts src/workflow/scoreWorkflow.ts src/workflow/observability/types.ts src/workflow/observability/nodeLabels.ts src/workflow/observability/nodeSummaries.ts src/nodes/remoteTaskPreparationNode.ts tests/remote-task-preparation-node.test.ts tests/remote-network-execution.test.ts tests/workflow-node-summary.test.ts docs/superpowers/specs/2026-04-20-cloud-pushed-remote-task-design.md docs/superpowers/plans/2026-04-20-cloud-pushed-remote-task-implementation.md
git commit -m "feat: accept cloud-pushed remote evaluation tasks"
```

---

## Self-Review

- Spec coverage:
  - 新接口接收 `RemoteEvaluationTask`: Task 4
  - workflow 前置节点转 case: Task 1-2
  - callback 成功失败上报: Task 3
  - 删除旧 `downloadUrl` 模式: Task 3-5
  - 文档和回归验证: Task 5

- Placeholder scan:
  - no `TODO`
  - no `TBD`
  - each task lists files, commands, and expected results

- Type consistency:
  - `remoteTaskPreparationNode` used consistently
  - `runRemoteEvaluationTask` used consistently
  - `/score/run-remote-task` used consistently
