# Architecture Structure Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the project source tree according to the approved architecture refactor spec without changing runtime behavior, API contracts, scoring behavior, or local case artifacts.

**Architecture:** Move implementation files into stable ownership domains: `interfaces`, `commons`, `workflow/graph`, per-node `workflow/nodes`, `agents`, and `datasets`. Preserve behavior by moving files first, then updating imports and adding focused index/facade exports only where they document the new boundaries.

**Tech Stack:** TypeScript ESM with NodeNext module resolution, Express, LangGraph, node:test, SQLite via `node:sqlite`, npm scripts.

---

### Task 1: Move API Contract Files

**Files:**
- Create: `src/interfaces/api.d.ts`
- Create: `src/interfaces/index.ts`
- Create: `src/interfaces/http/apiDefinitions.ts`
- Move: `src/api/apiDefinitions.ts` to `src/interfaces/http/apiDefinitions.ts`
- Modify: imports of `apiDefinitions.js`

- [ ] Move `src/api/apiDefinitions.ts` into `src/interfaces/http/apiDefinitions.ts`.
- [ ] Add `src/interfaces/api.d.ts` exporting API definitions and major contracts.
- [ ] Add `src/interfaces/index.ts`.
- [ ] Update all imports from `src/api/apiDefinitions.js` to the new interface path.
- [ ] Run `npm run build` and fix TypeScript import issues.

### Task 2: Move Commons Utilities and IO

**Files:**
- Move: `src/io/*` into `src/commons/io/*` or `src/commons/utils/*`
- Create: `src/commons/index.ts`
- Create: `src/commons/io/index.ts`
- Create: `src/commons/utils/index.ts`
- Modify: imports from `../io/*`

- [ ] Move runtime IO files into `src/commons/io/`.
- [ ] Move utility-style files into `src/commons/utils/`.
- [ ] Update imports across `src/`, `tests/`, and `scripts/`.
- [ ] Run focused IO tests: `node --import tsx --test tests/gitignore-matcher.test.ts tests/patch-generator.test.ts`.
- [ ] Run `npm run build`.

### Task 3: Move Agents, Opencode, and Trace

**Files:**
- Move: `src/agent/*` into `src/agents/runners`, `src/agents/prompts`, or `src/agents/normalization`
- Move: `src/opencode/*` into `src/agents/opencode` or `src/commons/utils/finalJson.ts`
- Move: `src/agentTrace/*` into `src/agents/trace`
- Create: `src/agents/index.ts`
- Modify: imports across workflow, nodes, service, api, tests

- [ ] Move opencode runtime files.
- [ ] Move agent prompt/runner/normalization files.
- [ ] Move agent trace files.
- [ ] Update imports.
- [ ] Run agent-focused tests: `node --import tsx --test tests/opencode-*.test.ts tests/agent-trace.test.ts tests/agent-trace-dashboard-api.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts tests/opencode-task-understanding.test.ts`.
- [ ] Run `npm run build`.

### Task 4: Move Datasets and SQLite

**Files:**
- Move: `src/storage/*` into `src/datasets/sqlite/*`
- Move: `src/dashboard/*` into `src/datasets/dashboard/*`
- Move: `src/humanReview/*` into `src/datasets/humanReview/*`
- Move: `src/humanRating/*` into `src/datasets/humanRating/*`
- Move: `src/api/ruleViolationStatsRebuild.ts` into `src/datasets/ruleViolation/statsRebuild.ts`
- Create: `src/datasets/index.ts`
- Modify: imports across API, scripts, tests, web-adjacent tests

- [ ] Move SQLite files.
- [ ] Move dashboard data files.
- [ ] Move human review and rating files.
- [ ] Move rule violation stats rebuild logic.
- [ ] Update imports.
- [ ] Run dataset/API tests: `node --import tsx --test tests/sqlite-storage.test.ts tests/dashboard-api.test.ts tests/human-review-ingestion.test.ts tests/human-rating-manual-api.test.ts tests/rule-violation-stats.test.ts`.
- [ ] Run `npm run build`.

### Task 5: Move Workflow Graph and Nodes

**Files:**
- Move: `src/workflow/scoreWorkflow.ts` to `src/workflow/graph/scoreWorkflow.ts`
- Move: `src/workflow/state.ts` to `src/workflow/graph/state.ts`
- Move: each `src/nodes/<name>Node.ts` into `src/workflow/nodes/<node-name>/index.ts`
- Create: each node's `types.ts` and `tools.ts`
- Create: `src/workflow/index.ts`, `src/workflow/graph/index.ts`, `src/workflow/nodes/index.ts`
- Modify: imports across service, tests, nodes, observability

- [ ] Move graph files.
- [ ] Move every node file into a consistent node directory.
- [ ] Add empty `types.ts` and `tools.ts` files with `export {};` for nodes that do not yet need extracted private helpers.
- [ ] Update imports.
- [ ] Run workflow/node tests: `node --import tsx --test tests/score-workflow-topology.test.ts tests/workflow-*.test.ts tests/*-node.test.ts tests/task-understanding-node.test.ts tests/input-classification-node.test.ts`.
- [ ] Run `npm run build`.

### Task 6: Add Domain Indexes and Keep Domain Directories

**Files:**
- Create: `src/rules/index.ts`
- Create: `src/scoring/index.ts`
- Create: `src/report/index.ts`
- Create: `src/report/html/index.ts`
- Preserve: `src/rules`, `src/scoring`, `src/report`

- [ ] Add index exports for retained domain directories.
- [ ] Ensure no rules/scoring/report files were incorrectly merged into workflow nodes.
- [ ] Run domain tests: `node --import tsx --test tests/rule-engine.test.ts tests/scoring.test.ts tests/score-fusion.test.ts tests/report-renderer.test.ts`.

### Task 7: Update Service, API Paths, and Docs

**Files:**
- Modify: `src/service.ts` or create service facade files if needed for behavior-preserving structure.
- Modify: `src/api/app.ts` imports.
- Modify: `src/index.ts`
- Modify: `src/cli.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/README.md` if architecture links or directory descriptions need adjustment.

- [ ] Keep service runtime behavior stable while updating imports.
- [ ] Keep `docs/apis/openapi.yaml` in place.
- [ ] Update architecture documentation to reflect new source layout and boundaries.
- [ ] Run `npm run build`.

### Task 8: Full Verification and E2E Remote Case

**Files:**
- No source files unless verification finds a structural bug.

- [ ] Run `npm test`.
- [ ] Run `npm run lint`.
- [ ] Start the API with `npm run dev:api`.
- [ ] Locate the latest remote case under `.local-cases/`.
- [ ] Submit or replay that latest remote task through the running API.
- [ ] Verify the resulting task reaches completed status or produces the same expected recoverable status as before the refactor.
- [ ] Verify result artifact availability through the API.
- [ ] Stop the dev server.
- [ ] Confirm `git status --short` only contains intended project changes.
