# Scoring Core V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internalize all scoring references into the repository and implement the first real scoring core with schema validation, rubric-driven scoring, and text-based rule auditing.

**Architecture:** Copy rubric, rules, and schema into a repo-local `references/` tree, load them through a single config path, and build pure modules for schema validation, rubric loading, scoring, and rule evaluation. Keep LangGraph node order stable, but replace placeholder node internals with calls into the new modules so the workflow becomes testable end-to-end.

**Tech Stack:** TypeScript, Node.js built-in test runner, AJV, js-yaml, LangGraph

---

### Task 1: Internalize Reference Assets

**Files:**
- Create: `references/scoring/rubric.yaml`
- Create: `references/scoring/report_result_schema.json`
- Create: `references/scoring/arkts_internal_rules.yaml`
- Create: `references/scoring/README.md`
- Modify: `src/config.ts`
- Modify: `README.md`
- Test: `tests/config-reference.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("getConfig defaults referenceRoot to the repo-local scoring references directory", () => {
  delete process.env.DEFAULT_REFERENCE_ROOT;
  const config = getConfig();
  assert.equal(
    config.referenceRoot,
    path.resolve(process.cwd(), "references/scoring"),
  );
});

test("repo-local scoring reference files exist", async () => {
  for (const fileName of ["rubric.yaml", "report_result_schema.json", "arkts_internal_rules.yaml"]) {
    await fs.access(path.resolve(process.cwd(), "references/scoring", fileName));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/config-reference.test.ts`
Expected: FAIL because `references/scoring` does not exist and `getConfig()` still points at an external absolute path.

- [ ] **Step 3: Write minimal implementation**

```ts
referenceRoot:
  process.env.DEFAULT_REFERENCE_ROOT ??
  path.resolve(process.cwd(), "references/scoring"),
```

Copy the current external `rubric.yaml`, `report_result_schema.json`, and `arkts_internal_rules.yaml` into `references/scoring/`. Add a short `references/scoring/README.md` describing purpose and update the main README to document the new default location.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/config-reference.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add references/scoring README.md src/config.ts tests/config-reference.test.ts
git commit -m "chore: internalize scoring reference assets"
```

### Task 2: Add Schema Validation

**Files:**
- Create: `src/report/schemaValidator.ts`
- Create: `tests/schema-validator.test.ts`
- Modify: `src/nodes/reportGenerationNode.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("validateReportResult accepts schema-valid output", async () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.doesNotThrow(() => validateReportResult(makeValidResultJson(), schemaPath));
});

