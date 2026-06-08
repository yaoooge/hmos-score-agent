# Cross-Device Static Review Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first thin-evidence/static-boundary pass from `docs/superpowers/specs/2026-06-08-cross-device-rule-static-scan-assessment.md`.

**Architecture:** Keep `staticScanner` as a light component indexer and avoid parser patching. Change `arkui_static` evaluation so opaque responsive expressions become agent review candidates instead of deterministic failures, and map those candidates to a minimal evidence object.

**Tech Stack:** TypeScript, Node test runner, existing rule engine and rule pack YAML loader.

---

### Task 1: Fix Rule Pack Loading

**Files:**
- Modify: `references/rules/cross-device-adaptation.yaml`
- Test: `tests/rule-pack-yaml-loader.test.ts`

- [x] **Step 1: Run the existing loader test**

Run: `node --import tsx --test tests/rule-pack-yaml-loader.test.ts`

Expected before fix: FAIL with `decisionCriteria.pass must only contain strings`.

- [x] **Step 2: Fix `OM-FLEX-SHOULD-02` pass criterion**

Change the object-shaped `decisionCriteria.pass` entry to a string:

```yaml
pass:
  - 满足建议：多个固定宽子项横向排列的 Flex 设置 wrap: FlexWrap.Wrap，或提供横向滚动能力
```

- [x] **Step 3: Run the loader test again**

Run: `node --import tsx --test tests/rule-pack-yaml-loader.test.ts`

Expected after fix: PASS.

### Task 2: Downgrade Opaque Responsive Expressions

**Files:**
- Modify: `src/rules/evaluators/arkui/staticEvaluator.ts`
- Test: `tests/arkui-static-evaluator.test.ts`
- Test: `tests/rule-engine.test.ts`

- [x] **Step 1: Add failing evaluator tests**

Add tests showing these expressions return `未接入判定器` with location evidence:

```ts
test("asks agent to review breakpoint-aware properties hidden behind screen-size booleans", () => {
  const result = runArkuiStaticRule(
    makeRule("tabs_vertical_by_breakpoint"),
    makeEvidence("Tabs(){ TabContent(){ Navigation(){} } TabContent(){ NavDestination(){} } }.vertical(this.isLargeScreen)"),
  );

  assert.equal(result.result, "未接入判定器");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
});
```

Add a second test for `Swiper.displayCount(this.getDisplayCount())`.

- [x] **Step 2: Verify tests fail**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts`

Expected before implementation: FAIL because current evaluator returns `不满足` or `满足`.

- [x] **Step 3: Implement minimal review downgrade**

In `staticEvaluator.ts`, add a helper that detects opaque expressions such as `isLargeScreen`, `isMediumScreen`, `getDisplayCount()`, `ResourceUtil.*()`, and non-literal method calls. For affected component-property rules, return `未接入判定器` with matched file, line, and `property=value` snippets.

- [x] **Step 4: Run evaluator tests**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts`

Expected after implementation: PASS.

### Task 3: Add Thin Agent Evidence

**Files:**
- Modify: `src/types.ts`
- Modify: `src/rules/core/assistedRuleMapper.ts`
- Modify: `src/agents/normalization/ruleAssistance.ts`
- Test: `tests/rule-engine.test.ts`
- Test: `tests/agent-assisted-rule.test.ts`

- [x] **Step 1: Add failing rule-engine test**

Add a test asserting a downgraded `OM-SWIPER-MUST-01` result becomes an assisted candidate with:

```ts
review_evidence: {
  rule_id: "OM-SWIPER-MUST-01",
  file: "entry/src/main/ets/pages/Index.ets",
  line: 7,
  subject: "Swiper",
  evidence: "displayCount=this.getDisplayCount()",
  question: "请结合规则描述和源码上下文复核该 Swiper 是否满足一多适配要求。",
}
```

- [x] **Step 2: Verify test fails**

Run: `node --import tsx --test tests/rule-engine.test.ts`

Expected before implementation: FAIL because `review_evidence` does not exist.

- [x] **Step 3: Add optional thin evidence type and mapper**

Add `review_evidence?: AssistedRuleReviewEvidence` to `AssistedRuleCandidate` and `AgentBootstrapRuleCandidate`. Populate it in `mapAssistedRuleCandidate` from `matchedLocations` and `matchedSnippets` when static evaluator provides review evidence.

- [x] **Step 4: Preserve prompt compaction**

Include `review_evidence` in `compactAssistedRuleCandidateForBootstrap` without adding bulky raw snippets.

- [x] **Step 5: Run targeted tests**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/agent-assisted-rule.test.ts`

Expected after implementation: PASS.

### Task 4: Verification

**Files:**
- No new source files.

- [x] **Step 1: Run focused verification**

Run: `node --import tsx --test tests/arkui-static-evaluator.test.ts tests/rule-pack-yaml-loader.test.ts tests/rule-engine.test.ts tests/agent-assisted-rule.test.ts`

Expected: PASS.

- [x] **Step 2: Run typecheck**

Run: `npm run build`

Expected: PASS.
