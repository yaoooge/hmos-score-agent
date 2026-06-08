# ArkUI Semantic Static Scanner Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ArkUI component static checks with a semantic parser/index/evaluator, and remove `ARKTS-FORBID-006` because build validation covers it.

**Architecture:** Add focused semantic modules under `src/rules/evaluators/arkui/semantic/`. The parser may use complete-parser style boundaries, but exported IR only keeps fields needed for rule evaluation, source locations, helper/breakpoint evaluation, and debug artifacts. `runArkuiStaticRule` keeps text/project checks in the existing evaluator and routes component checks to the new semantic evaluator with no legacy component fallback.

**Tech Stack:** TypeScript, Node test runner, existing rule pack YAML loader, existing `EvaluatedRule` contract.

---

## File Structure

- Create: `src/rules/evaluators/arkui/semantic/sourceModel.ts`
  - Owns source layout, structural text, balanced matching, top-level splitting, object property splitting, and line mapping.
- Create: `src/rules/evaluators/arkui/semantic/expressionModel.ts`
  - Owns minimal expression IR, parser, comparable value normalization, and unsupported expression reporting.
- Create: `src/rules/evaluators/arkui/semantic/symbolIndex.ts`
  - Owns constants, component field facts, storage prop facts, and conservative helper return extraction.
- Create: `src/rules/evaluators/arkui/semantic/breakpointFacts.ts`
  - Owns breakpoint domain facts and expression evaluation into `sm/md/lg/xl` values.
- Create: `src/rules/evaluators/arkui/semantic/componentModel.ts`
  - Owns ArkUI component tree, property aliasing, constructor synthetic properties, owner context, and parent/child facts.
- Create: `src/rules/evaluators/arkui/semantic/semanticEvaluator.ts`
  - Owns semantic component rule predicates and returns `EvaluatedRule`.
- Create: `src/rules/evaluators/arkui/semantic/index.ts`
  - Re-exports public semantic APIs for evaluator/tests.
- Modify: `src/rules/evaluators/arkui/staticEvaluator.ts`
  - Keep text/project checks, replace component rule path with `runSemanticArkuiRule`, write upgraded debug artifacts.
- Modify: `references/rules/arkts-language.yaml`
  - Remove `ARKTS-FORBID-006`.
- Modify: `src/scoring/scoringEngine.ts`
  - Remove `ARKTS-FORBID-006` from type rule penalty ids.
- Modify: `src/scoring/scoreFusion.ts`
  - Remove `ARKTS-FORBID-006` from type rule fusion ids.
- Modify: `tests/rule-engine.test.ts`
  - Delete `ARKTS-FORBID-006` dedicated tests and remove it from aggregate expected ids.
- Create/modify tests:
  - `tests/arkui-semantic-source-model.test.ts`
  - `tests/arkui-semantic-expression.test.ts`
  - `tests/arkui-semantic-breakpoints.test.ts`
  - `tests/arkui-semantic-evaluator.test.ts`
  - Update `tests/arkui-static-evaluator.test.ts`

---

### Task 1: Remove ARKTS-FORBID-006

**Files:**
- Modify: `references/rules/arkts-language.yaml`
- Modify: `src/scoring/scoringEngine.ts`
- Modify: `src/scoring/scoreFusion.ts`
- Modify: `tests/rule-engine.test.ts`

- [ ] **Step 1: Write the failing registry test**

Add this test near the existing ArkTS text-pattern tests in `tests/rule-engine.test.ts`:

```ts
test("ARKTS-FORBID-006 is not registered because build validation covers it", () => {
  assert.equal(
    listRegisteredRules().some((item) => item.rule_id === "ARKTS-FORBID-006"),
    false,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/rule-engine.test.ts --test-name-pattern "ARKTS-FORBID-006 is not registered"`

Expected: FAIL because `ARKTS-FORBID-006` is still loaded from `references/rules/arkts-language.yaml`.

- [ ] **Step 3: Remove the rule and scoring references**

Delete the full `ARKTS-FORBID-006` YAML block from `references/rules/arkts-language.yaml`.

