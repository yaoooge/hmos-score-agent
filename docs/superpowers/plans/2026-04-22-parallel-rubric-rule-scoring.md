# Parallel Rubric Rule Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-version rubric-first scoring workflow with parallel rubric scoring and rule assessment branches, expanded dimension report details, and no compatibility layer for the old feature extraction or generic agent artifacts.

**Architecture:** The workflow splits after task classification into a rubric branch and a rule branch. The rubric branch produces item-level base scores through a strict rubric scoring agent protocol; the rule branch produces merged rule audit results. A new score fusion node combines rubric base scores and rule impacts into `ScoreComputation`, and report generation emits the expanded `dimension_results` schema.

**Tech Stack:** TypeScript, Node test runner, LangGraph `StateGraph`, AJV JSON Schema validation, Zod for agent output validation, existing case-aware tool contract patterns.

---

## File Map

- Create `src/agent/rubricScoring.ts`: owns rubric scoring payload construction, prompt rendering, strict JSON parsing, and rubric item coverage validation.
- Create `src/nodes/rubricScoringPromptBuilderNode.ts`: builds rubric scoring payload and prompt from workflow state.
- Create `src/nodes/rubricScoringAgentNode.ts`: invokes the rubric scoring agent and records success/failure status.
- Create `src/nodes/ruleAgentPromptBuilderNode.ts`: replaces `agentPromptBuilderNode` with explicit rule-agent naming.
- Create `src/nodes/ruleAssessmentAgentNode.ts`: replaces `agentAssistedRuleNode` with explicit rule-agent naming.
- Create `src/nodes/scoreFusionOrchestrationNode.ts`: replaces `scoringOrchestrationNode` in the main workflow and produces final `ScoreComputation`.
- Create `src/scoring/scoreFusion.ts`: pure score fusion helpers for tests and reuse.
- Modify `src/types.ts`: add rubric scoring, rule impact, score fusion detail, and report support types; remove `FeatureExtraction` from scoring inputs.
- Modify `src/workflow/state.ts`: add rubric/rule agent state names and remove `featureExtraction`.
- Modify `src/workflow/scoreWorkflow.ts`: remove `featureExtractionNode`, add parallel rubric/rule branches, and join into score fusion.
- Modify `src/workflow/observability/types.ts`, `nodeLabels.ts`, and `nodeSummaries.ts`: remove old node IDs and add new rubric/rule/fusion node IDs.
- Modify `src/nodes/reportGenerationNode.ts`: emit expanded `dimension_results` with `agent_evaluation_summary`, `rule_violation_summary`, item-level `agent_evaluation`, `rule_impacts`, and `score_fusion`.
- Modify `src/nodes/persistAndUploadNode.ts`: write new rubric/rule/fusion artifacts and stop writing `feature-extraction.json` or `agent-prompt.txt`.
- Modify `references/scoring/report_result_schema.json`: require the expanded dimension and item result fields and remove item-level `rationale/evidence`.
- Modify `tests/fixtures/report_result_schema.json`: keep fixture schema aligned with production schema.
- Delete `src/nodes/featureExtractionNode.ts`, `src/nodes/agentPromptBuilderNode.ts`, `src/nodes/agentAssistedRuleNode.ts`, and `src/nodes/scoringOrchestrationNode.ts` after replacements are wired.
- Update tests in `tests/scoring.test.ts`, `tests/score-agent.test.ts`, `tests/workflow-node-summary.test.ts`, `tests/workflow-event-logger.test.ts`, `tests/schema-validator.test.ts`, and `tests/report-renderer.test.ts`.

## Task 1: Rubric Scoring Protocol

**Files:**
- Create: `src/agent/rubricScoring.ts`
- Modify: `src/types.ts`
- Test: `tests/rubric-scoring.test.ts`

- [ ] **Step 1: Write failing tests for rubric scoring output validation**

Create `tests/rubric-scoring.test.ts`:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildRubricScoringPayload,
  parseRubricScoringResultStrict,
  renderRubricScoringPrompt,
} from "../src/agent/rubricScoring.js";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { ConstraintSummary } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

const constraintSummary: ConstraintSummary = {
  explicitConstraints: ["新增餐厅列表页面"],
  contextualConstraints: ["保持工程结构"],
  implicitConstraints: ["有 patch"],
  classificationHints: ["full_generation"],
};

