# 一多 UI 规则静态判定器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a registered `arkui_static` evaluator that scans ArkUI component facts once, evaluates all migrated one-multi UI rules deterministically, and writes debug artifacts under each case's `intermediate/arkui-static-scan/`.

**Architecture:** Add a lightweight ArkUI component scanner, expression resolver, registry, static evaluator, and debug writer under `src/rules/evaluators/`. Wire `arkui_static` into the rule engine and YAML loader, then migrate the cross-device rule pack to `OM-*` component-based IDs. Tests are written first for scanner facts, expression resolution, registry checks, rule-engine integration, debug artifacts, and YAML migration.

**Tech Stack:** TypeScript, Node test runner, `js-yaml`, existing rule engine, existing `ArtifactStore`/case `intermediate` artifact conventions.

---

### Task 1: Engine Wiring And Case Debug Context

**Files:**
- Modify: `src/rules/evidenceCollector.ts`
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify: `src/rules/engine/rulePackYamlLoader.ts`
- Modify: `src/rules/ruleEngine.ts`
- Test: `tests/rule-pack-yaml-loader.test.ts`
- Test: `tests/rule-engine.test.ts`

- [ ] **Step 1: Write failing YAML loader test**

Add a test to `tests/rule-pack-yaml-loader.test.ts` that loads an inline rule with:

```yaml
detector:
  kind: static
  mode: arkui_static
  config:
    check: tabs_vertical_by_breakpoint
    targetPatterns:
      - '**/*.ets'
```

Assert the parsed detector mode is `arkui_static`.

- [ ] **Step 2: Run loader test and verify it fails**

Run: `node --import tsx --test tests/rule-pack-yaml-loader.test.ts`

Expected: FAIL because `arkui_static` is not in `ALLOWED_STATIC_MODES`.

- [ ] **Step 3: Add detector mode type and loader support**

In `src/rules/engine/ruleTypes.ts`, add `"arkui_static"` to `StaticDetectorMode`.

In `src/rules/engine/rulePackYamlLoader.ts`, add `"arkui_static"` to `ALLOWED_STATIC_MODES`.

- [ ] **Step 4: Add caseDir to collected evidence**

In `src/rules/evidenceCollector.ts`, extend `CollectedEvidence`:

```ts
caseDir?: string;
```

Return `caseDir: path.dirname(path.dirname(caseInput.patchPath))` when `patchPath` points to `<caseDir>/diff/changes.patch`, or derive it from `generatedProjectPath` when it points to `<caseDir>/workspace`. Use a helper that only returns a directory when it contains or ends with expected case subdirs; otherwise leave it undefined.

- [ ] **Step 5: Add temporary unsupported arkui_static wiring**

In `src/rules/ruleEngine.ts`, add `arkui_static: runUnsupportedStaticRule` to the evaluator map. This makes loader support compile before the real evaluator exists.

- [ ] **Step 6: Run tests**

Run: `node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-engine.test.ts`

Expected: PASS.

### Task 2: ArkUI Component Scanner

**Files:**
- Create: `src/rules/evaluators/arkuiComponentScanner.ts`
- Test: `tests/arkui-component-scanner.test.ts`

- [ ] **Step 1: Write failing scanner test**

Create `tests/arkui-component-scanner.test.ts` with a fixture containing:

```ts
Tabs({ barPosition: this.isWideScreen ? BarPosition.Start : BarPosition.End }) {
  TabContent() {}
}
.vertical(this.isWideScreen)
.barWidth(this.barWidth)

List({ space: 12, lanes: this.lanes }) {
  ListItem() {}
}
.divider({ strokeWidth: 1 })

GridRow({ columns: { sm: 4, md: 8, lg: 12 }, gutter: { x: 12, y: 16 } }) {
  GridCol({ span: 4 }) {}
}
```

Assert `scanArkuiComponents` returns component facts for `Tabs`, `TabContent`, `List`, `ListItem`, `GridRow`, and `GridCol`; assert `Tabs` has `vertical` and `barWidth` modifiers, `List` has constructor args and `divider`, and `GridCol.parentId` points to the `GridRow` fact.

- [ ] **Step 2: Run scanner test and verify it fails**

Run: `node --import tsx --test tests/arkui-component-scanner.test.ts`

Expected: FAIL because `arkuiComponentScanner.ts` does not exist.

- [ ] **Step 3: Implement scanner**

Implement:

```ts
export interface ArkuiComponentFact { ... }
export interface ArkuiModifierFact { ... }
export interface ArkuiConditionFact { ... }
export interface ArkuiScanIndex {
  files: Array<{ relativePath: string; components: ArkuiComponentFact[] }>;
  components: ArkuiComponentFact[];
  componentsByName: Record<string, ArkuiComponentFact[]>;
}
export function scanArkuiComponents(evidence: CollectedEvidence): ArkuiScanIndex;
```

Use a lightweight brace/paren scanner, strip comments and strings for structural matching while preserving raw snippets, and scan `evidence.allWorkspaceFiles ?? evidence.workspaceFiles` for `.ets` files.

- [ ] **Step 4: Run scanner test**

