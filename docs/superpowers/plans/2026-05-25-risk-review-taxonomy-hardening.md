# Risk Review Taxonomy Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the canonical risk taxonomy and scoring skills so production risk-review findings map consistently without adding overlapping first-level taxonomy codes.

**Architecture:** Keep `references/risks/risk-taxonomy.yaml` as the single canonical taxonomy. Improve taxonomy descriptions and match hints, then align rubric and rule agent skill instructions with the same prioritization and deduplication contract. Tests verify the new taxonomy vocabulary and skill-level guardrails.

**Tech Stack:** TypeScript, Node test runner, YAML taxonomy, Codex/OpenCode skill Markdown.

---

## File Structure

- Modify `references/risks/risk-taxonomy.yaml`: strengthen descriptions and `matchHints` for existing score taxonomy entries; do not add new first-level score taxonomy codes.
- Modify `.opencode/skills/hmos-rubric-scoring/SKILL.md`: add risk taxonomy priority rules for rubric risk output and reinforce rule/rubric duplicate suppression.
- Modify `.opencode/skills/hmos-rule-assessment/SKILL.md`: add source-rule-to-canonical mapping requirements and keep multiple independent rule violations even when they map to the same rubric dimension.
- Modify `tests/risk-taxonomy.test.ts`: assert that the canonical taxonomy contains the new production-derived matching vocabulary without introducing new first-level categories.
- Modify `tests/opencode-rubric-scoring.test.ts`: assert the rubric skill includes the priority and duplicate-suppression rules.
- Modify `tests/opencode-rule-assessment.test.ts`: assert the rule assessment skill includes the canonical mapping and multi-rule retention rules.

### Task 1: Taxonomy Vocabulary Tests

**Files:**
- Modify: `tests/risk-taxonomy.test.ts`
- Modify: `references/risks/risk-taxonomy.yaml`

- [ ] **Step 1: Write the failing test**

Append a test that loads `references/risks/risk-taxonomy.yaml` and asserts:

```ts
test("risk taxonomy covers production risk review gap vocabulary without new first-level codes", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  const codes = taxonomy.scoreEntries.map((entry) => entry.code);

  assert.equal(codes.includes("FOLDABLE_ADAPTATION_RISK"), false);
  assert.equal(codes.includes("WEB_NATIVE_ADAPTATION_RISK"), false);
  assert.equal(codes.includes("INTERACTION_FLOW_RISK"), false);
  assert.equal(codes.includes("MALL_RISK"), false);
  assert.equal(codes.includes("MEDICAL_RISK"), false);

  const byCode = new Map(taxonomy.scoreEntries.map((entry) => [entry.code, entry]));
  const api = byCode.get("API_USAGE_DEVIATION");
  const layout = byCode.get("UI_LAYOUT_OR_BREAKPOINT_MISMATCH");
  const state = byCode.get("DATA_STATE_CONSISTENCY_RISK");
  const partial = byCode.get("REQUIREMENT_PARTIALLY_IMPLEMENTED");
  const errors = byCode.get("ERROR_HANDLING_OR_VALIDATION_RISK");
  const maintainability = byCode.get("READABILITY_OR_MAINTAINABILITY_RISK");

  assert.ok(api);
  assert.match(api.description, /真实 import/);
  assert.ok(api.matchHints.includes("指定 Kit"));
  assert.ok(api.matchHints.includes("本地同名函数"));
  assert.ok(api.matchHints.includes("HTTP endpoint"));

  assert.ok(layout);
  assert.match(layout.description, /折叠屏/);
  assert.match(layout.description, /Web\\/Native 断点同步/);
  assert.ok(layout.matchHints.includes("浅层窗口"));
  assert.ok(layout.matchHints.includes("折痕区域"));
  assert.ok(layout.matchHints.includes("CSS media query"));

  assert.ok(state);
  assert.ok(state.matchHints.includes("导航栈"));
  assert.ok(state.matchHints.includes("popup 状态"));

  assert.ok(partial);
  assert.ok(partial.matchHints.includes("交互链路不完整"));
  assert.ok(partial.matchHints.includes("无响应按钮"));

  assert.ok(errors);
  assert.ok(errors.matchHints.includes("静默吞没"));
  assert.ok(errors.matchHints.includes("仅 return 拦截"));

  assert.ok(maintainability);
  assert.ok(maintainability.matchHints.includes("死代码"));
  assert.ok(maintainability.matchHints.includes("技术栈混用"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts`

Expected: FAIL because the production gap vocabulary is not fully present.

- [ ] **Step 3: Update taxonomy**

Edit `references/risks/risk-taxonomy.yaml` only within existing entries:

- `API_USAGE_DEVIATION`: add hard wording for specified Kit/API/component use and add hints for real import, symbol calls, traceable wrappers, local same-name functions, Mock substitutes, static placeholders, HTTP endpoint, AtomicServiceWeb, MapComponent, FunctionalButton, openLink.
- `UI_LAYOUT_OR_BREAKPOINT_MISMATCH`: add wording for window form factors, foldables, hover state, crease region, Web/Native breakpoint sync and hints for shallow window, sheet form, popup form, foldable, hover state, crease region, vertical breakpoint, orientation change, Web breakpoint, CSS media query, relative units, safe-area avoidance.
- `DATA_STATE_CONSISTENCY_RISK`: add hints for navigation stack, popup state, dialog state, return state, orientation change, page stack, state cleanup.
- `REQUIREMENT_PARTIALLY_IMPLEMENTED`: add hints for incomplete interaction chain, broken core chain, empty implementation, unresponsive buttons, missing delete function, loading state, pagination load.
- `ERROR_HANDLING_OR_VALIDATION_RISK`: add hints for swallowed errors, empty catch, return-only blocking, missing user prompt, missing confirmation dialog, accidental operation.
- `READABILITY_OR_MAINTAINABILITY_RISK`: add hints for dead code, template remnants, inconsistent directory organization, mixed technical stack, decorator version inconsistency, excessive route branches.

- [ ] **Step 4: Run taxonomy tests**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts`

Expected: PASS.

### Task 2: Rubric Skill Priority Rules

**Files:**
- Modify: `tests/opencode-rubric-scoring.test.ts`
- Modify: `.opencode/skills/hmos-rubric-scoring/SKILL.md`

- [ ] **Step 1: Write the failing test**

Add assertions that the rubric skill contains:

```ts
assert.match(skillText, /风险 taxonomy 判定优先级/);
assert.match(skillText, /真实 import、符号调用或可追溯到 Kit\\/API 的封装/);
assert.match(skillText, /同一代码位置、同一失败机制、同一 canonical code/);
assert.match(skillText, /先判断是否为明确需求缺失/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/opencode-rubric-scoring.test.ts`

Expected: FAIL because the rubric skill does not yet contain all priority wording.

- [ ] **Step 3: Update rubric skill**

In `.opencode/skills/hmos-rubric-scoring/SKILL.md`, extend “风险输出规则” with a “风险 taxonomy 判定优先级” subsection:

1. Rule-covered same canonical issue is not repeated by rubric risk.
2. Specified Kit/API/component hard rule maps to `API_USAGE_DEVIATION`.
3. Completely unusable core feature maps to `REQUIREMENT_NOT_IMPLEMENTED`.
4. Partial feature/interaction/edge-state gap maps to `REQUIREMENT_PARTIALLY_IMPLEMENTED`.
5. Breakpoint/window/foldable/Web sync/component responsive parameter problems map to `UI_LAYOUT_OR_BREAKPOINT_MISMATCH`.
6. Navigation stack, popup/dialog/cache/global state sync maps to `DATA_STATE_CONSISTENCY_RISK`.
7. Error swallowing, validation, failure feedback, confirmation mechanism maps to `ERROR_HANDLING_OR_VALIDATION_RISK`.

- [ ] **Step 4: Run rubric skill tests**

Run: `node --import tsx --test tests/opencode-rubric-scoring.test.ts`

Expected: PASS.

### Task 3: Rule Skill Canonical Mapping Rules

**Files:**
- Modify: `tests/opencode-rule-assessment.test.ts`
- Modify: `.opencode/skills/hmos-rule-assessment/SKILL.md`

- [ ] **Step 1: Write the failing test**

Add assertions that the rule skill contains:

```ts
assert.match(skillText, /canonical taxonomy code/);
assert.match(skillText, /行业\\/场景规则不得新增行业 taxonomy code/);
assert.match(skillText, /多个规则触发同一维度时仍保留多条规则违规/);
assert.match(skillText, /同一维度下不同规则、不同证据、不同失败机制不得互相抑制/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/opencode-rule-assessment.test.ts`

Expected: FAIL because the rule skill does not yet contain all canonical mapping wording.

- [ ] **Step 3: Update rule skill**

In `.opencode/skills/hmos-rule-assessment/SKILL.md`, add a “规则到 canonical taxonomy 的归类要求” subsection:

1. Every violation must preserve stable `sourceRuleId` semantics through `rule_id`.
2. Every violation must have exactly one canonical taxonomy code in reasoning.
3. Industry or scenario rules must map by risk nature, not by industry labels.
4. Multiple independent rules on the same rubric dimension remain separate.
5. Only same location, same failure mechanism and same canonical code can suppress duplicate rubric risk during fusion.
6. Different rules, evidence or failure mechanisms under the same dimension must not suppress each other.

- [ ] **Step 4: Run rule skill tests**

Run: `node --import tsx --test tests/opencode-rule-assessment.test.ts`

Expected: PASS.

### Task 4: Full Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --import tsx --test tests/risk-taxonomy.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: TypeScript build succeeds.

- [ ] **Step 3: Review diff**

Run: `git diff -- references/risks/risk-taxonomy.yaml .opencode/skills/hmos-rubric-scoring/SKILL.md .opencode/skills/hmos-rule-assessment/SKILL.md tests/risk-taxonomy.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts`

Expected: diff only contains planned taxonomy vocabulary, skill instruction, and focused test changes.