test("parseRubricScoringResultStrict accepts complete rubric item coverage", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: `根据 ${item.name} 的最高档标准，当前证据满足要求。`,
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high",
      review_required: false,
    })),
  );

  const parsed = parseRubricScoringResultStrict(
    JSON.stringify({
      summary: {
        overall_assessment: "整体满足 rubric 高分要求。",
        overall_confidence: "high",
      },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: ["结构清晰"],
      main_issues: [],
    }),
    snapshot,
  );

  assert.equal(parsed.item_scores.length, itemScores.length);
});

test("parseRubricScoringResultStrict rejects missing rubric items", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const firstDimension = snapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];

  assert.throws(
    () =>
      parseRubricScoringResultStrict(
        JSON.stringify({
          summary: {
            overall_assessment: "只返回了一个 item。",
            overall_confidence: "medium",
          },
          item_scores: [
            {
              dimension_name: firstDimension.name,
              item_name: firstItem.name,
              score: firstItem.scoring_bands[0].score,
              max_score: firstItem.weight,
              matched_band_score: firstItem.scoring_bands[0].score,
              rationale: "证据不足。",
              evidence_used: [],
              confidence: "low",
              review_required: true,
            },
          ],
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        }),
        snapshot,
      ),
    /missing rubric scoring items/,
  );
});

test("parseRubricScoringResultStrict rejects scores outside declared bands", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item, index) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: index === 0 ? 999 : item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: index === 0 ? 999 : item.scoring_bands[0].score,
      rationale: "评分说明",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "medium",
      review_required: false,
    })),
  );

  assert.throws(
    () =>
      parseRubricScoringResultStrict(
        JSON.stringify({
          summary: {
            overall_assessment: "存在非法分数。",
            overall_confidence: "medium",
          },
          item_scores: itemScores,
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        }),
        snapshot,
      ),
    /score must match declared rubric band/,
  );
});

