# Rule Violation Stats API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted stats index and `GET /score/rule-violation-stats` endpoint that reports only static rule violation aggregates.

**Architecture:** Store per-run snapshots in `<LOCAL_CASE_ROOT>/rule-violation-stats.json`, keyed idempotently by `taskId`. Extract only static rules by mapping `rule_id` through built-in registered rule packs. The API handler filters snapshots and returns `summary` plus `rules`, never `cases`.

**Tech Stack:** TypeScript, Express 5, Node `fs/promises`, Node test runner.

---

## File Map

- Create `src/api/ruleViolationStatsStore.ts`: file-backed snapshot store, extractor, query aggregation helpers.
- Modify `src/api/apiDefinitions.ts`: add `API_PATHS.ruleViolationStats` and interface documentation.
- Modify `src/api/app.ts`: mount `GET /score/rule-violation-stats`, create handler, and pass stats store into remote task execution.
- Modify `src/service.ts`: accept optional completion hook and call it after successful workflow result generation.
- Test `tests/rule-violation-stats.test.ts`: store idempotency, aggregation, filters, static-only behavior, empty index, invalid query.
- Update remote API tests only if compile errors reveal changed function signatures require fixture updates.

## Tasks

### Task 1: Add failing store and aggregation tests

- [ ] Create `tests/rule-violation-stats.test.ts` with tests for `createRuleViolationStatsStore`, `extractRuleViolationRunSnapshot`, and `buildRuleViolationStatsResponse`.
- [ ] Run `node --import tsx --test tests/rule-violation-stats.test.ts`; expected failure is missing module exports.

### Task 2: Implement stats store and extractor

- [ ] Create `src/api/ruleViolationStatsStore.ts`.
- [ ] Implement `RuleViolationRunSnapshot`, `createRuleViolationStatsStore(localCaseRoot)`, `extractRuleViolationRunSnapshot(input)`, and `buildRuleViolationStatsResponse(runs, query)`.
- [ ] Run `node --import tsx --test tests/rule-violation-stats.test.ts`; expected pass.

### Task 3: Add API handler and docs path

- [ ] Add `ruleViolationStats: "/score/rule-violation-stats"` to `API_PATHS`.
- [ ] Add API definition for `GET /score/rule-violation-stats`.
- [ ] Export and mount `createGetRuleViolationStatsHandler(store)` in `src/api/app.ts`.
- [ ] Add handler tests to `tests/rule-violation-stats.test.ts` using an Express app and `fetch`.
- [ ] Run `node --import tsx --test tests/rule-violation-stats.test.ts`; expected pass.

### Task 4: Write stats snapshots on completion

- [ ] Modify `executeAcceptedRemoteEvaluationTask` in `src/service.ts` to accept optional `onCompleted` hook with accepted task and workflow result.
- [ ] In `src/api/app.ts`, pass a hook that extracts a snapshot and upserts it into the stats store after successful execution.
- [ ] Add or update tests proving completion writes stats and duplicate task id does not double count.
- [ ] Run focused remote/API stats tests.

### Task 5: Final verification

- [ ] Run `npm test -- --test-reporter=spec` or focused equivalent if full suite is too slow.
- [ ] Run `npm run build`.
- [ ] Review diff against spec: static-only, no `cases`, file-backed, filters, empty stats, invalid query.
