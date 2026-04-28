# Remote Result Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace large completed callback result bodies with a lightweight overview and expose a token-protected result endpoint that returns the full `result.json` as `resultData`.

**Architecture:** Add a small API definition module for route visibility, a JSON-file-backed remote task registry under `LOCAL_CASE_ROOT`, and a GET handler that resolves `taskId` to `caseDir/outputs/result.json`. Keep remote task execution behavior unchanged except callback `resultData` shape and removal of `caseDir` from callbacks.

**Tech Stack:** TypeScript, Express 5, Node `fs/promises`, Node test runner.

---

### Task 1: API Definitions and Result Handler Tests

**Files:**
- Create: `src/api/apiDefinitions.ts`
- Create: `src/api/remoteTaskRegistry.ts`
- Modify: `src/index.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing tests for route definitions and result endpoint behavior**

Add tests to `tests/remote-network-execution.test.ts` that import `API_DEFINITIONS`, `API_PATHS`, `createRemoteTaskRegistry`, and `createGetRemoteTaskResultHandler`. The tests should assert:

```ts
assert.ok(
  API_DEFINITIONS.some(
    (api) => api.method === "GET" && api.path === "/score/remote-tasks/:taskId/result",
  ),
);
assert.equal(API_PATHS.remoteTaskResult, "/score/remote-tasks/:taskId/result");
```

Then create a temp `LOCAL_CASE_ROOT`, write `outputs/result.json`, upsert a completed registry record, and call `createGetRemoteTaskResultHandler(registry)` with `params.taskId` and `header("token")`. Assert `200`, `success: true`, and `body.resultData.overall_conclusion.total_score` match the file.

Also add result endpoint error tests for wrong token (`401`), running task (`409`), and unknown task (`404`).

- [ ] **Step 2: Run tests and verify RED**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: FAIL because `src/api/apiDefinitions.ts`, `src/api/remoteTaskRegistry.ts`, and `createGetRemoteTaskResultHandler` do not exist.

- [ ] **Step 3: Implement API definitions, registry, and result handler**

Create `src/api/apiDefinitions.ts` with:

```ts
export type ApiMethod = "GET" | "POST" | "OPTIONS";

export type ApiDefinition = {
  method: ApiMethod;
  path: string;
  description: string;
};

export const API_PATHS = {
  health: "/health",
  scoreRun: "/score/run",
  runRemoteTask: "/score/run-remote-task",
  remoteTaskResult: "/score/remote-tasks/:taskId/result",
} as const;

export const API_DEFINITIONS: ApiDefinition[] = [
  { method: "GET", path: API_PATHS.health, description: "Service health check." },
  { method: "POST", path: API_PATHS.scoreRun, description: "Run one local score case." },
  {
    method: "POST",
    path: API_PATHS.runRemoteTask,
    description: "Accept one remote evaluation task and execute it asynchronously.",
  },
  {
    method: "GET",
    path: API_PATHS.remoteTaskResult,
    description: "Read the completed remote task result JSON as resultData.",
  },
];
```

Create `src/api/remoteTaskRegistry.ts` with a file-backed registry using `<localCaseRoot>/remote-task-index.json`. It should export `RemoteTaskRecord`, `RemoteTaskRecordStatus`, `RemoteTaskRegistry`, and `createRemoteTaskRegistry(localCaseRoot)`.

Modify `src/index.ts` to export `createGetRemoteTaskResultHandler(registry)` and register `app.get(API_PATHS.remoteTaskResult, ...)` in `createApp`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: result handler and API definition tests pass or fail only on callback behavior not yet implemented.

### Task 2: Completed Callback Lightweight ResultData

**Files:**
- Modify: `src/service.ts`
- Modify: `src/index.ts`
- Modify: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing tests for callback body shape**

Update the existing remote execution callback test so it asserts:

```ts
const finalResultData = finalCallback?.body.resultData as Record<string, unknown>;
assert.equal(finalResultData.phase, "completed");
assert.equal(finalResultData.resultMode, "api");
assert.equal("resultUrl" in finalResultData, false);
assert.equal("overall_conclusion" in finalResultData, false);
assert.equal("caseDir" in finalResultData, false);
const overview = finalResultData.overview as Record<string, unknown>;
assert.equal(overview.testCaseId, 8);
assert.equal(overview.totalScore, resultJson.overall_conclusion.total_score);
assert.equal(overview.maxScore, 100);
assert.equal(typeof overview.hardGateTriggered, "boolean");
assert.equal(typeof overview.reviewRequired, "boolean");
assert.equal(typeof overview.riskCount, "number");
assert.equal(typeof overview.humanReviewItemCount, "number");
```

Also assert every callback `resultData` lacks `caseDir`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: FAIL because completed callback still includes full `result.json`, and pending/running callbacks still include `caseDir`.

- [ ] **Step 3: Implement lightweight callback builder**

In `src/service.ts`, add helpers to build completed `resultData` from `remoteTask` and `resultJson`, and update `buildRemoteCallbackPayload` to compute `totalScore` from either `resultData.overview.totalScore` or legacy `overall_conclusion.total_score`.

Remove `caseDir` from pending/running `resultData`. Keep phase names and callback call order unchanged.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: callback shape tests pass.

### Task 3: Persistent Registry Integration

**Files:**
- Modify: `src/index.ts`
- Modify: `src/service.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing test for restart-compatible result lookup**

Add a test that creates a registry, upserts a completed record, creates a second registry pointing at the same temp root, and verifies `createGetRemoteTaskResultHandler(secondRegistry)` can return the result. This proves the handler can read records persisted before the current registry instance existed.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: FAIL until the registry writes and reloads `remote-task-index.json`.

- [ ] **Step 3: Persist remote task records during HTTP execution**

Use one shared registry instance inside `createApp`. Pass it to `createRunRemoteTaskHandler` and `createGetRemoteTaskResultHandler`. On task accept, queued, running, completed, and failed transitions, call `registry.upsert(...)` with `taskId`, `caseDir`, `token`, `testCaseId`, and status.

Pass the registry into `executeAcceptedRemoteEvaluationTask` so it can mark a task completed before sending the completed callback. This avoids a race where the remote system receives completed callback and immediately GETs the result while the HTTP handler still has status `running`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: all remote network execution tests pass.

### Task 4: Full Verification

**Files:**
- All modified task files

- [ ] **Step 1: Typecheck/build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Targeted test suite**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`

Expected: PASS.

- [ ] **Step 3: Full test suite if targeted checks are clean**

Run: `npm test`

Expected: PASS, unless unrelated pre-existing worktree changes have introduced failures. Any failure must be reported with the failing test name and reason.