test("renderRubricScoringPrompt forbids rule-id judgement and requires item scores", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const payload = buildRubricScoringPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复页面 bug",
      originalProjectPath: "/case/original",
      generatedProjectPath: "/case/workspace",
      patchPath: "/case/diff/changes.patch",
    },
    caseRoot: "/case",
    effectivePatchPath: "/case/diff/changes.patch",
    taskType: "bug_fix",
    constraintSummary,
    rubricSnapshot: snapshot,
  });

  const prompt = renderRubricScoringPrompt(payload);

  assert.match(prompt, /逐项输出 rubric item 的评分/);
  assert.match(prompt, /不要判断规则 ID/);
  assert.match(prompt, /item_scores/);
});
```

- [ ] **Step 2: Run the failing rubric scoring tests**

Run:

```bash
npm test -- tests/rubric-scoring.test.ts
```

Expected: FAIL with module not found for `src/agent/rubricScoring.ts`.

- [ ] **Step 3: Implement minimal rubric scoring protocol**

Add the needed types to `src/types.ts`, then create `src/agent/rubricScoring.ts` with payload building, prompt rendering, and strict validation.

Key exported functions:

```ts
export function buildRubricScoringPayload(input: BuildRubricScoringPayloadInput): RubricScoringPayload;
export function renderRubricScoringPrompt(payload: RubricScoringPayload): string;
export function parseRubricScoringResultStrict(
  rawText: string,
  rubricSnapshot: LoadedRubricSnapshot,
): RubricScoringResult;
```

Use `zod` for shape validation and explicit post-parse checks for coverage, duplicate item keys, unknown item keys, and declared band scores.

- [ ] **Step 4: Run the rubric scoring tests until green**

Run:

```bash
npm test -- tests/rubric-scoring.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/agent/rubricScoring.ts tests/rubric-scoring.test.ts
git commit -m "feat: add rubric scoring protocol"
```

## Task 2: Report Schema Expansion

**Files:**
- Modify: `references/scoring/report_result_schema.json`
- Modify: `tests/fixtures/report_result_schema.json`
- Test: `tests/schema-validator.test.ts`

- [ ] **Step 1: Write failing schema tests for expanded item details**

Update `tests/schema-validator.test.ts` so the valid payload includes `agent_evaluation_summary`, `rule_violation_summary`, item-level `agent_evaluation`, `rule_impacts`, and `score_fusion`. Add a rejection test proving old `rationale/evidence` item fields are no longer accepted.

Add this assertion:

```ts
assert.throws(
  () =>
    validateReportResult(
      {
        ...validResult,
        dimension_results: [
          {
            dimension_name: "代码正确性与静态质量",
            dimension_intent: "语法与静态质量",
            score: 8,
            max_score: 10,
            comment: "存在规则扣分。",
            item_results: [
              {
                item_name: "ArkTS/ArkUI语法与类型安全",
                item_weight: 10,
                score: 8,
                matched_band: { score: 8, criteria: "基本满足。" },
                confidence: "medium",
                review_required: false,
                rationale: "旧字段",
                evidence: "旧字段",
              },
            ],
          },
        ],
      },
      schemaPath,
    ),
  /Schema validation failed/,
);
```

- [ ] **Step 2: Run schema tests to verify red**

Run:

```bash
npm test -- tests/schema-validator.test.ts
```

Expected: FAIL because schema does not yet require new fields and still accepts old item shape.

- [ ] **Step 3: Update both schemas**

Modify production and fixture schema so each `dimension_results[]` item requires:

```json
"agent_evaluation_summary",
"rule_violation_summary"
```

Modify each `item_results[]` item so it requires:

```json
"agent_evaluation",
"rule_impacts",
"score_fusion"
```

Remove `rationale` and `evidence` from item-level properties and required fields. Keep dimension-level `comment`.

- [ ] **Step 4: Run schema tests until green**

Run:

```bash
npm test -- tests/schema-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add references/scoring/report_result_schema.json tests/fixtures/report_result_schema.json tests/schema-validator.test.ts
git commit -m "feat: expand report result schema"
```

## Task 3: Score Fusion Engine

**Files:**
- Create: `src/scoring/scoreFusion.ts`
- Modify: `src/types.ts`
- Test: `tests/score-fusion.test.ts`

- [ ] **Step 1: Write failing score fusion tests**

Create `tests/score-fusion.test.ts`:

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { fuseRubricScoreWithRules } from "../src/scoring/scoreFusion.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { RubricScoringResult, RuleAuditResult } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

test("fuseRubricScoreWithRules uses rubric agent scores as the base", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands.at(-1)?.score ?? 0,
      max_score: item.weight,
      matched_band_score: item.scoring_bands.at(-1)?.score ?? 0,
      rationale: "agent 给出低分。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "medium" as const,
      review_required: false,
    })),
  );
  const rubricResult: RubricScoringResult = {
    summary: {
      overall_assessment: "agent 基础分偏低。",
      overall_confidence: "medium",
    },
    item_scores: itemScores,
    hard_gate_candidates: [],
    risks: [],
    strengths: [],
    main_issues: [],
  };

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: rubricResult,
    rubricAgentRunStatus: "success",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  assert.equal(result.totalScore, itemScores.reduce((sum, item) => sum + item.score, 0));
  assert.equal(result.scoreFusionDetails.length, itemScores.length);
});

test("fuseRubricScoreWithRules records rule impacts on affected rubric items", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "agent 给出高分。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high" as const,
      review_required: false,
    })),
  );
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-MUST-006",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "使用 any。",
    },
  ];

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "基础评分较高。", overall_confidence: "high" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults,
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const arktsDetail = result.scoreFusionDetails.find(
    (detail) => detail.item_name === "ArkTS/ArkUI语法与类型安全",
  );

  assert.ok(arktsDetail);
  assert.equal(arktsDetail.rule_impacts[0].rule_id, "ARKTS-MUST-006");
  assert.ok(arktsDetail.score_fusion.rule_delta < 0);
  assert.equal(arktsDetail.score_fusion.final_score, arktsDetail.agent_evaluation.base_score + arktsDetail.score_fusion.rule_delta);
});
```

- [ ] **Step 2: Run score fusion tests to verify red**

Run:

```bash
npm test -- tests/score-fusion.test.ts
```

Expected: FAIL with module not found for `src/scoring/scoreFusion.ts`.

- [ ] **Step 3: Implement score fusion**

Create `fuseRubricScoreWithRules` that:

- Uses rubric agent scores as base when `rubricAgentRunStatus === "success"`.
- Applies existing rule-to-metric penalty behavior to base scores.
- Produces `dimensionScores`, `submetricDetails`, `scoreFusionDetails`, risks, human review items, strengths, issues, hard gate state, and total score.
- Falls back to rule precheck scoring only when rubric agent output is unavailable or invalid.

- [ ] **Step 4: Run score fusion tests until green**

Run:

```bash
npm test -- tests/score-fusion.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/scoring/scoreFusion.ts tests/score-fusion.test.ts
git commit -m "feat: add rubric score fusion"
```

## Task 4: Report Generation Uses Fusion Details