Remove this entry from both `typeRuleIds` sets:

```ts
"ARKTS-FORBID-006",
```

Delete these two dedicated tests from `tests/rule-engine.test.ts`:

```ts
test("ARKTS-FORBID-006 ignores typed arrow function callbacks", () => {
  // remove whole test
});

test("ARKTS-FORBID-006 flags object type call signatures", () => {
  // remove whole test
});
```

In the aggregate unsupported type signatures test, remove `ARKTS-FORBID-006` from the expected rule id array but keep the fixture line `  (value: number): string;` because build validation owns that behavior.

- [ ] **Step 4: Run the removal tests**

Run: `node --import tsx --test tests/rule-engine.test.ts --test-name-pattern "ARKTS-FORBID-006|unsupported type signatures"`

Expected: PASS. The registry test passes, and the aggregate type-signature test still passes for `ARKTS-FORBID-007`, `ARKTS-MUST-002`, `ARKTS-FORBID-008`, `ARKTS-FORBID-010`, `ARKTS-FORBID-014`, and `ARKTS-FORBID-015`.

---

### Task 2: Add Source Parser Model

**Files:**
- Create: `src/rules/evaluators/arkui/semantic/sourceModel.ts`
- Create: `src/rules/evaluators/arkui/semantic/index.ts`
- Test: `tests/arkui-semantic-source-model.test.ts`

- [ ] **Step 1: Write source model tests**

Create `tests/arkui-semantic-source-model.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createSourceModel, splitTopLevel, readTopLevelObjectProperties } from "../src/rules/evaluators/arkui/semantic/index.js";

test("source model preserves line mapping while hiding comments and strings", () => {
  const source = createSourceModel("entry/src/main/ets/pages/Index.ets", [
    "const sample = \"GridRow({ columns: 4 })\";",
    "// Tabs().vertical(false)",
    "GridRow({ columns: { sm: 4, md: 8 } }) {}",
  ].join("\n"));

  assert.equal(source.lineAt(source.structural.indexOf("GridRow")), 3);
  assert.equal(source.structural.includes("Tabs().vertical"), false);
  assert.equal(source.sliceOriginal(source.original.indexOf("GridRow"), source.original.length).includes("columns"), true);
});

test("splitTopLevel handles nested object array call and ternary arguments", () => {
  assert.deepEqual(splitTopLevel("{ x: foo(1, 2), y: [a, b ? c : d] }, this.getValue(), 3"), [
    "{ x: foo(1, 2), y: [a, b ? c : d] }",
    "this.getValue()",
    "3",
  ]);
});

test("readTopLevelObjectProperties reads nested property values without string splitting", () => {
  assert.deepEqual(readTopLevelObjectProperties("{ columns: { sm: 4, md: 8 }, gutter: { x: 8, y: 12 } }"), [
    ["columns", "{ sm: 4, md: 8 }"],
    ["gutter", "{ x: 8, y: 12 }"],
  ]);
});
```

- [ ] **Step 2: Run source tests to verify they fail**

Run: `node --import tsx --test tests/arkui-semantic-source-model.test.ts`

Expected: FAIL because semantic exports do not exist.

- [ ] **Step 3: Implement minimal source model**

Add `sourceModel.ts` with these public APIs:

```ts
export interface SourceRange {
  start: number;
  end: number;
}

export interface SourceModel {
  filePath: string;
  original: string;
  structural: string;
  lineAt(index: number): number;
  sliceOriginal(start: number, end: number): string;
}

export function createSourceModel(filePath: string, original: string): SourceModel;
export function findBalancedEnd(source: string, openIndex: number, openToken: string, closeToken: string): number | undefined;
export function splitTopLevel(source: string, separator?: string): string[];
export function readTopLevelObjectProperties(source: string): Array<[string, string]>;
```

Implementation rules:

- Replace comments and string/template contents with spaces while preserving newlines and length.
- `findBalancedEnd` must skip string/template/comment regions by operating on structural text.
- `splitTopLevel` tracks `()[]{}` depth and quote modes.
- `readTopLevelObjectProperties` only returns top-level `identifier: value` pairs.

