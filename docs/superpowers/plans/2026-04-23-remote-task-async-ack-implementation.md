# Remote Task Async Acknowledgement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `POST /score/run-remote-task` so it returns success after remote preprocessing and initial task analysis complete, while the final result is delivered only through callback.

**Architecture:** Split remote execution into a synchronous acceptance phase and an asynchronous completion phase. The acceptance phase runs `remoteTaskPreparationNode`, `taskUnderstandingNode`, and `inputClassificationNode`, persists the accepted task context, and returns immediately; the completion phase resumes workflow from `ruleAuditNode`, uploads callback results, and performs cleanup.

**Tech Stack:** TypeScript, Express, Node test runner, LangGraph workflow nodes

---

## File Map

- Modify: `src/service.ts`
  Responsibility: split remote-task handling into prepare/accept/execute phases, keep callback and cleanup in one place, and preserve the synchronous helper for direct service calls.
- Modify: `src/workflow/scoreWorkflow.ts`
  Responsibility: add a workflow entry point that resumes from already prepared state without re-running remote download or task understanding.
- Modify: `src/index.ts`
  Responsibility: return HTTP success immediately after acceptance and launch background execution with explicit error capture.
- Modify: `tests/remote-network-execution.test.ts`
  Responsibility: verify async HTTP acknowledgment behavior, callback timing, and preprocessing failure returning `500`.
- Modify: `README.md`
  Responsibility: document the new synchronous response semantics and clarify that final results arrive by callback.

### Task 1: Add Failing HTTP Tests For Async Acknowledgement