**Files:**
- Modify: `src/nodes/reportGenerationNode.ts`
- Test: `tests/score-agent.test.ts`
- Test: `tests/report-renderer.test.ts`

- [ ] **Step 1: Write failing report generation tests**

Add a test that calls `reportGenerationNode` with `scoreComputation.scoreFusionDetails` and expects:

```ts
const firstDimension = (result.resultJson?.dimension_results as Array<Record<string, unknown>>)[0];
assert.ok(firstDimension.agent_evaluation_summary);
assert.ok(firstDimension.rule_violation_summary);
const firstItem = (firstDimension.item_results as Array<Record<string, unknown>>)[0];
assert.ok(firstItem.agent_evaluation);
assert.ok(firstItem.rule_impacts);
assert.ok(firstItem.score_fusion);
assert.equal("rationale" in firstItem, false);
assert.equal("evidence" in firstItem, false);
```

- [ ] **Step 2: Run the report generation test to verify red**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected: FAIL because `reportGenerationNode` does not emit the new fields.

- [ ] **Step 3: Update report generation**

Modify `buildDimensionResults` to read `state.scoreComputation.scoreFusionDetails`. For each dimension:

- Aggregate `agent_evaluation_summary`.
- Aggregate `rule_violation_summary`.
- For each item, write `agent_evaluation`, `rule_impacts`, and `score_fusion`.
- Stop writing item-level `rationale` and `evidence`.

- [ ] **Step 4: Run report tests until green**

Run:

```bash
npm test -- tests/score-agent.test.ts tests/report-renderer.test.ts tests/schema-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/reportGenerationNode.ts tests/score-agent.test.ts tests/report-renderer.test.ts
git commit -m "feat: report score fusion details"
```

## Task 5: Rubric and Rule Agent Nodes

**Files:**
- Create: `src/nodes/rubricScoringPromptBuilderNode.ts`
- Create: `src/nodes/rubricScoringAgentNode.ts`
- Create: `src/nodes/ruleAgentPromptBuilderNode.ts`
- Create: `src/nodes/ruleAssessmentAgentNode.ts`
- Delete after replacement: `src/nodes/agentPromptBuilderNode.ts`
- Delete after replacement: `src/nodes/agentAssistedRuleNode.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Write failing node tests**

Add tests that import the new node names and assert:

```ts
assert.equal(typeof rubricScoringPromptBuilderNode, "function");
assert.equal(typeof rubricScoringAgentNode, "function");
assert.equal(typeof ruleAgentPromptBuilderNode, "function");
assert.equal(typeof ruleAssessmentAgentNode, "function");
```

Add behavior tests:

```ts
const promptResult = await rubricScoringPromptBuilderNode(state, { logger: undefined });
assert.ok(promptResult.rubricScoringPromptText?.includes("逐项输出 rubric item"));

const skipped = await rubricScoringAgentNode(stateWithoutClient, { logger: undefined });
assert.equal(skipped.rubricAgentRunStatus, "skipped");
```

- [ ] **Step 2: Run node tests to verify red**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected: FAIL because new node files do not exist.

- [ ] **Step 3: Implement the four nodes**

Implement rubric nodes using `buildRubricScoringPayload`, `renderRubricScoringPrompt`, and `parseRubricScoringResultStrict`.

Implement rule nodes by moving the current logic from `agentPromptBuilderNode` and `agentAssistedRuleNode` into explicitly named replacements. Do not keep old node imports in workflow code.

- [ ] **Step 4: Run node tests until green**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/rubricScoringPromptBuilderNode.ts src/nodes/rubricScoringAgentNode.ts src/nodes/ruleAgentPromptBuilderNode.ts src/nodes/ruleAssessmentAgentNode.ts tests/score-agent.test.ts
git rm src/nodes/agentPromptBuilderNode.ts src/nodes/agentAssistedRuleNode.ts
git commit -m "feat: add explicit scoring agent nodes"
```

## Task 6: Workflow Rewire and Feature Extraction Removal

