# SQLite Storage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the growing JSON index files with a local SQLite-backed query/index layer while keeping original case artifacts on disk.

**Architecture:** Add a small `node:sqlite` wrapper and SQLite-backed implementations for the existing stores. Keep public store interfaces compatible first, then add dashboard summary helpers so existing HTTP routes can switch without frontend protocol changes.

**Tech Stack:** TypeScript, Node `node:sqlite`, node:test, Express.

---

### Task 1: SQLite Core

**Files:**
- Create: `src/storage/sqliteDatabase.ts`
- Test: `tests/sqlite-storage.test.ts`

- [x] Add tests for schema initialization, WAL mode, transactions, and close.
- [x] Implement `createScoreDatabase(dbPath)` with schema migrations.
- [x] Run `node --import tsx --test tests/sqlite-storage.test.ts`.

### Task 2: SQLite Store Implementations

**Files:**
- Create: `src/storage/sqliteStores.ts`
- Modify: `src/api/remoteTaskRegistry.ts`
- Modify: `src/api/ruleViolationStatsStore.ts`
- Modify: `src/api/consistencyTaskStore.ts`
- Test: `tests/sqlite-storage.test.ts`

- [x] Add failing tests proving SQLite stores preserve the existing JSON store behavior.
- [x] Implement SQLite-backed remote task registry, rule violation stats store, and consistency task store.
- [x] Keep existing JSON stores available as compatibility helpers.
- [x] Run focused store tests.

### Task 3: Dashboard SQLite Query Surface

**Files:**
- Create: `src/dashboard/sqliteDashboardStore.ts`
- Modify: `src/dashboard/dashboardHandlers.ts`
- Test: `tests/sqlite-storage.test.ts`

- [x] Add tests for task list, status counts, daily report, and score distribution from SQLite without reading result files during query.
- [x] Implement dashboard query helpers over `remote_task`.
- [x] Route dashboard handlers through the SQLite helpers when available.

### Task 4: App Wiring And Backfill

**Files:**
- Modify: `src/api/app.ts`
- Create: `src/storage/sqliteBackfill.ts`
- Test: `tests/sqlite-storage.test.ts`
- Test: existing API tests as needed

- [x] Add tests for backfilling JSON indexes into SQLite.
- [x] Wire `createApp()` to create SQLite-backed stores under `localCaseRoot`.
- [x] Ensure remote task completion updates task summary and rule stats.
- [x] Run focused API tests.

### Task 5: Verification

- [x] Run `npm run build`.
- [x] Run focused tests for storage, dashboard, rule violation stats, consistency tasks, and remote network execution.
- [x] Run `npm test` if feasible.
