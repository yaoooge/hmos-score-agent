# Taxonomy Canonical Score Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement shared score taxonomy, canonical issue merge, and agent instruction updates so rubric risks and rule violations do not double-count the same issue while preserving multiple independent rule deductions on the same rubric item.

**Architecture:** Keep the implementation small. `riskTaxonomy.ts` parses both the new split taxonomy format and the previous `entries` format during migration. `scoreFusion.ts` builds internal canonical issue keys for risk de-duplication only; it does not collapse multiple independent rule impacts that hit the same dimension/item. Agent skills are updated to constrain risk output and rule reasoning without changing JSON contracts.

**Tech Stack:** TypeScript, Node test runner, js-yaml, existing rubric/rule scoring modules.

---

## File Structure

- Modify `references/risks/risk-taxonomy.yaml`: split `entries` into `score_taxonomy` and `review_only_taxonomy`, add one `primaryItem` per score entry.
- Delete `.opencode/skills/hmos-rubric-scoring/references/risk-taxonomy.yaml`: runtime generation derives the skill-local reference from `references/risks/risk-taxonomy.yaml`.
- Modify `src/scoring/riskTaxonomy.ts`: parse split taxonomy, expose score/review-only sets, preserve compatibility for callers using `taxonomy.entries`.
- Modify `src/scoring/scoreFusion.ts`: generate internal canonical issue ids for rubric risks and rule risks; suppress duplicated rubric risk when a rule risk represents the same issue; keep all distinct rule impacts on the same item.
- Modify `.opencode/skills/hmos-rubric-scoring/SKILL.md`: require `score_taxonomy`, single primary risk, and review-only handling.
- Modify `.opencode/skills/hmos-rule-assessment/SKILL.md`: require single primary landing point in reason and preserve hard Kit/API evidence wording.
- Test `tests/risk-taxonomy.test.ts`: verify split taxonomy parsing and one primary item per score entry.
- Test `tests/score-fusion.test.ts`: verify canonical rule/rubric de-dup and same-item multi-rule cumulative deductions.

## Task 1: Taxonomy Parser, Runtime Reference, And Data

**Files:**
- Modify: `references/risks/risk-taxonomy.yaml`
- Delete: `.opencode/skills/hmos-rubric-scoring/references/risk-taxonomy.yaml`
- Modify: `src/opencode/opencodeConfig.ts`
- Modify: `src/scoring/riskTaxonomy.ts`
- Test: `tests/risk-taxonomy.test.ts`

- [ ] **Step 1: Write failing taxonomy tests**

Add tests that assert:

```ts
assert.ok(taxonomy.scoreEntries.some((entry) => entry.code === "REQUIREMENT_NOT_IMPLEMENTED"));
assert.ok(taxonomy.reviewOnlyEntries.some((entry) => entry.code === "EVALUATION_METADATA_RISK"));
for (const entry of taxonomy.scoreEntries) {
  assert.ok(entry.primaryItem);
  assert.equal(typeof entry.primaryItem.dimension, "string");
  assert.equal(typeof entry.primaryItem.item, "string");
}
assert.equal(taxonomy.entries.some((entry) => entry.code === "EVALUATION_METADATA_RISK"), false);
```

- [ ] **Step 2: Run taxonomy test and verify red**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts`
Expected: FAIL because `scoreEntries`, `reviewOnlyEntries`, and `primaryItem` are not implemented.

- [ ] **Step 3: Implement parser, YAML split, and runtime-derived skill reference**

Delete the source skill copy `.opencode/skills/hmos-rubric-scoring/references/risk-taxonomy.yaml`. In `src/opencode/opencodeConfig.ts`, after copying skills into each runtime skills directory, copy `references/risks/risk-taxonomy.yaml` into `hmos-rubric-scoring/references/risk-taxonomy.yaml` under that runtime directory.

Update `RiskTaxonomyEntry` with:

```ts
primaryItem?: {
  dimension: string;
  item: string;
};
```

Update `RiskTaxonomy` with:

```ts
entries: RiskTaxonomyEntry[];
scoreEntries: RiskTaxonomyEntry[];
reviewOnlyEntries: RiskTaxonomyEntry[];
```

Parse root keys `version`, `entries`, `score_taxonomy`, `review_only_taxonomy`. For migration compatibility, if only `entries` exists, treat all entries except `EVALUATION_METADATA_RISK` as score entries and `EVALUATION_METADATA_RISK` as review-only. For new files, parse `score_taxonomy` and `review_only_taxonomy` directly.

- [ ] **Step 4: Run taxonomy test and verify green**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts`
Expected: PASS.