- [ ] **Step 4: Export semantic APIs**

Create `index.ts`:

```ts
export * from "./sourceModel.js";
```

- [ ] **Step 5: Run source tests**

Run: `node --import tsx --test tests/arkui-semantic-source-model.test.ts`

Expected: PASS.

---

### Task 3: Add Minimal Expression IR

**Files:**
- Modify: `src/rules/evaluators/arkui/semantic/expressionModel.ts`
- Modify: `src/rules/evaluators/arkui/semantic/index.ts`
- Test: `tests/arkui-semantic-expression.test.ts`

- [ ] **Step 1: Write expression tests**

Create `tests/arkui-semantic-expression.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseExpression } from "../src/rules/evaluators/arkui/semantic/index.js";

test("parses conditional expressions with member comparisons", () => {
  const expr = parseExpression("this.currentBreakpoint === BreakpointConstants.WIDTH_LG ? 3 : 2");
  assert.equal(expr.kind, "conditional");
});

test("parses object and array expressions needed by ArkUI rules", () => {
  const expr = parseExpression("{ sm: 4, md: 8, lg: ClassifyConstants.SWIPER_DISPLAY_COUNT[2] }");
  assert.equal(expr.kind, "object");
  assert.deepEqual(expr.entries.map((entry) => entry.key), ["sm", "md", "lg"]);
});

test("keeps unsupported expressions as unknown with raw text", () => {
  const expr = parseExpression("await this.loadCount()");
  assert.equal(expr.kind, "unknown");
  assert.equal(expr.rawText, "await this.loadCount()");
});
```

- [ ] **Step 2: Run expression tests to verify they fail**

Run: `node --import tsx --test tests/arkui-semantic-expression.test.ts`

Expected: FAIL because `parseExpression` does not exist.

- [ ] **Step 3: Implement expression IR**

Create `expressionModel.ts` with minimal node types:

```ts
export type ExprNode =
  | { kind: "literal"; rawText: string; value: string | number | boolean | null }
  | { kind: "identifier"; rawText: string; name: string }
  | { kind: "member"; rawText: string; objectText: string; property: string }
  | { kind: "call"; rawText: string; calleeText: string; args: ExprNode[] }
  | { kind: "conditional"; rawText: string; test: ExprNode; consequent: ExprNode; alternate: ExprNode }
  | { kind: "binary"; rawText: string; operator: "===" | "!==" | ">=" | "<=" | ">" | "<"; left: ExprNode; right: ExprNode }
  | { kind: "object"; rawText: string; entries: Array<{ key: string; value: ExprNode }> }
  | { kind: "array"; rawText: string; items: ExprNode[] }
  | { kind: "unknown"; rawText: string; reason: string };

export function parseExpression(source: string): ExprNode;
```

Parser order:

1. Trim source.
2. Reject unsupported leading `await`, assignment, loop keywords as `unknown`.
3. Parse top-level ternary.
4. Parse top-level comparison operators.
5. Parse object literal via `readTopLevelObjectProperties`.
6. Parse array literal via `splitTopLevel`.
7. Parse call expression and member/index expressions.
8. Parse literal and identifier.
9. Return `unknown`.

- [ ] **Step 4: Export expression APIs**

Add to `index.ts`:

```ts
export * from "./expressionModel.js";
```

- [ ] **Step 5: Run expression tests**

Run: `node --import tsx --test tests/arkui-semantic-expression.test.ts`

Expected: PASS.

---

### Task 4: Add Symbol And Breakpoint Evaluation

**Files:**
- Create: `src/rules/evaluators/arkui/semantic/symbolIndex.ts`
- Create: `src/rules/evaluators/arkui/semantic/breakpointFacts.ts`
- Modify: `src/rules/evaluators/arkui/semantic/index.ts`
- Test: `tests/arkui-semantic-breakpoints.test.ts`

- [ ] **Step 1: Write breakpoint tests**

