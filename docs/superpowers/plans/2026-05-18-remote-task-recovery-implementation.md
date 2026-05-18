# Remote Task Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover queued and running remote scoring tasks after service restart.

**Architecture:** Keep `remote-task-index.json` lightweight by storing only task status and a `remoteTaskFile` pointer. Persist each full `RemoteEvaluationTask` under `<caseDir>/inputs/remote-task.json`, extract the in-memory remote execution queue so HTTP submission and startup recovery share concurrency control, and recover non-terminal records by either replaying completed callbacks from `outputs/result.json` or re-enqueueing the saved task payload.

**Tech Stack:** TypeScript, Node.js `node:test`, Express handler functions, JSON artifact storage.

---

### Task 1: Registry Recovery Pointers

**Files:**
- Modify: `src/api/remoteTaskRegistry.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing test**

Add a test named `remote task registry persists only lightweight recovery pointers` that upserts `remoteTaskFile`, `recoveryAttemptCount`, and `lastRecoveryAt`, verifies `remote-task-index.json` contains the pointer, and verifies it does not contain the large prompt text stored in `<caseDir>/inputs/remote-task.json`.

- [ ] **Step 2: Run red**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: fail because registry patch/record types do not persist the new fields.

- [ ] **Step 3: Implement**

Add `remoteTaskFile?: string`, `recoveryAttemptCount?: number`, and `lastRecoveryAt?: number` to `RemoteTaskRecord` and `RemoteTaskRecordPatch`, and preserve them in `upsert`.

- [ ] **Step 4: Run green**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: pass.

### Task 2: Case-Local Remote Payload

**Files:**
- Modify: `src/service.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing test**

Add `acceptRemoteEvaluationTask writes remote task payload into case inputs`, asserting `<caseDir>/inputs/remote-task.json` equals the accepted `RemoteEvaluationTask`.

- [ ] **Step 2: Run red**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: fail with missing `remote-task.json`.

- [ ] **Step 3: Implement**

Export `REMOTE_TASK_PAYLOAD_FILE = "inputs/remote-task.json"` from `src/service.ts` and write the remote task JSON during `acceptRemoteEvaluationTask` immediately after case metadata is written.

- [ ] **Step 4: Run green**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: pass.

### Task 3: Restore And Replay Helpers

**Files:**
- Modify: `src/service.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for `restoreAcceptedRemoteEvaluationTask` rebuilding an accepted task from `inputs/remote-task.json`, and `replayCompletedRemoteTaskCallback` reading `outputs/result.json` and sending the normal completed callback payload.

- [ ] **Step 2: Run red**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: fail with missing exports.

- [ ] **Step 3: Implement**

Add helper code in `src/service.ts` to read persisted task payloads, rebuild `{ stage: "accepted", caseDir }` tasks, and replay completed callbacks using the existing callback payload builder.

- [ ] **Step 4: Run green**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: pass.

### Task 4: Shared Queue Recovery

**Files:**
- Modify: `src/api/app.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for exported `createRemoteTaskExecutionQueue`: completed recovery replays callback without executing workflow, queued recovery re-enqueues unfinished payloads, and missing payload marks the record failed.

- [ ] **Step 2: Run red**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: fail with missing `createRemoteTaskExecutionQueue`.

- [ ] **Step 3: Implement**

Extract the handler’s in-memory queue into `createRemoteTaskExecutionQueue`, preserving current concurrency and status behavior. Add `recoverPendingRemoteTasks()` that scans `preparing`, `queued`, and `running` records, uses `outputs/result.json` first, otherwise restores and enqueues the task.

- [ ] **Step 4: Run green**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: pass.

### Task 5: Handler Pointer Persistence And Startup Recovery

**Files:**
- Modify: `src/api/app.ts`
- Test: `tests/remote-network-execution.test.ts`, `tests/rule-violation-stats.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving the HTTP handler stores `remoteTaskFile` without prompt text in the registry, and `createApp()` starts background recovery.

- [ ] **Step 2: Run red**

Run `node --import tsx --test tests/remote-network-execution.test.ts`.
Expected: fail because handler does not write the pointer and app does not start recovery.

- [ ] **Step 3: Implement**

Write `remoteTaskFile: REMOTE_TASK_PAYLOAD_FILE` on registry upserts for accepted, queued, and running tasks. Make `createApp()` create one shared queue, pass it to `createRunRemoteTaskHandler`, and call `recoverPendingRemoteTasks()` in a caught background promise.

- [ ] **Step 4: Run green**

Run `node --import tsx --test tests/remote-network-execution.test.ts tests/rule-violation-stats.test.ts`.
Expected: pass.

### Task 6: Final Verification

**Files:**
- Verify only.

- [ ] Run `node --import tsx --test tests/remote-network-execution.test.ts tests/rule-violation-stats.test.ts tests/dashboard-api.test.ts tests/human-review-ingestion.test.ts`.
- [ ] Run `npm run build`.
- [ ] Run `git status --short`.

---

## Self-Review

Spec coverage: the plan covers lightweight registry pointers, case-local payload persistence, completed result replay, unfinished task re-enqueue, missing payload failure, startup recovery, and focused verification.

Placeholder scan: no task contains unresolved placeholders.

Type consistency: the plan consistently uses `remoteTaskFile`, `REMOTE_TASK_PAYLOAD_FILE`, `restoreAcceptedRemoteEvaluationTask`, `replayCompletedRemoteTaskCallback`, and `createRemoteTaskExecutionQueue`.