Run: `node --import tsx --test tests/arkui-component-scanner.test.ts`

Expected: PASS.

### Task 3: Expression Resolver

**Files:**
- Create: `src/rules/evaluators/arkuiExpressionFacts.ts`
- Test: `tests/arkui-expression-facts.test.ts`

- [ ] **Step 1: Write failing expression tests**

Create tests for:

- `resolveStaticValue("true")` returns boolean true.
- `resolveStaticValue("BarPosition.Start")` returns enum.
- `resolveBreakpointValue("{ sm: 1, md: 2, lg: 3, xl: 3 }")` returns by-breakpoint values.
- `resolveBreakpointValue("currentBreakpoint !== 'sm'")` maps `sm=false`, `md=true`, `lg=true`, `xl=true`.
- `isNonDecreasingBreakpointNumbers({ sm: 1, md: 2, lg: 3 })` is true.
- `isNonDecreasingBreakpointNumbers({ sm: 3, md: 2, lg: 2 })` is false.

- [ ] **Step 2: Run expression tests and verify they fail**

Run: `node --import tsx --test tests/arkui-expression-facts.test.ts`

Expected: FAIL because resolver does not exist.

- [ ] **Step 3: Implement resolver helpers**

Implement:

```ts
export type BreakpointName = "xs" | "sm" | "md" | "lg" | "xl";
export type StaticValue = ...;
export interface BreakpointValueFact { ... }
export function resolveStaticValue(expression: string): StaticValue;
export function resolveBreakpointValue(expression: string): BreakpointValueFact;
export function isNonDecreasingBreakpointNumbers(fact: BreakpointValueFact): boolean | undefined;
export function hasBreakpointVariation(fact: BreakpointValueFact): boolean | undefined;
```

Keep unresolved expressions explicit with `{ kind: "unknown", reason }`.

- [ ] **Step 4: Run expression tests**

Run: `node --import tsx --test tests/arkui-expression-facts.test.ts`

Expected: PASS.

### Task 4: Static Registry And First Component Evaluators

**Files:**
- Create: `src/rules/evaluators/arkuiStaticRegistry.ts`
- Create: `src/rules/evaluators/arkuiStaticEvaluator.ts`
- Modify: `src/rules/ruleEngine.ts`
- Test: `tests/arkui-static-evaluator.test.ts`

- [ ] **Step 1: Write failing evaluator tests**

Create tests that construct `CollectedEvidence` directly and call `runArkuiStaticRule` for these checks:

- `tabs_vertical_by_breakpoint`: `Tabs().vertical(this.currentBreakpoint !== 'sm')` is `不满足`.
- `tabs_bar_position_by_breakpoint`: `barPosition(this.currentBreakpoint !== 'sm' ? BarPosition.Start : BarPosition.End)` is `不满足`.
- `list_space_by_breakpoint`: `List({ space: 12 })` is `不满足`.
- `gridrow_columns_by_breakpoint`: `GridRow({ columns: 12 })` is `不满足`.
- Missing component returns `不涉及`.

- [ ] **Step 2: Run evaluator tests and verify they fail**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts`

Expected: FAIL because evaluator files do not exist.

- [ ] **Step 3: Implement registry and evaluator**

Implement:

```ts
export interface ArkuiStaticCheck { ... }
export function registerArkuiStaticCheck(check: ArkuiStaticCheck): void;
export function getArkuiStaticCheck(check: string): ArkuiStaticCheck | undefined;
export function runArkuiStaticRule(rule: RegisteredRule, evidence: CollectedEvidence): EvaluatedRule;
```

Register checks for:

- `tabs_vertical_by_breakpoint`
- `tabs_bar_position_by_breakpoint`
- `list_space_by_breakpoint`
- `gridrow_columns_by_breakpoint`

Wire `arkui_static: runArkuiStaticRule` in `src/rules/ruleEngine.ts`.

- [ ] **Step 4: Run evaluator tests**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts`

Expected: PASS.

### Task 5: Complete Component Rule Checks

**Files:**
- Modify: `src/rules/evaluators/arkuiStaticEvaluator.ts`
- Modify: `tests/arkui-static-evaluator.test.ts`

- [ ] **Step 1: Add failing tests for remaining checks**

Add tests for:

- WaterFlow `columnsTemplate` non-decreasing and `SLIDING_WINDOW`.
- Swiper `displayCount`, `indicator`, `prevMargin`, `nextMargin`.
- Grid `columnsTemplate`.
- SideBarContainer `showSideBar`, `sideBarWidth`, type.
- Tabs `barWidth/barHeight`.
- GridRow `gutter` and `breakpoints.value`.
- GridCol `span` and `offset`.
- Flex `flexGrow/flexShrink`, `justifyContent`, `wrap`.
- Row/Column `layoutWeight`, `displayPriority`, `Blank`.
- Navigation `navBarWidth`.
- Scroll horizontal support.
- aspectRatio and constraintSize checks.
- Breakpoint support checks.

