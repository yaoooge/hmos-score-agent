import fs from "node:fs/promises";
import path from "node:path";
import { validateReportResult } from "../report/schemaValidator.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

function buildDimensionResults(state: ScoreGraphState): Array<Record<string, unknown>> {
  const rubricSummary = state.rubricSnapshot;
  const dimensionScores = state.scoreComputation.dimensionScores;
  const submetricDetails = state.scoreComputation.submetricDetails;

  return (rubricSummary?.dimension_summaries ?? []).map((dimensionSummary) => {
    const dimensionScore = dimensionScores.find(
      (item) => item.dimension_name === dimensionSummary.name,
    );

    return {
      dimension_name: dimensionSummary.name,
      dimension_intent: dimensionSummary.intent,
      score: dimensionScore?.score ?? 0,
      max_score: dimensionScore?.max_score ?? dimensionSummary.weight,
      comment: dimensionScore?.comment ?? "",
      item_results: dimensionSummary.item_summaries.map((itemSummary) => {
        const detail = submetricDetails.find(
          (item) =>
            item.dimension_name === dimensionSummary.name && item.metric_name === itemSummary.name,
        );
        const matchedBand =
          itemSummary.scoring_bands.find((band) => band.score === detail?.score) ?? null;

        return {
          item_name: itemSummary.name,
          item_weight: itemSummary.weight,
          score: detail?.score ?? 0,
          matched_band: matchedBand,
          confidence: detail?.confidence ?? "low",
          review_required: detail?.review_required ?? true,
          rationale: detail?.rationale ?? "缺少对应评分明细。",
          evidence: detail?.evidence ?? "缺少对应证据。",
        };
      }),
    };
  });
}

export async function reportGenerationNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("reportGenerationNode");
  try {
    const schemaPath = path.join(config.referenceRoot, "report_result_schema.json");
    const schemaText = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaText) as object;

    const effectiveRuleAuditResults =
      (state.mergedRuleAuditResults?.length ?? 0) > 0
        ? state.mergedRuleAuditResults
        : (state.deterministicRuleResults ?? []);

    const resultJson: Record<string, unknown> = {
      basic_info: {
        rubric_version: "v1",
        task_type: state.taskType,
        evaluation_mode: "auto_precheck_with_human_review",
        rules_enabled: true,
        build_check_enabled: false,
        target_description: "HarmonyOS 生成工程评分",
        target_scope: state.caseInput.generatedProjectPath,
        task_type_basis: state.constraintSummary.classificationHints.join("; "),
      },
      rubric_summary: state.rubricSnapshot,
      overall_conclusion: state.scoreComputation.overallConclusion,
      dimension_results: buildDimensionResults(state),
      rule_violations: state.ruleViolations,
      risks: state.scoreComputation.risks,
      strengths: state.scoreComputation.strengths,
      main_issues: state.scoreComputation.mainIssues,
      human_review_items: state.scoreComputation.humanReviewItems,
      final_recommendation: state.scoreComputation.finalRecommendation,
      rule_audit_results: effectiveRuleAuditResults,
      report_meta: {
        report_file_name: "report.html",
        result_json_file_name: "result.json",
        unit_name: state.caseInput.caseId,
        generated_at: new Date().toISOString(),
      },
    };

    if (typeof schema !== "object" || schema === null) {
      throw new Error("report_result_schema.json 内容不合法。");
    }

    validateReportResult(resultJson, schemaPath);
    return { resultJson };
  } catch (error) {
    emitNodeFailed("reportGenerationNode", error);
    throw error;
  }
}
