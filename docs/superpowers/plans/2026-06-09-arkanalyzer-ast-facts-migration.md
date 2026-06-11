# ArkAnalyzer AST Facts Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial ArkAnalyzer-backed `ArkFactsIndex` layer and migrate evaluators toward AST facts without keeping the old hand-written scanners as long-term rule inputs.

**Architecture:** Start with a narrow facts module that can be tested from ArkAnalyzer fixture JSON. Then add runner/debug plumbing, switch ArkUI and ArkTS evaluators to facts, migrate AST-capable regex rules, and remove scanner-only code once parity tests pass.

**Tech Stack:** TypeScript, Node test runner, existing rule evaluator interfaces, ArkAnalyzer `scene-summary.json` fixtures.

---

### Task 1: ArkFacts Types And Adapter

**Files:**
- Create: `src/rules/arkfacts/types.ts`
- Create: `src/rules/arkfacts/adapter.ts`
- Create: `src/rules/arkfacts/index.ts`
- Test: `tests/arkfacts-adapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/arkfacts-adapter.test.ts` with a minimal ArkAnalyzer scene fixture. Assert the adapter produces `files`, `declarations`, `methods`, `viewTrees`, `components`, and compact expression facts.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --import tsx --test tests/arkfacts-adapter.test.ts`
Expected: fail because `src/rules/arkfacts/adapter.ts` does not exist.

- [ ] **Step 3: Add the minimal facts types**

Create `src/rules/arkfacts/types.ts` with the narrowed `ArkFactsIndex`, declaration, method, component, attribute, expression, and diagnostic types from the spec.

- [ ] **Step 4: Implement `adaptArkAnalyzerScene`**

Create `src/rules/arkfacts/adapter.ts` with a pure function:

```ts
export function adaptArkAnalyzerScene(scene: unknown): ArkFactsIndex
```

It must normalize paths, flatten ViewTree nodes into `ArkComponentFact[]`, convert basic `uses` values into literal/enum/resource/symbol expressions, and record diagnostics for malformed input.

- [ ] **Step 5: Export the facts module**

Create `src/rules/arkfacts/index.ts` exporting types and adapter.

- [ ] **Step 6: Run focused tests**

Run: `node --import tsx --test tests/arkfacts-adapter.test.ts`
Expected: pass.

- [ ] **Step 7: Run build**

Run: `npm run build`
Expected: pass.

### Task 2: ArkAnalyzer Runner And Debug Writer

**Files:**
- Create: `src/rules/arkfacts/runner.ts`
- Create: `src/rules/arkfacts/collector.ts`
- Create: `src/rules/arkfacts/debugWriter.ts`
- Create: `src/rules/arkfacts/cache.ts`
- Test: `tests/arkfacts-runner.test.ts`

- [ ] **Step 1: Add tests for fixture injection and failure diagnostics**

Tests should verify runner can return facts from injected scene JSON, writes ArkAnalyzer-compatible config in explicit script mode, and can return diagnostics when an explicitly configured tool path is unavailable.

- [ ] **Step 2: Implement runner options**

Support `projectPath`, `caseDir`, `fixtureScene`, `sdkHome`, `sdkPaths`, `timeoutMs`, and ignored names. Default execution must use the project npm dependency `arkanalyzer`; `analyzerScriptPath`/`analyzerHome` are debug compatibility only.

- [ ] **Step 3: Implement debug writer**

Write `scene-summary.json`, `ark-facts.json`, `diagnostics.json`, and `unresolved-expressions.json` under `<caseDir>/intermediate/arkanalyzer/`.

- [ ] **Step 4: Add cache wrapper**

Cache by `CollectedEvidence` in a `WeakMap` and by generated project path string for direct runner calls.

- [ ] **Step 5: Verify**

Run: `node --import tsx --test tests/arkfacts-runner.test.ts`
Run: `npm run build`

### Task 3: ArkUI Evaluator Facts Input

**Files:**
- Modify: `src/rules/evaluators/arkui/staticEvaluator.ts`
- Create: `src/rules/evaluators/arkui/astFacts.ts`
- Test: `tests/arkui-ast-evaluator.test.ts`

- [ ] **Step 1: Add AST facts evaluator tests for pure component rules**

Cover `GridRow.breakpoints`, `GridRow.columns`, `List.lanes`, `Swiper.displayCount/indicator/margins`, `Tabs.vertical/barPosition`, and `FolderStack.upperItems`.

- [ ] **Step 2: Add an adapter bridge**

Map `ArkComponentFact` into the existing evaluator decision helpers, keeping rule output shape unchanged.

- [ ] **Step 3: Replace scanner index construction**

Use `ArkFactsIndex.components/viewTrees` as the source of component facts. Keep source snippet lookup outside base facts.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/arkui-ast-evaluator.test.ts tests/arkui-static-evaluator.test.ts`
Run: `npm run build`

### Task 4: ArkTS Evaluator Facts Input

**Files:**
- Modify: `src/rules/evaluators/arkts/staticEvaluator.ts`
- Create: `src/rules/evaluators/arkts/astFacts.ts`
- Test: `tests/arkts-ast-evaluator.test.ts`

- [ ] **Step 1: Add facts-based ArkTS rule tests**

Cover name conflicts, class/interface heritage, ESObject, class-as-value, naming rules, enum restrictions, class property access modifiers, object literal class initialization, and `let_never_reassigned`.

- [ ] **Step 2: Implement facts query helpers**

Provide declaration maps, assignment maps, enum initializer classifiers, and method/field filters.

- [ ] **Step 3: Switch `arkts_static` evaluator**

Replace `scanArktsLightFacts` usage with `ArkFactsIndex.declarations/methods`.

- [ ] **Step 4: Verify**

Run: `node --import tsx --test tests/arkts-ast-evaluator.test.ts tests/rule-engine.test.ts`
Run: `npm run build`

### Task 5: Regex Rule Migration And Cleanup

**Files:**
- Modify: `references/rules/arkts-language.yaml`
- Modify: `references/rules/arkts-performance.yaml`
- Modify: `src/rules/evaluators/arkts/staticEvaluator.ts`
- Delete or stop importing: `src/rules/evaluators/arkts/lightScanner.ts`
- Delete or stop importing: `src/rules/evaluators/arkui/staticScanner.ts`
- Test: existing rule pack and rule engine tests

- [ ] **Step 1: Move AST-capable regex checks to `arkts_static` detector mode**

Migrate static block count, throw/catch constraints, NaN compare, optional parameters, union arrays, sparse arrays, numeric array literal mixing, and loop throw checks.

- [ ] **Step 2: Remove scanner-only tests**

Replace scanner tests with adapter/evaluator tests. Keep behavior coverage, not implementation coverage.

- [ ] **Step 3: Verify rule pack loading**

Run: `node --import tsx --test tests/rule-pack-registry.test.ts tests/rule-engine.test.ts`

- [ ] **Step 4: Full verification**

Run: `npm run build`
Run: `npm test` outside sandbox if local listener tests require it.
