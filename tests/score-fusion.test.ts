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
  assert.equal(
    arktsDetail.score_fusion.final_score,
    arktsDetail.agent_evaluation.base_score + arktsDetail.score_fusion.rule_delta,
  );
});