test("validateReportResult rejects invalid output with a useful error", async () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  assert.throws(
    () => validateReportResult({ basic_info: {} }, schemaPath),
    /schema validation failed/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/schema-validator.test.ts`
Expected: FAIL because `schemaValidator.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function validateReportResult(resultJson: Record<string, unknown>, schemaPath: string): void {
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(schema);
  if (!validate(resultJson)) {
    throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
  }
}
```

Then call `validateReportResult()` inside `reportGenerationNode()` before returning `resultJson`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/schema-validator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/report/schemaValidator.ts src/nodes/reportGenerationNode.ts tests/schema-validator.test.ts
git commit -m "feat: validate report output against schema"
```

### Task 3: Load Rubric and Compute Scores

**Files:**
- Create: `src/scoring/rubricLoader.ts`
- Create: `src/scoring/scoringEngine.ts`
- Create: `tests/scoring.test.ts`
- Modify: `src/types.ts`
- Modify: `src/nodes/scoringOrchestrationNode.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("loadRubricForTaskType reads dimension and hard-gate config from repo-local rubric", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  assert.ok(rubric.dimensions.length > 0);
  assert.ok(rubric.hardGates.some((gate) => gate.id === "G4"));
});

test("computeScoreBreakdown applies penalties and hard-gate caps", async () => {
  const result = computeScoreBreakdown({
    taskType: "bug_fix",
    rubric,
    ruleAuditResults: [
      { rule_id: "ARKTS-MUST-006", rule_source: "must_rule", result: "不满足", conclusion: "matched" },
    ],
    ruleViolations: [],
    constraintSummary,
    featureExtraction,
    evidence,
  });
  assert.ok(result.dimensionScores.length > 0);
  assert.ok(result.submetricDetails.length > 0);
  assert.equal(result.overallConclusion.hard_gate_triggered, true);
  assert.ok(result.overallConclusion.total_score <= 69);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/scoring.test.ts`
Expected: FAIL because `rubricLoader.ts` and `scoringEngine.ts` do not exist.

- [ ] **Step 3: Write minimal implementation**

Implement:
- `loadRubricForTaskType()` to parse `rubric.yaml`
- `computeScoreBreakdown()` as a pure function that:
  - initializes submetric scores at full weight
  - applies penalty levels from rule mappings
  - generates `dimension_scores`, `submetric_details`, `overall_conclusion`, `risks`, `human_review_items`
  - enforces G1/G2/G3/G4 score caps

Update `types.ts` to carry the richer scoring/report structures, and make `scoringOrchestrationNode()` delegate into the new loader + engine.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/scoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scoring/rubricLoader.ts src/scoring/scoringEngine.ts src/nodes/scoringOrchestrationNode.ts src/types.ts tests/scoring.test.ts
git commit -m "feat: add rubric-driven scoring engine"
```

### Task 4: Implement Text-Based Rule Engine

**Files:**
- Create: `src/rules/evidenceCollector.ts`
- Create: `src/rules/textRuleEvaluator.ts`
- Create: `src/rules/ruleMapping.ts`
- Create: `src/rules/ruleEngine.ts`
- Create: `tests/rule-engine.test.ts`
- Modify: `src/nodes/ruleAuditNode.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("runRuleEngine keeps source order and flags supported violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let x: any = 1;\nvar y = 2;\n",
  });
  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(result.ruleAuditResults[0]?.rule_id, "ARKTS-MUST-001");
  assert.ok(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足"));
  assert.ok(result.ruleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足"));
  assert.ok(result.ruleViolations.length >= 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/rule-engine.test.ts`
Expected: FAIL because the rule engine modules do not exist and `ruleAuditNode` still returns all `不涉及`.

- [ ] **Step 3: Write minimal implementation**

Implement:
- `collectEvidence()` to read workspace files, patch text, and changed files
- `ruleMapping.ts` with first-wave supported rules:
  - `ARKTS-MUST-005` (`var`)
  - `ARKTS-MUST-006` (`any` / `unknown`)
  - `ARKTS-MUST-003` (`#private`)
  - one or two obvious platform-risk patterns for G2/G3
- `evaluateTextRule()` to emit `满足 / 不满足 / 不涉及`
- `runRuleEngine()` to preserve YAML order and synthesize `ruleViolations`

Then update `ruleAuditNode()` to call `runRuleEngine()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/rule-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rules src/nodes/ruleAuditNode.ts tests/rule-engine.test.ts
git commit -m "feat: add text-based rule auditing engine"
```

### Task 5: Integrate the Workflow End-to-End

**Files:**
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `src/workflow/state.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("runScoreWorkflow produces non-empty scoring details using repo-local references", async (t) => {
  const result = await runScoreWorkflow({
    caseInput,
    caseDir,
    referenceRoot: path.resolve(process.cwd(), "references/scoring"),
    artifactStore,
  });

  const resultJson = JSON.parse(await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"));
  assert.ok(resultJson.dimension_scores.length > 0);
  assert.ok(resultJson.submetric_details.length > 0);
  assert.ok(resultJson.rule_audit_results.some((item: { result: string }) => item.result !== "不涉及"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: FAIL because the workflow still returns empty scores and placeholder rule results.

- [ ] **Step 3: Write minimal implementation**

Wire the new scoring and rule-engine outputs through workflow state so:
- `scoreComputation` holds the richer score breakdown
- `reportGenerationNode()` fills schema fields from the real score breakdown
- the workflow uses repo-local references by default

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nodes/reportGenerationNode.ts src/workflow/state.ts src/workflow/scoreWorkflow.ts tests/score-agent.test.ts
git commit -m "feat: integrate scoring core into workflow"
```

### Task 6: Full Verification

**Files:**
- Test: `tests/config-reference.test.ts`
- Test: `tests/schema-validator.test.ts`
- Test: `tests/scoring.test.ts`
- Test: `tests/rule-engine.test.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `node --import tsx --test tests/config-reference.test.ts tests/schema-validator.test.ts tests/scoring.test.ts tests/rule-engine.test.ts`
Expected: PASS

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Verify repo status**

Run: `git status --short`
Expected: only intended tracked changes remain before any optional final commit

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: implement scoring core v1"
```
