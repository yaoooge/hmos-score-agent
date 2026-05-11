# Hvigor Build Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hvigor build verification to the official linter node and cap scores at 59 when changed HarmonyOS modules cannot compile.

**Architecture:** Extend the existing official linter pipeline with a focused hvigor helper module that detects changed modules from `src/main`, resolves command kind from each module `hvigorfile.ts/js`, executes `hvigorw`, records artifacts, and cleans workspace build products. Pass the build check summary through workflow state into score fusion and report generation.

**Tech Stack:** TypeScript, Node.js `node:test`, child process `spawn`, existing LangGraph state and report schema.

---

## File Structure

- Create `src/rules/officialCodeLinter/hvigorBuildCheck.ts`: module detection, hvigorfile target detection, command execution, output truncation, cleanup, and summary generation.
- Modify `src/config.ts`: add official tool root and hvigor timeout config with fallback from `HMOS_CODE_LINTER_RUN_DIR`.
- Modify `src/types.ts`: add hvigor build check types and extend `ScoreComputation` input support.
- Modify `src/workflow/state.ts`: add hvigor build check state annotations.
- Modify `src/nodes/officialCodeLinterNode.ts`: run hvigor build check inside the linter node and write artifacts.
- Modify `src/scoring/scoreFusion.ts` and `src/nodes/scoreFusionOrchestrationNode.ts`: apply `BUILD-CHECK` cap and risk.
- Modify `src/nodes/reportGenerationNode.ts`: emit `build_check_enabled` and `build_check_summary`.
- Modify `references/scoring/report_result_schema.json` and `tests/fixtures/report_result_schema.json`: allow `build_check_summary`.
- Add tests in `tests/official-code-linter-node.test.ts`, `tests/score-fusion.test.ts`, `tests/config-reference.test.ts`, and `tests/report-renderer.test.ts` where existing coverage is closest.

## Task 1: Config and Types

**Files:**
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/config-reference.test.ts`

- [ ] **Step 1: Write failing config test**

Add tests that set `HMOS_OFFICIAL_TOOL_RUN_DIR` and `HMOS_CODE_LINTER_RUN_DIR`, call `getConfig()`, and assert:

```ts
assert.equal(config.officialToolRunDir, toolRoot);
assert.equal(config.officialCodeLinterRunDir, path.join(toolRoot, "codelinter"));
assert.equal(config.hvigorBuildCheckRunDir, path.join(toolRoot, "hvigor"));
assert.equal(config.hvigorBuildCheckTimeoutMs, 300000);
```

- [ ] **Step 2: Run red test**

Run: `node --import tsx --test tests/config-reference.test.ts`
Expected: fail because config fields do not exist.

- [ ] **Step 3: Implement config and state types**

Add `officialToolRunDir`, `hvigorBuildCheckRunDir`, `hvigorBuildCheckTimeoutMs`; add `HvigorBuildCheckStatus`, `HvigorBuildCheckSummary`, `HvigorBuildCheckModuleResult`; annotate state.

- [ ] **Step 4: Run green test**

Run: `node --import tsx --test tests/config-reference.test.ts`
Expected: pass.

## Task 2: Hvigor Build Check Helper

**Files:**
- Create: `src/rules/officialCodeLinter/hvigorBuildCheck.ts`
- Test: `tests/official-code-linter-node.test.ts`

- [ ] **Step 1: Write failing module detection tests**

Add tests covering:

```ts
entry/src/main/ets/pages/Index.ets -> entry
features/feature1/src/main/ets/pages/Home.ets -> features/feature1
libs/common/src/main/ets/utils/Foo.ets -> libs/common
src/main/ets/pages/Index.ets -> .
README.md -> ignored
```

- [ ] **Step 2: Write failing hvigorfile command tests**

Create temporary module roots with `hvigorfile.ts` containing `hapTasks`, `harTasks`, or `hspTasks`; assert command kinds are `assembleHap`, `assembleHar`, and `assembleHsp`.

- [ ] **Step 3: Run red tests**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts`
Expected: fail because helper exports do not exist.