- [ ] **Step 2: Run evaluator tests and verify they fail**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts`

Expected: FAIL with missing check registrations or incorrect results.

- [ ] **Step 3: Implement remaining checks**

Implement all checks listed in the spec's rule coverage table. Use small helper functions in `arkuiStaticEvaluator.ts` to avoid repeated conclusion building:

```ts
function buildSatisfied(...)
function buildViolation(...)
function buildNotApplicable(...)
function buildUnresolved(...)
```

- [ ] **Step 4: Run evaluator tests**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts`

Expected: PASS.

### Task 6: Debug Artifact Writer

**Files:**
- Create: `src/rules/evaluators/arkuiStaticDebugWriter.ts`
- Modify: `src/rules/evaluators/arkuiStaticEvaluator.ts`
- Test: `tests/arkui-static-debug-writer.test.ts`

- [ ] **Step 1: Write failing debug artifact test**

Create a temporary case dir with `workspace`, `diff`, and `intermediate`. Set `HMOS_STATIC_SCAN_DEBUG=1`, run `runRuleEngine`, and assert files exist:

- `intermediate/arkui-static-scan/arkui-scan-index.json`
- `intermediate/arkui-static-scan/arkui-rule-traces.json`
- `intermediate/arkui-static-scan/unresolved-expressions.json`

- [ ] **Step 2: Run debug test and verify it fails**

Run: `node --import tsx --test tests/arkui-static-debug-writer.test.ts`

Expected: FAIL because artifacts are not written.

- [ ] **Step 3: Implement debug writer**

Implement synchronous-safe JSON writing through `fs.mkdirSync` / `fs.writeFileSync` because rule evaluators are currently synchronous. Only write when `process.env.HMOS_STATIC_SCAN_DEBUG === "1"` and `evidence.caseDir` is defined.

- [ ] **Step 4: Run debug test**

Run: `node --import tsx --test tests/arkui-static-debug-writer.test.ts`

Expected: PASS.

### Task 7: YAML Migration To OM IDs

**Files:**
- Modify: `references/rules/cross-device-adaptation.yaml`
- Modify: tests that assert old `CFG-*`, `RSP-*`, or `CMP-*` IDs for the cross-device pack.

- [ ] **Step 1: Write failing pack registry assertions**

Update tests to assert:

- No cross-device rule id starts with `CFG-`, `RSP-`, or `CMP-`.
- The pack includes `OM-TABS-MUST-01`, `OM-LIST-SHOULD-01`, `OM-GRIDROW-MUST-01`, `OM-BREAKPOINT-MUST-03`.
- These rules use `detector.mode: arkui_static` and the expected `check`.

- [ ] **Step 2: Run registry tests and verify they fail**

Run: `node --import tsx --test tests/rule-pack-registry.test.ts tests/rule-pack-yaml-loader.test.ts`

Expected: FAIL because YAML still uses old IDs and modes.

- [ ] **Step 3: Migrate YAML**

Replace old IDs with the spec's `OM-*` mapping. Replace UI rule detectors with:

```yaml
detector:
  kind: static
  mode: arkui_static
  config:
    check: <check_id>
    targetPatterns:
      - '**/*.ets'
```

Use short `rule` text and short `decisionCriteria`. Remove repeated per-rule `targetChecks.llmPrompt`.

- [ ] **Step 4: Run registry tests**

Run: `node --import tsx --test tests/rule-pack-registry.test.ts tests/rule-pack-yaml-loader.test.ts`

Expected: PASS.

### Task 8: Full Rule Engine Integration

**Files:**
- Modify: `tests/rule-engine.test.ts`
- Modify: `tests/score-agent.test.ts` if old IDs are asserted.

- [ ] **Step 1: Write failing integration test**

Add a fixture with Tabs/List/GridRow/BreakpointValueProvider patterns. Run `runRuleEngine` with cross-device pack enabled and assert deterministic results include:

- `OM-TABS-MUST-01`
- `OM-TABS-MUST-02`
- `OM-LIST-SHOULD-01`
- `OM-GRIDROW-MUST-01`
- `OM-BREAKPOINT-MUST-03`

Assert these IDs are absent from `assistedRuleCandidates`.

- [ ] **Step 2: Run integration test and verify it fails**

Run: `node --import tsx --test tests/rule-engine.test.ts`

Expected: FAIL until YAML and evaluator coverage are complete.

- [ ] **Step 3: Fix integration issues**

Adjust evaluator conclusions, evidence locations, or YAML configs so deterministic results and evidence index are stable.

- [ ] **Step 4: Run focused integration tests**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/score-agent.test.ts`

Expected: PASS.

### Task 9: Final Verification

**Files:**
- No new files unless tests expose missing coverage.

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run targeted score command if available**

Run: `npm run score`

Expected: PASS or documented expected CLI behavior. If this command is long-running or requires external state, record the reason instead of forcing it.

- [ ] **Step 3: Inspect git diff**

Run: `git diff --stat` and `git diff --check`.

Expected: no whitespace errors and changes limited to evaluator implementation, YAML migration, tests, and plan/spec docs.

- [ ] **Step 4: Commit implementation**

Commit message:

```bash
git add src tests references docs/superpowers/plans/2026-06-04-cross-device-static-ui-rule-evaluator.md
git commit -m "feat: add static one-multi UI rule evaluator"
```
