# Remote Task Preprocessing Start Acknowledgement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return HTTP success as soon as remote task preprocessing starts, omit `caseDir` from the immediate response, and report all later preprocessing or execution errors through callback `failed` status.

**Architecture:** Split remote service flow into early acceptance, background preparation, and prepared execution. The HTTP handler calls only the early acceptance function before responding, then queues the existing execution function, which prepares if needed and wraps all post-ack failures in failed callback upload.

**Tech Stack:** TypeScript, Node.js `node:test`, Express handler tests, existing `ArtifactStore`, `CaseLogger`, and callback uploader.

---

## File Structure

- Modify `src/service.ts`: add early acceptance support, support partially accepted tasks, and move post-ack preparation failures into callback failure handling.
- Modify `src/index.ts`: change `/score/run-remote-task` to call the early acceptance function and omit `caseDir` from immediate response.
- Modify `tests/remote-network-execution.test.ts`: add red tests for early ack, missing `caseDir`, preprocessing failure callback, and execution failure callback.

## Task 1: Add Early-Ack HTTP Regression Test

**Files:**
- Modify: `tests/remote-network-execution.test.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing HTTP test**

Add `acceptRemoteEvaluationTask` to the service imports and add this test near the existing handler tests:

```ts
test("createRunRemoteTaskHandler returns success before remote preprocessing finishes", async () => {
  let executeStarted = false;
  let releaseExecution: (() => void) | undefined;
  const deps = {
    runSingleCase: async () => ({ caseDir: "/tmp/local-case" }),
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
    runRemoteEvaluationTask: async () => {
      throw new Error("runRemoteEvaluationTask should not be used by the HTTP handler");
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: FAIL because `createRunRemoteTaskHandler` does not call `acceptRemoteEvaluationTask` and the HTTP response still includes `caseDir`.

## Task 2: Implement Early Acceptance Service API

**Files:**
- Modify: `src/service.ts`
- Modify: `src/index.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Add the service API and handler dependency**

In `src/service.ts`, introduce accepted-stage typing and export `acceptRemoteEvaluationTask(remoteTask, deps)` that performs the initial case creation, metadata write, and logs `远端任务预处理开始`. Keep `prepareRemoteEvaluationTask()` by calling `acceptRemoteEvaluationTask()` and then the new preparation helper.

In `src/index.ts`, import `acceptRemoteEvaluationTask`, add it to `AppDeps`, include it in `createApp()` defaults, and make the handler call `deps.acceptRemoteEvaluationTask()` instead of `deps.prepareRemoteEvaluationTask()`.

The immediate response body should be:

```ts
{
  success: true,
  taskId: acceptedTask.taskId,
  message: acceptedTask.message,
}
```

- [ ] **Step 2: Run the HTTP early-ack test**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: PASS for the early-ack regression, with possible failures in older tests that still expect `caseDir` or synchronous preprocessing failure.

## Task 3: Report Preprocessing Failures Through Callback

**Files:**
- Modify: `tests/remote-network-execution.test.ts`
- Modify: `src/service.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Replace the old preprocessing HTTP 500 expectation**

Replace the test named `createRunRemoteTaskHandler returns 500 when preprocessing fails` with a test that uses `acceptRemoteEvaluationTask()` to acknowledge successfully, makes background execution throw from preparation, and asserts callback receives `failed`.

The test should assert:

```ts
assert.equal(responseState.statusCode, 200);
assert.equal(responseState.body?.success, true);
assert.equal("caseDir" in (responseState.body ?? {}), false);
assert.equal(callbackCalls.at(-1)?.body.status, "failed");
assert.match(String(callbackCalls.at(-1)?.body.errorMessage ?? ""), /download original manifest failed/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: FAIL until `executeAcceptedRemoteEvaluationTask()` prepares accepted-only tasks and catches preparation errors for failed callback upload.

- [ ] **Step 3: Implement background preparation failure callback**

Update `executeAcceptedRemoteEvaluationTask()` so it can receive an accepted-only task. If `workflowState.stage === "accepted"`, call a helper that runs `remoteTaskPreparationNode`, `taskUnderstandingNode`, and `inputClassificationNode`. Wrap that combined preparation and execution block in the existing `try/catch`; the `catch` already uploads `failed` callback with `errorMessage`.

- [ ] **Step 4: Run the remote test file**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: PASS for preprocessing failure callback behavior.

## Task 4: Preserve Successful Remote Flow And Execution Failure Callback

**Files:**
- Modify: `tests/remote-network-execution.test.ts`
- Modify: `src/service.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Add execution failure callback test**

Add a service-level test that prepares a real remote task using mock fetch and an opencode runner that throws during `rubric-scoring-*`. Then call `executeAcceptedRemoteEvaluationTask(accepted)` and assert it rejects and uploads a final `failed` callback with the thrown error.

- [ ] **Step 2: Run the test and verify current behavior**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: PASS if existing execution failure catch already uploads failed; otherwise FAIL with missing failed callback.

- [ ] **Step 3: Keep success sequence intact**

Ensure existing successful remote tests still expect callback statuses:

```ts
["pending", "running", "running", "completed"]
```

For HTTP handler success assertions, remove `caseDir` checks and assert it is absent.

- [ ] **Step 4: Run the remote test file**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: PASS for all remote-network tests.

## Task 5: Final Verification

**Files:**
- Modify: `src/service.ts`
- Modify: `src/index.ts`
- Modify: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Run focused tests**

Run: `npm test -- tests/remote-network-execution.test.ts`

Expected: exit code 0, all tests pass.

- [ ] **Step 2: Inspect diff**

Run: `git diff -- src/service.ts src/index.ts tests/remote-network-execution.test.ts`

Expected: diff only changes remote task early ack, callback failure handling, and corresponding tests.

- [ ] **Step 3: Commit implementation**

```bash
git add src/service.ts src/index.ts tests/remote-network-execution.test.ts
git commit -m "fix: acknowledge remote tasks before preprocessing completes"
```

---

## Self-Review

- Spec coverage: immediate success at preprocessing start is Task 1 and Task 2; response omits `caseDir` is Task 1 and Task 3; preprocessing failure callback is Task 3; execution failure callback is Task 4; synchronous compatibility is covered by existing success tests preserved in Task 4.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: the plan uses `acceptRemoteEvaluationTask`, `prepareRemoteEvaluationTask`, and `executeAcceptedRemoteEvaluationTask` consistently across service, handler, and tests.