Create `tests/arkui-semantic-breakpoints.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildSymbolIndex, evaluateByBreakpoint, parseExpression } from "../src/rules/evaluators/arkui/semantic/index.js";

test("evaluates breakpoint boolean derived from currentBreakpoint", () => {
  const symbols = buildSymbolIndex([{ relativePath: "Index.ets", content: "const WIDTH_LG = 'lg';" }]);
  const value = evaluateByBreakpoint(parseExpression("this.currentBreakpoint === WIDTH_LG ? 3 : 2"), symbols);
  assert.deepEqual(value.values, { sm: 2, md: 2, lg: 3, xl: 2 });
  assert.equal(value.responsive, true);
});

test("evaluates object breakpoint maps and numeric helper constructor values", () => {
  const symbols = buildSymbolIndex([{ relativePath: "Index.ets", content: "const SWIPER_DISPLAY_COUNT = [1, 2, 3];" }]);
  const value = evaluateByBreakpoint(parseExpression("{ sm: 1, md: 2, lg: SWIPER_DISPLAY_COUNT[2] }"), symbols);
  assert.deepEqual(value.values, { sm: 1, md: 2, lg: 3 });
  assert.equal(value.unknown, false);
});
```

- [ ] **Step 2: Run breakpoint tests to verify they fail**

Run: `node --import tsx --test tests/arkui-semantic-breakpoints.test.ts`

Expected: FAIL because symbol and breakpoint APIs do not exist.

- [ ] **Step 3: Implement symbol index**

Create `symbolIndex.ts`:

```ts
import type { WorkspaceFile } from "../../evidence/types.js";

export interface SymbolIndex {
  constants: Record<string, string>;
  helpers: Record<string, string>;
}

export function buildSymbolIndex(files: Pick<WorkspaceFile, "relativePath" | "content">[]): SymbolIndex;
```

Collect only:

- top-level `const NAME = expr;`
- `static readonly NAME = expr;`
- same-struct helper bodies with a direct `return expr;`

Do not collect imports, full type declarations, decorators, or arbitrary function bodies.

- [ ] **Step 4: Implement breakpoint evaluation**

Create `breakpointFacts.ts`:

```ts
export type BreakpointKey = "sm" | "md" | "lg" | "xl";

export interface BreakpointValue<T = string | number | boolean> {
  values: Partial<Record<BreakpointKey, T>>;
  unknown: boolean;
  responsive: boolean;
  reasons: string[];
}

export function evaluateByBreakpoint(expr: ExprNode, symbols: SymbolIndex): BreakpointValue;
```

Required behavior:

- Object map `{ sm, md, lg, xl }` maps directly.
- `currentBreakpoint === 'lg' ? a : b` maps `lg` to `a` and other known breakpoints to `b`.
- `currentBreakpoint !== 'sm' ? a : b` maps `sm` to `b` and others to `a`.
- Constant identifiers and `NAME[index]` resolve through `symbols.constants`.
- Unknown call/helper returns `{ values: {}, unknown: true, responsive: false, reasons: [...] }`.

- [ ] **Step 5: Export and run tests**

Add exports to `index.ts`, then run:

`node --import tsx --test tests/arkui-semantic-breakpoints.test.ts`

Expected: PASS.

---

### Task 5: Build Semantic Component Index

**Files:**
- Create: `src/rules/evaluators/arkui/semantic/componentModel.ts`
- Modify: `src/rules/evaluators/arkui/semantic/index.ts`
- Test: `tests/arkui-semantic-evaluator.test.ts`

- [ ] **Step 1: Write component model tests**

Add to `tests/arkui-semantic-evaluator.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildArkuiSemanticIndex } from "../src/rules/evaluators/arkui/semantic/index.js";

test("semantic index maps constructor arguments and parent child relationships", () => {
  const index = buildArkuiSemanticIndex([
    {
      relativePath: "entry/src/main/ets/pages/Index.ets",
      content: "struct Index { build(){ SideBarContainer(this.isLargeScreen ? SideBarContainerType.Embed : SideBarContainerType.Overlay){ GridRow({ columns: { sm: 4, md: 8 }, gutter: { x: 8, y: 12 } }){ GridCol({ span: 2 }){} } }.showSideBar(this.isLargeScreen).sideBarWidth(this.isLargeScreen ? 280 : 0) } }",
    },
  ]);

  const sidebar = index.components.find((item) => item.component === "SideBarContainer");
  const gridCol = index.components.find((item) => item.component === "GridCol");
  assert.equal(sidebar?.syntheticProperties.find((item) => item.name === "type")?.source, "synthetic");
  assert.equal(gridCol?.parentId, index.components.find((item) => item.component === "GridRow")?.id);
});
```