- [ ] **Step 4: Implement helper**

Implement exported functions:

```ts
export function detectChangedHarmonyModules(changedFiles: string[]): string[]
export async function detectHvigorModuleBuildTarget(workspaceDir: string, modulePath: string): Promise<"hap" | "har" | "hsp" | "unknown">
export async function runHvigorBuildCheck(input: HvigorBuildCheckInput): Promise<HvigorBuildCheckSummary>
```

Use `hvigorw --version`, module commands, per-command timeout, output truncation, and cleanup.

- [ ] **Step 5: Run green tests**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts`
Expected: pass for new helper tests.

## Task 3: Linter Node Integration

**Files:**
- Modify: `src/nodes/officialCodeLinterNode.ts`
- Test: `tests/official-code-linter-node.test.ts`

- [ ] **Step 1: Write failing integration tests**

Add tests using fake `codelinter` and fake `hvigorw`:

- disabled linter returns hvigor `not_enabled`;
- enabled linter runs `hvigorw --version` and one module command;
- failed module command sets hvigor status `failed` and writes `hvigor-summary.json`;
- cleanup removes `.hvigor`, `oh_modules`, and module `build`.

- [ ] **Step 2: Run red tests**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts`
Expected: fail because node does not run hvigor.

- [ ] **Step 3: Integrate helper**

Call `runHvigorBuildCheck` after workspace preparation. Return `hvigorBuildCheckStatus` and `hvigorBuildCheckSummary` in every branch.

- [ ] **Step 4: Run green tests**

Run: `node --import tsx --test tests/official-code-linter-node.test.ts`
Expected: pass.

## Task 4: Score Fusion Hard Gate

**Files:**
- Modify: `src/scoring/scoreFusion.ts`
- Modify: `src/nodes/scoreFusionOrchestrationNode.ts`
- Test: `tests/score-fusion.test.ts`

- [ ] **Step 1: Write failing score fusion test**

Call `fuseRubricScoreWithRules` with a high base score and `hvigorBuildCheckSummary.status = "failed"`; assert:

```ts
assert.equal(result.totalScore, 59);
assert.equal(result.hardGateTriggered, true);
assert.match(result.hardGateReason ?? "", /BUILD-CHECK/);
assert.ok(result.risks.some((risk) => /编译/.test(risk.title + risk.description)));
```

- [ ] **Step 2: Run red test**

Run: `node --import tsx --test tests/score-fusion.test.ts`
Expected: fail because score fusion ignores hvigor.

- [ ] **Step 3: Implement cap and risk**

Add optional `hvigorBuildCheckSummary` to fusion input, apply score cap 59, append `BUILD-CHECK` reason and a high risk.

- [ ] **Step 4: Run green test**

Run: `node --import tsx --test tests/score-fusion.test.ts`
Expected: pass.

## Task 5: Report and Schema

**Files:**
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `references/scoring/report_result_schema.json`
- Modify: `tests/fixtures/report_result_schema.json`
- Test: `tests/report-renderer.test.ts`

- [ ] **Step 1: Write failing report/schema test**

Build a result with hvigor summary and assert `basic_info.build_check_enabled === true` and `build_check_summary.status === "success"` validates against schema.

- [ ] **Step 2: Run red test**

Run: `node --import tsx --test tests/report-renderer.test.ts`
Expected: fail because report omits `build_check_summary`.

- [ ] **Step 3: Implement report output and schema**

Map camelCase summary to snake_case JSON and include it as top-level `build_check_summary`.

- [ ] **Step 4: Run green test**

Run: `node --import tsx --test tests/report-renderer.test.ts`
Expected: pass.

## Task 6: Full Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --import tsx --test tests/config-reference.test.ts tests/official-code-linter-node.test.ts tests/score-fusion.test.ts tests/report-renderer.test.ts
```

Expected: all pass.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: TypeScript compile passes.

- [ ] **Step 3: Run full test suite if focused tests and build pass**

Run: `npm test`
Expected: all pass.
