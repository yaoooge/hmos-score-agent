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
    dimension.item_summaries.map((item) => {
      const lowestBand = item.scoring_bands.at(-1);
      assert.ok(lowestBand);
      return {
        dimension_name: dimension.name,
        item_name: item.name,
        score: lowestBand.score,
        max_score: item.weight,
        matched_band_score: lowestBand.score,
        rationale: "agent 给出低分。",
        evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
        confidence: "medium" as const,
        review_required: false,
      };
    }),
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

  assert.equal(
    result.totalScore,
    itemScores.reduce((sum, item) => sum + item.score, 0),
  );
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
  assert.ok(
    Number.isInteger(arktsDetail.score_fusion.final_score),
    "rule-adjusted score should be snapped to a declared discrete rubric band",
  );
  assert.equal(
    snapshot.dimension_summaries
      .find((dimension) => dimension.name === arktsDetail.dimension_name)
      ?.item_summaries.find((item) => item.name === arktsDetail.item_name)
      ?.scoring_bands.some((band) => band.score === arktsDetail.score_fusion.final_score),
    true,
  );
});

test("fuseRubricScoreWithRules falls back to top rubric band when rubric output is invalid", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);

  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: undefined,
    rubricAgentRunStatus: "invalid_output",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/Index.ets"],
      hasPatch: true,
    },
  });

  for (const detail of result.scoreFusionDetails) {
    const dimension = snapshot.dimension_summaries.find((item) => item.name === detail.dimension_name);
    const metric = dimension?.item_summaries.find((item) => item.name === detail.item_name);
    assert.equal(detail.agent_evaluation.base_score, metric?.scoring_bands[0].score);
  }
  assert.match(result.humanReviewItems[0]?.current_assessment ?? "", /当前按满分保留/);
});

test("fuseRubricScoreWithRules preserves deduction_trace from rubric scoring result", async () => {
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const firstDimension = snapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];
  const deductedBand = firstItem.scoring_bands[1];
  assert.ok(deductedBand);

  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score:
        dimension.name === firstDimension.name && item.name === firstItem.name
          ? deductedBand.score
          : item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score:
        dimension.name === firstDimension.name && item.name === firstItem.name
          ? deductedBand.score
          : item.scoring_bands[0].score,
      rationale: "存在明确负面证据。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
      confidence: "medium" as const,
      review_required: false,
      deduction_trace:
        dimension.name === firstDimension.name && item.name === firstItem.name
          ? {
              code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
              impact_scope: "影响页面初始化稳定性",
              rubric_comparison: "未命中高分档；命中当前档。",
              deduction_reason: "发现空值未防御。",
            }
          : undefined,
    })),
  );

  const result = fuseRubricScoreWithRules({
    taskType: "bug_fix",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "存在单项扣分。", overall_confidence: "medium" },
      item_scores: itemScores,
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    rubricAgentRunStatus: "success",
    ruleAuditResults: [],
    ruleViolations: [],
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/Index.ets"],
      hasPatch: true,
    },
  });

  const detail = result.scoreFusionDetails.find(
    (item) => item.dimension_name === firstDimension.name && item.item_name === firstItem.name,
  );
  assert.equal(detail?.agent_evaluation.deduction_trace?.impact_scope, "影响页面初始化稳定性");
});

test("fuseRubricScoreWithRules snaps rule-adjusted scores back to declared rubric bands", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const itemScores = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "未找到明确负面证据，按满分保留。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "high" as const,
      review_required: false,
    })),
  );
  const ruleAuditResults: RuleAuditResult[] = [
    {
      rule_id: "ARKTS-MUST-015",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "命中 must_rule。",
    },
    {
      rule_id: "ARKTS-FORBID-001",
      rule_source: "forbidden_pattern",
      result: "不满足",
      conclusion: "命中 forbidden_pattern any。",
    },
    {
      rule_id: "ARKTS-FORBID-003",
      rule_source: "forbidden_pattern",
      result: "不满足",
      conclusion: "命中 forbidden_pattern index access。",
    },
  ];

  const result = fuseRubricScoreWithRules({
    taskType: "full_generation",
    rubric,
    rubricSnapshot: snapshot,
    rubricScoringResult: {
      summary: { overall_assessment: "基础分满分。", overall_confidence: "high" },
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

  const securityDetail = result.scoreFusionDetails.find(
    (detail) =>
      detail.dimension_name === "风险控制与稳定性" && detail.item_name === "安全与边界意识",
  );
  assert.ok(securityDetail);
  assert.equal(securityDetail.score_fusion.rule_delta, -1.95);
  assert.equal(securityDetail.score_fusion.final_score, 1);

  const securityRubricItem = rubric.dimensions
    .find((dimension) => dimension.name === "风险控制与稳定性")
    ?.items.find((item) => item.name === "安全与边界意识");
  assert.ok(securityRubricItem);
  assert.equal(
    securityRubricItem?.scoringBands.some(
      (band) => band.score === securityDetail.score_fusion.final_score,
    ),
    true,
  );

  const riskDimension = result.dimensionScores.find(
    (dimension) => dimension.dimension_name === "风险控制与稳定性",
  );
  assert.equal(riskDimension?.score, 5);
  assert.ok(Number.isInteger(riskDimension?.score));
});