**Files:**
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `src/workflow/state.ts`
- Modify: `src/workflow/observability/types.ts`
- Modify: `src/workflow/observability/nodeLabels.ts`
- Modify: `src/workflow/observability/nodeSummaries.ts`
- Delete: `src/nodes/featureExtractionNode.ts`
- Delete: `src/nodes/scoringOrchestrationNode.ts`
- Test: `tests/workflow-node-summary.test.ts`
- Test: `tests/workflow-event-logger.test.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Write failing workflow tests**

Update workflow tests to assert:

```ts
assert.equal(getNodeLabel("rubricScoringAgentNode"), "Rubric Agent 评分");
assert.equal(getNodeLabel("ruleAssessmentAgentNode"), "规则 Agent 判定");
assert.equal(getNodeLabel("scoreFusionOrchestrationNode"), "评分融合");
```

Remove assertions for `featureExtractionNode`, `agentPromptBuilderNode`, `agentAssistedRuleNode`, and `scoringOrchestrationNode`.

Add a workflow log assertion that no `featureExtractionNode` appears in `logs/run.log`.

- [ ] **Step 2: Run workflow tests to verify red**

Run:

```bash
npm test -- tests/workflow-node-summary.test.ts tests/workflow-event-logger.test.ts tests/score-agent.test.ts
```

Expected: FAIL because workflow still uses old node names.

- [ ] **Step 3: Rewire workflow**

In `scoreWorkflow.ts`:

- Remove `featureExtractionNode`.
- Add `rubricScoringPromptBuilderNode`, `rubricScoringAgentNode`, `ruleAgentPromptBuilderNode`, `ruleAssessmentAgentNode`, and `scoreFusionOrchestrationNode`.
- Add parallel edges from `inputClassificationNode` to `ruleAuditNode` and `rubricPreparationNode`.
- Join into `scoreFusionOrchestrationNode` from `rubricScoringAgentNode` and `ruleMergeNode`.

In observability files:

- Remove old node IDs.
- Add labels and summaries for new nodes.

- [ ] **Step 4: Run workflow tests until green**

Run:

```bash
npm test -- tests/workflow-node-summary.test.ts tests/workflow-event-logger.test.ts tests/score-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflow src/nodes tests/workflow-node-summary.test.ts tests/workflow-event-logger.test.ts tests/score-agent.test.ts
git rm src/nodes/featureExtractionNode.ts src/nodes/scoringOrchestrationNode.ts
git commit -m "feat: parallelize scoring workflow"
```

## Task 7: Persistence Artifacts

**Files:**
- Modify: `src/nodes/persistAndUploadNode.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Write failing persistence tests**

Update the workflow artifact test to assert these files exist:

```ts
[
  "inputs/rubric-scoring-prompt.txt",
  "inputs/rubric-scoring-payload.json",
  "inputs/rule-agent-prompt.txt",
  "inputs/rule-agent-bootstrap-payload.json",
  "intermediate/rubric-agent-result.json",
  "intermediate/rule-agent-result.json",
  "intermediate/score-fusion.json",
  "intermediate/report-schema-version.json",
]
```

Also assert these files do not exist:

```ts
[
  "inputs/agent-prompt.txt",
  "inputs/agent-bootstrap-payload.json",
  "intermediate/feature-extraction.json",
]
```

- [ ] **Step 2: Run persistence tests to verify red**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected: FAIL because old artifacts are still written and new artifacts are missing.

- [ ] **Step 3: Update persistence**

Modify `persistAndUploadNode` to write only new artifact names. Include `state.scoreComputation.scoreFusionDetails` in `intermediate/score-fusion.json`.

- [ ] **Step 4: Run persistence tests until green**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/nodes/persistAndUploadNode.ts tests/score-agent.test.ts
git commit -m "feat: persist rubric and rule agent artifacts"
```

## Task 8: Full Verification and Docs

**Files:**
- Modify: `README.md`
- Modify: `评分服务设计文档.md`
- Modify: `需求清单.md` only if it describes current implemented flow rather than historical requirements.

- [ ] **Step 1: Write or update documentation expectations**

Update docs to describe:

- Rubric agent is the primary scorer.
- Rule agent only judges uncertain rules.
- Feature extraction node is removed.
- Report schema contains agent evaluation and rule impact details in dimension scoring.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add README.md 评分服务设计文档.md 需求清单.md
git commit -m "docs: update rubric-first scoring workflow"
```

## Self-Review

- Spec coverage: Tasks cover parallel rubric/rule agents, feature extraction removal, report schema expansion, no compatibility artifacts, explicit state names, score fusion, persistence, and tests.
- Placeholder scan: No placeholder markers or unspecified implementation steps remain.
- Type consistency: `RubricScoringResult`, `RuleImpactDetail`, `ScoreFusionDetail`, `rubricScoringPayload`, `ruleAgentBootstrapPayload`, and `scoreFusionDetails` are introduced before use.
- TDD coverage: Every production change has a preceding failing test step and an explicit command to verify red and green.