**Files:**
- Modify: `tests/remote-network-execution.test.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("createRunRemoteTaskHandler returns success after acceptance and does not wait for background completion", async () => {
  let resolveExecution: (() => void) | undefined;
  const started: string[] = [];
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
    prepareRemoteEvaluationTask: async () => {
      started.push("prepare");
      return {
        taskId: 42,
        caseDir: "/tmp/remote-case",
        message: "任务接收成功，结果将通过 callback 返回",
        remoteTask: {} as never,
        workflowState: {} as never,
      };
    },
    executeAcceptedRemoteEvaluationTask: async () => {
      started.push("execute");
      await new Promise<void>((resolve) => {
        resolveExecution = resolve;
      });
    },
    runRemoteEvaluationTask: async () => {
      throw new Error("not used by async handler test");
    },
  };
  const handler = createRunRemoteTaskHandler(deps as never);
  const responseState: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
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

  await handler({ body: { taskId: 42 } } as never, response as never);

  assert.equal(responseState.statusCode, 200);
  assert.equal(responseState.body?.success, true);
  assert.equal(responseState.body?.taskId, 42);
  assert.equal(responseState.body?.message, "任务接收成功，结果将通过 callback 返回");
  assert.deepEqual(started, ["prepare", "execute"]);

  resolveExecution?.();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: FAIL because `createRunRemoteTaskHandler()` still expects `runRemoteEvaluationTask()` only and does not support acceptance plus background execution.

- [ ] **Step 3: Write minimal implementation**

```ts
type AppDeps = {
  runSingleCase: typeof runSingleCase;
  runRemoteEvaluationTask: typeof runRemoteEvaluationTask;
  prepareRemoteEvaluationTask: typeof prepareRemoteEvaluationTask;
  executeAcceptedRemoteEvaluationTask: typeof executeAcceptedRemoteEvaluationTask;
};
```

```ts
export function createRunRemoteTaskHandler(deps: AppDeps) {
  return async (req: Request, res: Response) => {
    try {
      const accepted = await deps.prepareRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      void deps.executeAcceptedRemoteEvaluationTask(accepted).catch((error) => {
        console.error("run-remote-task background execution failed", error);
      });
      res.json({
        success: true,
        taskId: accepted.taskId,
        caseDir: accepted.caseDir,
        message: accepted.message,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: PASS for the new async-ack test, while later tests may still fail until remaining tasks are implemented.

- [ ] **Step 5: Commit**

```bash
git add tests/remote-network-execution.test.ts src/index.ts
git commit -m "test: cover async remote task acknowledgement"
```

### Task 2: Add Failing Test For Preprocessing Failure Returning 500

**Files:**
- Modify: `tests/remote-network-execution.test.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("createRunRemoteTaskHandler returns 500 when remote task acceptance fails", async () => {
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
      throw new Error("not used by acceptance failure test");
    },
  };
  const handler = createRunRemoteTaskHandler(deps as never);
  const responseState: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
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

  await handler({ body: { taskId: 7 } } as never, response as never);

  assert.equal(responseState.statusCode, 500);
  assert.equal(responseState.body?.success, false);
  assert.match(String(responseState.body?.message ?? ""), /download original manifest failed/);
  assert.equal(executeCalled, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: FAIL until the handler is switched to the acceptance API from Task 1.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createRunRemoteTaskHandler(deps: AppDeps) {
  return async (req: Request, res: Response) => {
    try {
      const accepted = await deps.prepareRemoteEvaluationTask(req.body as RemoteEvaluationTask);
      void deps.executeAcceptedRemoteEvaluationTask(accepted).catch((error) => {
        console.error("run-remote-task background execution failed", error);
      });
      res.json({
        success: true,
        taskId: accepted.taskId,
        caseDir: accepted.caseDir,
        message: accepted.message,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "未知错误",
      });
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: PASS for the acceptance failure behavior.

- [ ] **Step 5: Commit**

```bash
git add tests/remote-network-execution.test.ts src/index.ts
git commit -m "test: enforce remote task acceptance failure response"
```

### Task 3: Add Failing Service Test For Acceptance Followed By Callback Completion

**Files:**
- Modify: `tests/remote-network-execution.test.ts`
- Modify: `src/service.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("prepareRemoteEvaluationTask accepts the task and executeAcceptedRemoteEvaluationTask uploads callback payload", async (t) => {
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
      return new Response(JSON.stringify(createManifest("let value: number = 1;\\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === workspaceUrl) {
      return new Response(JSON.stringify(createManifest("let value: any = 2;\\nvar count = 1;\\n")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === patchUrl) {
      return new Response("diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets\\n@@ -1 +1,2 @@\\n-let value: number = 1;\\n+let value: any = 2;\\n+var count = 1;\\n", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    if (url === callbackUrl) {
      callbackCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
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

  assert.equal(accepted.taskId, 4);
  assert.equal(accepted.message, "任务接收成功，结果将通过 callback 返回");
  assert.equal(callbackCalls.length, 0);

  await executeAcceptedRemoteEvaluationTask(accepted);

  assert.equal(callbackCalls.length, 1);
  assert.equal(callbackCalls[0]?.headers.get("token"), "remote-token");
  assert.equal(callbackCalls[0]?.body.status, "completed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: FAIL because `prepareRemoteEvaluationTask()` and `executeAcceptedRemoteEvaluationTask()` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export type AcceptedRemoteEvaluationTask = {
  taskId: number;
  caseDir: string;
  message: string;
  remoteTask: RemoteEvaluationTask;
  workflowState: Record<string, unknown>;
};
```

```ts
export async function prepareRemoteEvaluationTask(
  remoteTask: RemoteEvaluationTask,
): Promise<AcceptedRemoteEvaluationTask> {
  // create caseDir + logger
  // run remoteTaskPreparationNode -> taskUnderstandingNode -> inputClassificationNode
  // persist known case-info fields
  // return the accepted task context without uploading callback
}
```

```ts
export async function executeAcceptedRemoteEvaluationTask(
  accepted: AcceptedRemoteEvaluationTask,
): Promise<void> {
  // resume workflow from ruleAuditNode
  // upload callback on completed / failed
  // cleanup remoteTaskRootDir in finally
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: PASS for acceptance-plus-callback flow once the service split and resumed workflow exist.

- [ ] **Step 5: Commit**

```bash
git add tests/remote-network-execution.test.ts src/service.ts src/workflow/scoreWorkflow.ts
git commit -m "feat: split remote task acceptance from execution"
```

### Task 4: Preserve The Existing Synchronous Service Contract

**Files:**
- Modify: `src/service.ts`
- Modify: `tests/remote-network-execution.test.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("runRemoteEvaluationTask still executes the full remote flow synchronously", async (t) => {
  const result = await runRemoteEvaluationTask(remoteTask);
  assert.equal(result.taskId, 4);
  assert.equal(callbackCalls.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: FAIL if the refactor removed or broke the original `runRemoteEvaluationTask()` behavior.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function runRemoteEvaluationTask(
  remoteTask: RemoteEvaluationTask,
): Promise<{ caseDir: string; taskId: number; uploadMessage?: string }> {
  const accepted = await prepareRemoteEvaluationTask(remoteTask);
  const uploadMessage = await executeAcceptedRemoteEvaluationTask(accepted);
  return {
    caseDir: accepted.caseDir,
    taskId: accepted.taskId,
    uploadMessage,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: PASS for both the new split API and the old synchronous service helper.

- [ ] **Step 5: Commit**

```bash
git add src/service.ts tests/remote-network-execution.test.ts
git commit -m "refactor: preserve synchronous remote task service"
```

### Task 5: Document The New HTTP Semantics

**Files:**
- Modify: `README.md`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing documentation assertion**

```ts
test("README documents async acknowledgment for run-remote-task", async () => {
  const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf-8");
  assert.match(readme, /任务接收成功，结果将通过 callback 返回/);
  assert.match(readme, /预处理阶段失败.*返回 500/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: FAIL because README still describes the endpoint as waiting for execution completion.

- [ ] **Step 3: Write minimal implementation**

````md
调用成功后，接口会在完成远端任务预处理与初始任务分析后立即返回：

```json
{
  "success": true,
  "taskId": 4,
  "caseDir": "/abs/path/.local-cases/full_generation_xxx",
  "message": "任务接收成功，结果将通过 callback 返回"
}
```

如果预处理阶段失败，例如远端目录清单下载失败或初始任务分析失败，接口会直接返回 `500`。
````

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/remote-network-execution.test.ts`
Expected: PASS for the README assertion and no regressions in the remote-task behavior tests.

- [ ] **Step 5: Commit**

```bash
git add README.md tests/remote-network-execution.test.ts
git commit -m "docs: describe async remote task acknowledgement"
```

## Self-Review

- Spec coverage: acceptance success, preprocessing failure, background execution, callback semantics, cleanup, and documentation are all covered by Tasks 1-5.
- Placeholder scan: no unfinished implementation markers remain; each task names exact files and commands.
- Type consistency: `prepareRemoteEvaluationTask`, `executeAcceptedRemoteEvaluationTask`, and `runRemoteEvaluationTask` are used consistently across handler, service, and tests.
