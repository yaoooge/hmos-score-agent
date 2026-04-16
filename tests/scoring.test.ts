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

test("loadRubricForTaskType reads dimension and hard-gate config from repo-local rubric", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  assert.ok(rubric.dimensions.length > 0);
  assert.ok(rubric.hardGates.some((gate) => gate.id === "G4"));
  assert.equal(rubric.evaluationMode, "auto_precheck_with_human_review");
});

test("computeScoreBreakdown applies penalties and hard-gate caps", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const ruleAuditResults: RuleAuditResult[] = [
    { rule_id: "ARKTS-MUST-006", rule_source: "must_rule", result: "不满足", conclusion: "matched any" },
    { rule_id: "ARKTS-MUST-005", rule_source: "must_rule", result: "不满足", conclusion: "matched var" },
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
      changedFiles: ["entry/src/main/ets/pages/Index.ets", "entry/src/main/ets/common/models/Restaurant.ts"],
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