- [ ] **Step 2: Run component test to verify it fails**

Run: `node --import tsx --test tests/arkui-semantic-evaluator.test.ts --test-name-pattern "semantic index maps"`

Expected: FAIL because `buildArkuiSemanticIndex` does not exist.

- [ ] **Step 3: Implement component model**

Create `componentModel.ts` with these interfaces:

```ts
export interface ArkuiSemanticIndex {
  files: Array<{ filePath: string; componentCount: number }>;
  components: SemanticComponent[];
  symbols: SymbolIndex;
}

export interface SemanticComponent {
  id: string;
  component: string;
  filePath: string;
  line: number;
  range: SourceRange;
  childrenRange?: SourceRange;
  parentId?: string;
  childIds: string[];
  owner?: { kind: "struct" | "builder" | "method"; name: string };
  constructorArgs: ExprNode[];
  properties: SemanticProperty[];
  syntheticProperties: SemanticProperty[];
}

export interface SemanticProperty {
  name: string;
  source: "constructor" | "chain" | "synthetic";
  line: number;
  range: SourceRange;
  expr: ExprNode;
  rawText: string;
}
```

Implement `buildArkuiSemanticIndex(files)` by:

- scanning `.ets` files only;
- recognizing component calls with uppercase identifiers;
- parsing constructor args with `splitTopLevel`;
- parsing chained `.property(...)`;
- assigning parent/child via range containment;
- adding synthetic `type` for `SideBarContainer(arg0)`;
- adding constructor object properties for `GridRow`, `GridCol`, `List`, and `WaterFlow`.

- [ ] **Step 4: Export and run component test**

Run: `node --import tsx --test tests/arkui-semantic-evaluator.test.ts --test-name-pattern "semantic index maps"`

Expected: PASS.

---

### Task 6: Add Semantic Evaluator For Component Rules

**Files:**
- Create: `src/rules/evaluators/arkui/semantic/semanticEvaluator.ts`
- Modify: `src/rules/evaluators/arkui/staticEvaluator.ts`
- Test: `tests/arkui-semantic-evaluator.test.ts`
- Test: `tests/arkui-static-evaluator.test.ts`

- [ ] **Step 1: Write semantic evaluator tests**

Add tests covering the required task 1111 regressions:

```ts
test("semantic evaluator passes SideBarContainer type show and width by breakpoint", () => {
  const result = runArkuiStaticRule(
    makeRule("sidebar_type_by_breakpoint"),
    makeEvidence("SideBarContainer(this.isLargeScreen ? SideBarContainerType.Embed : SideBarContainerType.Overlay){}.showSideBar(this.isLargeScreen).sideBarWidth(this.isLargeScreen ? 280 : 0)")
  );
  assert.equal(result.result, "满足");
});

test("semantic evaluator treats fixed Swiper displayCount one as non-decreasing", () => {
  const result = runArkuiStaticRule(makeRule("swiper_display_count_non_decreasing"), makeEvidence("Swiper(){}.displayCount(1)"));
  assert.equal(result.result, "满足");
});

test("semantic evaluator requires GridRow gutter x and y", () => {
  const result = runArkuiStaticRule(makeRule("gridrow_gutter_required"), makeEvidence("GridRow({ columns: { sm: 4, md: 8 }, gutter: { x: 8 } }){}"));
  assert.equal(result.result, "不满足");
});
```

- [ ] **Step 2: Run semantic evaluator tests to verify they fail**

