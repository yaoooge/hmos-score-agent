# Rule Applicability And Agent Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional rule applicability patterns for `text_pattern` rules and make `not_implemented` rules consistently route to the rule agent instead of being downgraded to `不涉及`.

**Architecture:** Extend the text-pattern detector config with an optional `applicabilityPatterns` field, teach the text evaluator to emit `不涉及` when a rule has no applicable code context, and remove the static-layer downgrade that currently swallows `not_implemented` rules before they become assisted candidates. Keep old text rules backward compatible by preserving the current two-state behavior when `applicabilityPatterns` is absent.

**Tech Stack:** TypeScript, Node.js test runner, existing rule engine / evaluator pipeline

---

### Task 1: Add Failing Tests For Applicability Semantics

**Files:**
- Modify: `tests/rule-engine.test.ts`
- Test: `tests/rule-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add three focused tests near the existing rule-engine behavior tests:

```ts
test("runRuleEngine marks text-pattern rules as 不涉及 when applicability patterns do not match", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count = 1;\n",
  });

  const runtimeRules: CaseRuleDefinition[] = [
    {
      pack_id: "custom",
      rule_id: "CUSTOM-RULE-001",
      rule_name: "禁止在接口中定义构造签名",
      rule_source: "must_rule",
      summary: "禁止在接口中定义构造签名",
      priority: "P1",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/*.ets"],
        astSignals: [],
        llmPrompt: "",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
  ];

  const result = runTextPatternRule(
    {
      pack_id: "custom",
      rule_id: "CUSTOM-TEXT-001",
      rule_source: "forbidden_pattern",
      summary: "禁止在 type 或 interface 中定义构造签名。",
      detector_kind: "text_pattern",
      detector_config: {
        fileExtensions: [".ets"],
        applicabilityPatterns: ["\\binterface\\b|\\btype\\b"],
        patterns: ["^\\s*new\\s*\\([^)]*\\)\\s*:\\s*[^;{]+;?$"],
      },
      fallback_policy: "agent_assisted",
    },
    await collectEvidence(makeCaseInput(caseDir)),
  );

  assert.equal(result.result, "不涉及");
});

test("runRuleEngine marks text-pattern rules as 满足 when applicability patterns match without violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "interface Reader {\n  read(): void;\n}\n",
  });

  const result = runTextPatternRule(
    {
      pack_id: "custom",
      rule_id: "CUSTOM-TEXT-002",
      rule_source: "forbidden_pattern",
      summary: "禁止在 type 或 interface 中定义构造签名。",
      detector_kind: "text_pattern",
      detector_config: {
        fileExtensions: [".ets"],
        applicabilityPatterns: ["\\binterface\\b|\\btype\\b"],
        patterns: ["^\\s*new\\s*\\([^)]*\\)\\s*:\\s*[^;{]+;?$"],
      },
      fallback_policy: "agent_assisted",
    },
    await collectEvidence(makeCaseInput(caseDir)),
  );

  assert.equal(result.result, "满足");
});

test("runRuleEngine keeps not-implemented rules in assisted candidates even without direct evidence", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.staticRuleAuditResults.some(
      (item) => item.rule_id === "ARKTS-MUST-001" && item.result === "未接入判定器",
    ),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "ARKTS-MUST-001"),
    true,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --import tsx --test tests/rule-engine.test.ts
```

Expected:

- the new applicability tests fail because `runTextPatternRule()` still returns only `满足 / 不满足`
- the new assisted-candidate test fails because `ARKTS-MUST-001` is still downgraded to `不涉及`

- [ ] **Step 3: Commit the red test state only if you are working on an isolated branch**

```bash
git status --short
```

Expected:

- only the test file is modified
- do not commit a knowingly failing state on `main`

### Task 2: Implement Applicability-Aware Text Pattern Evaluation

**Files:**
- Modify: `src/rules/evaluators/textPatternEvaluator.ts`
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify: `src/rules/packs/shared/ruleFactories.ts`
- Test: `tests/rule-engine.test.ts`

- [ ] **Step 1: Extend detector config typing**

Update the rule types so text-pattern detector config can optionally carry applicability patterns:

```ts
export interface TextPatternDetectorConfig {
  fileExtensions?: string[];
  patterns?: string[];
  applicabilityPatterns?: string[];
}
```

and use that shape where `text_pattern` rules read detector config.

- [ ] **Step 2: Extend the shared text-rule factory without breaking old call sites**

Update `createTextRule()` to accept an optional sixth argument:

```ts
export function createTextRule(
  pack_id: string,
  rule_source: RuleSource,
  rule_id: string,
  summary: string,
  patterns: string[],
  applicabilityPatterns?: string[],
): RegisteredRule {
  return {
    pack_id,
    rule_id,
    rule_source,
    summary,
    detector_kind: "text_pattern",
    detector_config: {
      fileExtensions: defaultFileExtensions,
      patterns,
      ...(applicabilityPatterns?.length ? { applicabilityPatterns } : {}),
    },
    fallback_policy: "agent_assisted",
  };
}
```

- [ ] **Step 3: Implement three-state evaluation in `runTextPatternRule()`**

Refactor the evaluator to separately detect:

- applicability hits
- violation hits

Core behavior:

```ts
const applicabilityPatternTexts =
  ((rule.detector_config.applicabilityPatterns as string[] | undefined) ?? []).filter(Boolean);
const applicabilityPatterns = compilePatterns(applicabilityPatternTexts);
const applicabilityMatches =
  applicabilityPatterns.length === 0
    ? undefined
    : evidence.workspaceFiles
        .filter((file) => fileExtensions.includes(path.extname(file.relativePath).toLowerCase()))
        .map((file) => findTextPatternMatch(file, applicabilityPatterns, keepComments))
        .filter((match): match is TextPatternMatch => Boolean(match));

if (applicabilityPatterns.length > 0 && (applicabilityMatches?.length ?? 0) === 0) {
  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: "不涉及",
    conclusion: "未发现该规则的适用场景。",
    matchedFiles: [],
    matchedLocations: [],
    matchedSnippets: [],
  };
}

if (matchedFiles.length > 0) {
  return { ...violationResult };
}

return {
  rule_id: rule.rule_id,
  rule_source: rule.rule_source,
  result: "满足",
  conclusion:
    applicabilityPatterns.length > 0
      ? "检测到规则适用场景，未发现违规命中。"
      : "未发现该规则的命中证据。",
  matchedFiles: [],
  matchedLocations: [],
  matchedSnippets: [],
};
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run:

```bash
node --import tsx --test tests/rule-engine.test.ts
```

Expected:

- the two applicability tests now pass
- the `not_implemented` candidate test may still fail until Task 3

### Task 3: Route Not-Implemented Rules To Assisted Candidates

**Files:**
- Modify: `src/rules/ruleEngine.ts`
- Test: `tests/rule-engine.test.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Remove the downgrade for ordinary `未接入判定器` rules**

Replace the current static-result normalization block:

```ts
if (rule.result === "未接入判定器" && (directEvidence?.evidenceFiles?.length ?? 0) === 0) {
  return {
    ...normalizedRule,
    result: "不涉及",
    conclusion: "未发现相关实现证据，当前不涉及。",
  };
}
```

with logic that only preserves special handling for `caseRuleIds`, while leaving ordinary `未接入判定器` rules untouched.

- [ ] **Step 2: Update tests that currently assert old downgrade behavior**

Change assertions in `tests/rule-engine.test.ts` and `tests/score-agent.test.ts` so they now expect:

- `not_implemented` rules to remain `未接入判定器` in `staticRuleAuditResults`
- those same rules to appear in `assistedRuleCandidates`
- merged results to become `待人工复核` only after `ruleMergeNode` fallback, not earlier in `runRuleEngine`

- [ ] **Step 3: Run the focused workflow-adjacent tests**

Run:

```bash
node --import tsx --test tests/rule-engine.test.ts tests/score-agent.test.ts
```

Expected:

- PASS
- no remaining assertions expecting unsupported static rules to disappear from agent candidates

### Task 4: Verify Full Affected Test Set And Finalize

**Files:**
- Modify: `tests/rule-pack-registry.test.ts` only if type shape snapshots need updating
- Modify: `tests/rule-pack-yaml-export.test.ts` only if detector config serialization now includes optional fields in new cases

- [ ] **Step 1: Run the full affected test suite**

Run:

```bash
node --import tsx --test tests/rule-engine.test.ts tests/rule-pack-registry.test.ts tests/rule-pack-yaml-export.test.ts tests/score-agent.test.ts tests/scoring.test.ts tests/score-fusion.test.ts
```

Expected:

- all tests pass
- no regressions in score fusion or rule-pack export behavior

- [ ] **Step 2: Inspect the diff for unintended rule-pack churn**

Run:

```bash
git diff -- src/rules/evaluators/textPatternEvaluator.ts src/rules/ruleEngine.ts src/rules/engine/ruleTypes.ts src/rules/packs/shared/ruleFactories.ts tests/rule-engine.test.ts tests/score-agent.test.ts tests/rule-pack-registry.test.ts tests/rule-pack-yaml-export.test.ts
```

Expected:

- changes are limited to applicability support, agent routing, and directly affected test expectations

- [ ] **Step 3: Commit the implementation**

```bash
git add src/rules/evaluators/textPatternEvaluator.ts src/rules/ruleEngine.ts src/rules/engine/ruleTypes.ts src/rules/packs/shared/ruleFactories.ts tests/rule-engine.test.ts tests/score-agent.test.ts tests/rule-pack-registry.test.ts tests/rule-pack-yaml-export.test.ts
git commit -m "feat: add rule applicability-aware routing"
```

- [ ] **Step 4: Record final verification evidence in the handoff**

Include:

- exact test command run
- pass count
- note whether any existing rule packs still rely on compatibility mode without `applicabilityPatterns`