## Task 2: Canonical Risk Merge In Score Fusion

**Files:**
- Modify: `src/scoring/scoreFusion.ts`
- Test: `tests/score-fusion.test.ts`

- [ ] **Step 1: Write failing score fusion tests**

Add one test where rubric emits `LANGUAGE_CONSTRAINT_VIOLATION` with evidence `entry/src/main/ets/pages/Index.ets`, and a rule `ARKTS-FORBID-005` also violates the same file. Expected result: the rule risk remains, the rubric taxonomy risk is suppressed.

Add another test with two distinct rules that both hit `ArkTS/ArkUI语法与类型安全`. Expected result: `rule_impacts` contains both rule ids and `rule_delta` is the sum of both negative deltas.

- [ ] **Step 2: Run score fusion test and verify red**

Run: `node --import tsx --test tests/score-fusion.test.ts`
Expected: FAIL on duplicate rubric risk suppression because current fusion keeps both risks.

- [ ] **Step 3: Implement internal canonical helpers**

Add small helpers inside `scoreFusion.ts`:

```ts
type CanonicalIssue = {
  issueId: string;
  canonicalCode: string;
  source: "rubric" | "rule" | "build";
  primaryDimension: string;
  primaryItem: string;
  evidenceAnchor: string;
};
```

Build rubric canonical issues from taxonomy risk code, taxonomy primary item, task type, and normalized evidence anchor. Build rule canonical issues from stable rule-code mapping. Start minimal by mapping rule ids currently used by risk de-dup tests and existing ArkTS rule families to `LANGUAGE_CONSTRAINT_VIOLATION / 代码正确性与静态质量 / ArkTS/ArkUI语法与类型安全`.

Filter only rubric-origin risks whose issue id is present in rule-origin issue ids. Do not filter rule risks by dimension or item. Do not change `rule_impacts` accumulation.

- [ ] **Step 4: Run score fusion test and verify green**

Run: `node --import tsx --test tests/score-fusion.test.ts`
Expected: PASS.

## Task 3: Agent Skill Updates

**Files:**
- Modify: `.opencode/skills/hmos-rubric-scoring/SKILL.md`
- Modify: `.opencode/skills/hmos-rule-assessment/SKILL.md`
- Modify: `.opencode/prompts/hmos-rubric-scoring-system.md` only if the skill reference is insufficient
- Modify: `.opencode/prompts/hmos-rule-assessment-system.md` only if the skill reference is insufficient

- [ ] **Step 1: Update rubric skill text**

Add explicit instructions:

```md
- 只从 `score_taxonomy` 选择 `risk_code`；`review_only_taxonomy` 不得进入 `risks`。
- 每个风险只保留一个主落点，不要把同一根因拆成多个 taxonomy 风险。
- 如果规则融合阶段会覆盖同一事实，rubric 风险只保留独立于规则的后果。
```

- [ ] **Step 2: Update rule skill text**

Add explicit instructions:

```md
- 每条规则只说明一个主要 rubric 落点；多个独立规则即使落在同一维度，也仍各自判定。
- 规则要求指定 Kit/API 时，pass 必须有真实 import、符号调用或可追溯到 Kit 的封装；Axios、HTTP endpoint、本地同名函数不能等价。
```

- [ ] **Step 3: Run prompt/skill focused tests if present**

Run: `node --import tsx --test tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts`
Expected: PASS, or update tests if they assert old text.

## Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused verification**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts tests/score-fusion.test.ts tests/opencode-rubric-scoring.test.ts tests/opencode-rule-assessment.test.ts`
Expected: PASS.

- [ ] **Step 2: Inspect diff**

Run: `git diff -- references/risks/risk-taxonomy.yaml src/opencode/opencodeConfig.ts src/scoring/riskTaxonomy.ts src/scoring/scoreFusion.ts tests/risk-taxonomy.test.ts tests/score-fusion.test.ts tests/opencode-config.test.ts tests/opencode-config-generation.test.ts .opencode/skills/hmos-rubric-scoring/SKILL.md .opencode/skills/hmos-rule-assessment/SKILL.md docs/superpowers/specs/2026-05-22-score-stability-hardening-design.md`
Expected: only planned files changed.

## Self-Review

- Spec coverage: taxonomy split, single-source runtime reference generation, canonical issue merge, rule/rubric duplicate prevention, same-dimension multi-rule cumulative deductions, and skill updates are covered.
- Placeholder scan: no TBD/TODO placeholders are used.
- Type consistency: `primaryItem` is TypeScript camelCase while YAML uses `primaryItem`; existing `matchHints` casing is preserved to minimize parser churn.