Run: `node --import tsx --test tests/arkui-semantic-evaluator.test.ts tests/arkui-static-evaluator.test.ts --test-name-pattern "semantic evaluator|GridRow gutter"`

Expected: FAIL because component rules still use legacy string evaluation.

- [ ] **Step 3: Implement semantic rule predicates**

Create `semanticEvaluator.ts`:

```ts
export function runSemanticArkuiRule(rule: RegisteredRule, evidence: CollectedEvidence, spec: ArkuiRuleSpec): EvaluatedRule;
```

Predicate requirements:

- `exists`: property exists; for `gridrow_gutter_required`, require `gutter.x` and `gutter.y`.
- `contains`/`contains_all`: normalize literal/member/object/array values to comparable text.
- `non_decreasing`: evaluate known numeric breakpoint values in `sm/md/lg/xl` order; fixed numeric values pass.
- `breakpoint_aware`: pass when at least two known breakpoint values differ or expression is clearly responsive and rule only requires dynamic setting.
- `swiper_indicator_by_display_count`: applicable only when `displayCount` can be known as multi-display; pass with `indicator(false)` or responsive indicator.
- `swiper_margins_for_multi_display`: applicable only for multi-display; pass when `prevMargin` or `nextMargin` exists.
- `tabs_*`: apply only page-level tabs; pass when large/small values differ.
- `gridcol_span_by_breakpoint`: pass when parent `GridRow.columns` is responsive and `span/columns` ratio changes.

- [ ] **Step 4: Route component checks through semantic evaluator**

In `staticEvaluator.ts`:

- Keep `TEXT_STATIC_CHECKS` branch unchanged.
- Keep unknown check handling unchanged.
- Keep `MANUAL_APPLICABILITY_CHECKS` unchanged unless the semantic evaluator can inspect component count.
- Replace the legacy component branch with:

```ts
const result = runSemanticArkuiRule(rule, evidence, spec);
writeSemanticDebugArtifacts(evidence, rule, result);
return result;
```

Do not call `isInstanceSatisfied`, `isInstanceApplicable`, or `readPropertyValue` for component checks.

- [ ] **Step 5: Run semantic evaluator tests**

Run: `node --import tsx --test tests/arkui-semantic-evaluator.test.ts tests/arkui-static-evaluator.test.ts`

Expected: PASS.

---

### Task 7: Upgrade Debug Artifacts And Remove Legacy Component Path

**Files:**
- Modify: `src/rules/evaluators/arkui/staticEvaluator.ts`
- Modify: `src/rules/evaluators/arkui/semantic/semanticEvaluator.ts`
- Test: `tests/arkui-static-evaluator.test.ts`

- [ ] **Step 1: Update debug artifact test**

Update the existing debug artifact test to expect:

```ts
assert.equal(await exists(path.join(artifactDir, "semantic-index.json")), true);
assert.equal(await exists(path.join(artifactDir, "breakpoint-facts.json")), true);
assert.equal(await exists(path.join(artifactDir, "rule-traces.json")), true);
assert.equal(await exists(path.join(artifactDir, "unsupported-expressions.json")), true);
```

- [ ] **Step 2: Run debug test to verify it fails**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts --test-name-pattern "debug"`

Expected: FAIL because old artifact names are still written.

- [ ] **Step 3: Write semantic artifacts**

Write these files under `<caseDir>/intermediate/arkui-static-scan/`:

- `semantic-index.json`: semantic index without source text copies.
- `breakpoint-facts.json`: evaluated breakpoint facts used by rules.
- `rule-traces.json`: rule id, check, inspected components, applicable components, evaluated properties, decision reason, matched locations.
- `unsupported-expressions.json`: `UnknownExpr` raw text, file, line, component/property, reason.

- [ ] **Step 4: Remove or isolate legacy component helpers**

Delete legacy component-only helpers from `staticEvaluator.ts` when they no longer have callers:

- `isInstanceSatisfied`
- `isInstanceApplicable`
- `readPropertyValue`
- `readObjectProperty`
- `hasBreakpointExpression`
- `isResponsiveExpression`
- `isNonDecreasingBreakpointMap`
- `hasResponsiveGridRowAncestor`
- `isPageLevelTabs`

Keep helper functions still used by text/project checks.

- [ ] **Step 5: Run debug and arkui tests**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts tests/arkui-semantic-evaluator.test.ts`

