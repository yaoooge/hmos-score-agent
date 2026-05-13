# Dashboard Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Dashboard read-only APIs and Vue3 + Element Plus frontend described in `docs/superpowers/specs/2026-05-13-dashboard-frontend-design.md`.

**Architecture:** Add a focused `src/dashboard/` backend module that reads the existing file-backed task registry, result JSON files, rule stats, human rating JSONL, and run logs. Add a `web/` Vite application mounted at `/dashboard/` with hash routing so UI routes do not conflict with `/dashboard/xxx` APIs.

**Tech Stack:** TypeScript, Express 5, node:test, Vue3, Vite, Element Plus, ECharts.

---

## File Structure

- Modify `src/api/remoteTaskRegistry.ts`: add `testCaseName`, `testCaseType`, and `list()`.
- Modify `src/api/app.ts`: persist remote test case name/type, mount Dashboard API routes, serve `web/dist` at `/dashboard/`.
- Modify `src/api/apiDefinitions.ts`: add Dashboard path constants for documentation-level discoverability.
- Create `src/dashboard/dashboardTypes.ts`: shared DTOs and query types.
- Create `src/dashboard/dashboardDataStore.ts`: safe file readers for task summaries, result JSON, logs, and human rating JSONL.
- Create `src/dashboard/dashboardAggregates.ts`: pure aggregation/filtering/pagination functions.
- Create `src/dashboard/dashboardHandlers.ts`: Express handlers for `/dashboard/xxx`.
- Create `tests/dashboard-api.test.ts`: TDD coverage for registry listing, summary, task list, logs, reports, human rating gaps, negative results, and static serving path constants.
- Modify `package.json`: add dashboard scripts and frontend dependencies through `web/package.json`.
- Create `web/`: Vite Vue3 frontend with Element Plus, ECharts, task list, report charts, analysis tables, and log drawer.
- Modify `scripts/aliyun-single-instance-deploy.sh`: install/build frontend and expose Dashboard after deployment.

## Task 1: Registry Listing and Metadata

- [ ] Write failing tests in `tests/dashboard-api.test.ts` proving `RemoteTaskRegistry.list()` returns sorted records and preserves `testCaseName`/`testCaseType`.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`; expected failure: `list` is missing and metadata fields are ignored.
- [ ] Implement `RemoteTaskRegistry.list()` and metadata persistence in `src/api/remoteTaskRegistry.ts`.
- [ ] Update `src/api/app.ts` to pass `testCase.name` and `testCase.type` into registry upserts.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`; expected pass for Task 1 tests.

## Task 2: Dashboard Aggregates and API Handlers

- [ ] Add failing tests for `/dashboard/summary`, `/dashboard/tasks`, `/dashboard/tasks/:taskId/logs`, `/dashboard/reports/daily`, `/dashboard/reports/score-distribution`, `/dashboard/analysis/human-rating-gaps`, and `/dashboard/analysis/negative-results`.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`; expected failure because `src/dashboard/*` handlers do not exist.
- [ ] Implement `dashboardTypes`, `dashboardDataStore`, `dashboardAggregates`, and `dashboardHandlers`.
- [ ] Mount Dashboard handlers in `createApp()`.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`; expected pass.

## Task 3: Dashboard API Definitions and Static Serving

- [ ] Add failing tests that `API_PATHS` exposes Dashboard paths and `createApp()` serves `/dashboard/` static assets without swallowing `/dashboard/summary`.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`; expected failure until path constants and static serving are implemented.
- [ ] Update `src/api/apiDefinitions.ts` and `src/api/app.ts`.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`; expected pass.

## Task 4: Frontend Scaffold and API Client

- [ ] Create `web/package.json`, Vite config, TypeScript config, and Vue entry files.
- [ ] Add root scripts: `dev:dashboard`, `build:dashboard`, `preview:dashboard`, `build:all`.
- [ ] Implement `web/src/api/dashboard.ts` with typed fetch helpers for all `/dashboard/xxx` APIs.
- [ ] Run `npm --prefix web install` if dependencies are missing.
- [ ] Run `npm run build:dashboard`; expected pass after frontend scaffold compiles.

## Task 5: Frontend Pages

- [ ] Implement `DashboardLayout.vue`, `TaskDashboard.vue`, `CaseReports.vue`, `ResultAnalysis.vue`, `EChartPanel.vue`, `MetricCard.vue`, and `TaskStatusTag.vue`.
- [ ] Ensure task page includes status counts, task type counts, table filters, and log Drawer.
- [ ] Ensure report page uses ECharts for daily counts, completed/failed trend, average score, and score buckets.
- [ ] Ensure analysis page shows human rating gap and negative result tabs.
- [ ] Run `npm run build:dashboard`; expected pass.

## Task 6: Deployment Script and Verification

- [ ] Update `scripts/aliyun-single-instance-deploy.sh` to install frontend dependencies with `npm install` under `web/` and run `npm run build:dashboard`.
- [ ] Run `npm run build`.
- [ ] Run `npm run build:dashboard`.
- [ ] Run `node --import tsx --test tests/dashboard-api.test.ts`.
- [ ] Run targeted existing tests impacted by registry/API changes: `node --import tsx --test tests/remote-network-execution.test.ts tests/rule-violation-stats.test.ts tests/human-review-ingestion.test.ts`.
- [ ] Run `npm test`; record any pre-existing unrelated failures separately.

## Baseline Risk

Before implementation, full `npm test` in the isolated worktree reported 364 pass and 2 fail. The failing tests were existing non-Dashboard assertions in `tests/remote-network-execution.test.ts` and `tests/score-agent.test.ts`. Dashboard implementation must not expand this failure set.
