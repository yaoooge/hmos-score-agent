# Hvigor Deprecated API And ArkUI Extra Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect patch-introduced deprecated API warnings from hvigor output, add a default `arkui-extra` rule pack, and report route/bindSheet ArkUI issues deterministically.

**Architecture:** Extend hvigor build summary with parsed, patch-attributed deprecated API warnings, then let score fusion aggregate them into one medium risk. Add a new `arkui_extra` detector kind and evaluator for route-map `NavDestination` and chained `bindSheet` checks, backed by `references/rules/arkui-extra.yaml` and enabled by default.

**Tech Stack:** TypeScript, Node.js test runner, YAML rule packs, hvigor build summary, existing rule engine and score fusion pipeline.

---

### Task 1: Hvigor Deprecated API Warning Attribution

**Files:**
- Modify: `src/types.ts`
- Modify: `src/rules/officialCodeLinter/hvigorBuildCheck.ts`
- Test: `tests/official-code-linter-node.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that run `runHvigorBuildCheck` with fake `hvigorw` output containing:

```text
WARN: WARN: ArkTS:WARN File: /tmp/workspace/entry/src/main/ets/pages/Index.ets:9:18
 'showToast' has been deprecated.
```

The test should assert `deprecatedApiWarnings` contains a single warning when changed line 9 is in `changedLineNumbersByFile`, and contains no warning when the warning points to an unchanged line.

- [x] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test tests/official-code-linter-node.test.ts
```

Expected: fail because `deprecatedApiWarnings` and attribution logic do not exist.

- [x] **Step 3: Implement minimal parser and attribution**

Add `HvigorDeprecatedApiWarning` to `src/types.ts`. In `hvigorBuildCheck.ts`, strip ANSI escape codes, parse the two-line `ArkTS:WARN File:` warning shape, normalize absolute paths to workspace-relative paths, and keep only warnings whose file/line is in changed line data.

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/official-code-linter-node.test.ts
```

Expected: pass.

### Task 2: Deprecated API Medium Risk In Score Fusion

**Files:**
- Modify: `references/risks/risk-taxonomy.yaml`
- Modify: `src/scoring/scoreFusion.ts`
- Test: `tests/score-fusion.test.ts`

- [x] **Step 1: Write failing tests**

Add a score fusion test that passes `hvigorBuildCheckSummary.deprecatedApiWarnings` with multiple warnings and asserts final `risks` contains one `DEPRECATED_API_USAGE` medium risk with at most three evidence locations.

- [x] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test tests/score-fusion.test.ts
```

Expected: fail because the taxonomy entry and risk creation logic do not exist.

- [x] **Step 3: Implement minimal risk generation**

Add `DEPRECATED_API_USAGE` to `references/risks/risk-taxonomy.yaml`. In `scoreFusion.ts`, aggregate all `deprecatedApiWarnings` into one medium risk and normalize it through taxonomy when available.

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/score-fusion.test.ts
```

Expected: pass.

### Task 3: ArkUI Extra Rule Pack And Evaluator

**Files:**
- Create: `references/rules/arkui-extra.yaml`
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify: `src/rules/engine/rulePackYamlLoader.ts`
- Modify: `src/rules/engine/rulePackRegistry.ts`
- Create: `src/rules/evaluators/arkuiExtraEvaluator.ts`
- Modify: `src/rules/ruleEngine.ts`
- Reference: `references/rules/arkui-extra.md`（本次不实现权限声明检测）
- Test: `tests/rule-pack-yaml-loader.test.ts`
- Test: `tests/rule-engine.test.ts`

- [x] **Step 1: Write failing tests**

Add tests asserting:

- YAML loader accepts `arkui_extra`.
- default enabled packs include `arkui-extra`.
- route map page without `NavDestination` produces `ARKUI-MUST-001` as `不满足`.
- configured `routerMap` with missing profile produces `不满足`.
- multiple `.bindSheet(...)` on one component chain produces `ARKUI-FORBID-001` as `不满足`.
- separate components each using one `bindSheet` does not produce a violation.
- ambiguous route map parsing returns `未接入判定器`.

- [x] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-engine.test.ts
```

Expected: fail because `arkui_extra` detector and rule pack do not exist.

- [x] **Step 3: Implement evaluator and rule pack**

Add `arkui_extra` to detector kinds and YAML loader. Create `arkui-extra.yaml` with `ARKUI-MUST-001` and `ARKUI-FORBID-001`. Implement evaluator logic for route map and bindSheet scans, returning `未接入判定器` for ambiguous cases that should go to rule-assessment agent.

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-engine.test.ts
```

Expected: pass.

### Task 4: ArkUI Rule Scoring Impact

**Files:**
- Modify: `src/scoring/scoreFusion.ts`
- Test: `tests/score-fusion.test.ts`

- [x] **Step 1: Write failing tests**

Add tests asserting `ARKUI-MUST-001` and `ARKUI-FORBID-001` rule violations create medium rule impacts and risks without triggering hard gates.

- [x] **Step 2: Verify RED**

Run:

```bash
node --import tsx --test tests/score-fusion.test.ts
```

Expected: fail because `findPenaltyRules` has no `ARKUI-*` mapping.

- [x] **Step 3: Implement scoring mappings**

Map `ARKUI-MUST-001` and `ARKUI-FORBID-001` to medium penalties with ratio `0.35`, without adding hard gate triggers.

- [x] **Step 4: Verify GREEN**

Run:

```bash
node --import tsx --test tests/score-fusion.test.ts
```

Expected: pass.

### Task 5: Final Verification

**Files:**
- All touched files.

- [x] **Step 1: Run targeted tests**

```bash
node --import tsx --test tests/official-code-linter-node.test.ts tests/score-fusion.test.ts tests/rule-pack-yaml-loader.test.ts tests/rule-engine.test.ts
```

- [x] **Step 2: Run build**

```bash
npm run build
```

- [x] **Step 3: Review diff**

```bash
git diff --stat
git diff --check
```

Expected: no whitespace errors and only planned files changed.
