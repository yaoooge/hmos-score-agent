import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import { computeScoreBreakdown } from "../src/scoring/scoringEngine.js";
import type {
  ConstraintSummary,
  FeatureExtraction,
  RuleAuditResult,
  CaseRuleDefinition,
} from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

// 这里的夹具只保留评分真正需要的上下文，避免测试被 workflow 细节绑死。
const constraintSummary: ConstraintSummary = {
  explicitConstraints: ["bug fix"],
  contextualConstraints: ["keep module structure"],
  implicitConstraints: ["patch present"],
  classificationHints: ["bug_fix"],
};

const featureExtraction: FeatureExtraction = {
  basicFeatures: ["state management"],
  structuralFeatures: ["entry module"],
  semanticFeatures: ["restaurant domain"],
  changeFeatures: ["patch available"],
};

test("loadRubricForTaskType reads the latest structured rubric config from repo-local yaml", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);

  assert.equal(rubric.taskType, "bug_fix");
  assert.equal(rubric.evaluationMode, "auto_precheck_with_human_review");
  assert.ok(rubric.hardGates.some((gate) => gate.id === "G4"));
  assert.equal(rubric.scoringMethod, "discrete_band");
  assert.match(rubric.scoringNote, /是否命中问题/);
  assert.ok(rubric.commonRisks.includes("因顺手优化造成 diff 噪音和误修。"));
  assert.ok(rubric.reportEmphasis.includes("是否命中问题点。"));
  assert.ok(rubric.dimensions.length > 0);

  const precisionDimension = rubric.dimensions[0];
  assert.equal(precisionDimension.name, "改动精准度与最小侵入性");
  assert.match(precisionDimension.intent, /精准修复问题/);

  const rootCauseItem = precisionDimension.items[0];
  assert.equal(rootCauseItem.name, "问题点命中程度");
  assert.equal(rootCauseItem.weight, 10);
  assert.deepEqual(
    rootCauseItem.scoringBands.map((band) => band.score),
    [10, 8, 6, 3, 0],
  );
  assert.match(rootCauseItem.scoringBands[0].criteria, /直接命中根因/);
});

test("computeScoreBreakdown applies penalties and hard-gate caps", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-MUST-006",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "matched any",
    },
    {
      rule_id: "ARKTS-MUST-005",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "matched var",
    },
  ];

  const result = computeScoreBreakdown({
    taskType: "bug_fix",
    rubric,
    ruleAuditResults,
    ruleViolations: [],
    constraintSummary,
    featureExtraction,
    evidenceSummary: {
      workspaceFileCount: 4,
      originalFileCount: 3,
      changedFileCount: 2,
      changedFiles: [
        "entry/src/main/ets/pages/Index.ets",
        "entry/src/main/ets/common/models/Restaurant.ts",
      ],
      hasPatch: true,
    },
  });

  assert.ok(result.dimensionScores.length > 0);
  assert.ok(result.submetricDetails.length > 0);
  assert.equal(result.overallConclusion.hard_gate_triggered, true);
  assert.ok(result.overallConclusion.total_score <= 69);
  assert.ok(result.humanReviewItems.length > 0);
  assert.ok(result.risks.length > 0);
});

test("computeScoreBreakdown snaps penalized submetric scores to declared discrete bands", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-MUST-006",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "matched any",
    },
  ];

  const result = computeScoreBreakdown({
    taskType: "bug_fix",
    rubric,
    ruleAuditResults,
    ruleViolations: [],
    constraintSummary,
    featureExtraction,
    evidenceSummary: {
      workspaceFileCount: 4,
      originalFileCount: 3,
      changedFileCount: 2,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  const arktsMetric = result.submetricDetails.find(
    (detail) =>
      detail.dimension_name === "代码正确性与静态质量" &&
      detail.metric_name === "ArkTS/ArkUI语法与类型安全",
  );
  assert.equal(arktsMetric?.score, 6);

  for (const detail of result.submetricDetails) {
    const rubricDimension = rubric.dimensions.find((dimension) => dimension.name === detail.dimension_name);
    const rubricItem = rubricDimension?.items.find((item) => item.name === detail.metric_name);
    assert.ok(rubricItem, `missing rubric item for ${detail.dimension_name} / ${detail.metric_name}`);
    assert.equal(
      rubricItem?.scoringBands.some((band) => band.score === detail.score),
      true,
      `score ${detail.score} should match one declared band for ${detail.dimension_name} / ${detail.metric_name}`,
    );
  }
});

test("computeScoreBreakdown triggers hard gate when case P0 rule fails", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const caseRuleDefinitions: CaseRuleDefinition[] = [
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      rule_source: "must_rule",
      summary: "登录页必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/pages/*.ets"],
        astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
        llmPrompt: "检查登录按钮",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
  ];

  const result = computeScoreBreakdown({
    taskType: "full_generation",
    rubric,
    ruleAuditResults: [
      {
        rule_id: "HM-REQ-008-01",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "未使用 LoginWithHuaweiIDButton",
      },
    ],
    ruleViolations: [],
    constraintSummary,
    featureExtraction,
    evidenceSummary: {
      workspaceFileCount: 4,
      originalFileCount: 3,
      changedFileCount: 2,
      changedFiles: ["entry/src/main/ets/pages/LoginPage.ets"],
      hasPatch: true,
    },
    caseRuleDefinitions,
  });

  assert.equal(result.hardGateTriggered, true);
  assert.match(result.hardGateReason ?? "", /case_rule/i);
});
