import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import { computeScoreBreakdown } from "../src/scoring/scoringEngine.js";
import type { ConstraintSummary, FeatureExtraction, RuleAuditResult } from "../src/types.js";

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