Expected: PASS.

---

### Task 8: Regression Fixtures And Rule Engine Integration

**Files:**
- Modify: `tests/rule-engine.test.ts`
- Modify: `tests/arkui-static-evaluator.test.ts`

- [ ] **Step 1: Add task 1111 minimal regression test**

Add one compact fixture that includes:

```ts
@StorageProp("isLargeScreen") isLargeScreen: boolean = false;
build() {
  Tabs() {
    TabContent() { Navigation() {} }
    TabContent() { NavDestination() {} }
  }
  .vertical(this.isLargeScreen)
  .barPosition(this.isLargeScreen ? BarPosition.Start : BarPosition.End)
  .barWidth(this.isLargeScreen ? 96 : 56)

  SideBarContainer(this.isLargeScreen ? SideBarContainerType.Embed : SideBarContainerType.Overlay) {}
    .showSideBar(this.isLargeScreen)
    .sideBarWidth(this.isLargeScreen ? 280 : 0)

  GridRow({ columns: this.isLargeScreen ? 8 : 4, gutter: { x: 8, y: 12 } }) {
    GridCol({ span: 2 }) {}
  }

  List({ space: this.isLargeScreen ? 16 : 8 }) {}
    .lanes(this.isLargeScreen ? 3 : 1)

  Swiper() {}
    .displayCount(this.isLargeScreen ? 3 : 1)
    .indicator(false)
    .prevMargin(12)
}
```

Assert the target checks return `满足` or `不涉及` according to the spec, and that known remaining checks still return `不满足`.

- [ ] **Step 2: Run regression test to verify current failures**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts --test-name-pattern "task 1111"`

Expected before semantic completion: FAIL on at least one target check.

- [ ] **Step 3: Adjust evaluator decisions until regression passes**

Only change semantic predicates or expression/breakpoint evaluation. Do not add string special cases to `staticEvaluator.ts`.

- [ ] **Step 4: Run rule engine tests**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/arkui-static-evaluator.test.ts`

Expected: PASS.

---

### Task 9: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Search for forbidden leftovers**

Run: `rg -n "ARKTS-FORBID-006|arkui-scan-index|unresolved-expressions|isInstanceSatisfied|hasBreakpointExpression" src tests references docs/superpowers/specs/2026-06-05-arkui-semantic-static-scanner-cutover-design.md`

Expected:

- `ARKTS-FORBID-006` appears only in the spec and this plan as a deletion note.
- `isInstanceSatisfied` and `hasBreakpointExpression` do not appear in production component-rule paths.
- Old artifact names do not appear in artifact-writing tests.

- [ ] **Step 2: Run targeted semantic tests**

Run: `node --import tsx --test tests/arkui-semantic-source-model.test.ts tests/arkui-semantic-expression.test.ts tests/arkui-semantic-breakpoints.test.ts tests/arkui-semantic-evaluator.test.ts tests/arkui-static-evaluator.test.ts tests/rule-engine.test.ts`

Expected: PASS.

- [ ] **Step 3: Run build**

Run: `npm run build`

Expected: PASS with TypeScript compilation exit code 0.

- [ ] **Step 4: Run full test suite**

Run: `npm test`

Expected: PASS. If sandbox blocks `127.0.0.1` listening, rerun the same command with approved escalation and record the exact sandbox error plus the final result.

---

## Self-Review

- Spec coverage: Tasks cover `ARKTS-FORBID-006` deletion, source parser model, expression IR, symbol/helper facts, breakpoint evaluation, semantic component model, semantic evaluator, debug artifacts, old component path removal, regression fixture, and full verification.
- Placeholder scan: No placeholder markers are present; each task has concrete files, test command, and expected result.
- Type consistency: Public semantic exports are introduced through `src/rules/evaluators/arkui/semantic/index.ts`; later tasks import the same names defined in earlier tasks.
