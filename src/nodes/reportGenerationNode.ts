import fs from "node:fs/promises";
import path from "node:path";
import { validateReportResult } from "../report/schemaValidator.js";
import { getRegisteredRulePacks, listRegisteredRules } from "../rules/engine/rulePackRegistry.js";
import type { ConfidenceLevel, RuleAuditResult, ScoreFusionDetail } from "../types.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeMetricKey(dimensionName: string, metricName: string): string {
  return `${dimensionName}::${metricName}`;
}

function combineConfidence(details: ScoreFusionDetail[]): ConfidenceLevel {
  if (
    details.length === 0 ||
    details.some((detail) => detail.agent_evaluation.confidence === "low")
  ) {
    return "low";
  }
  if (details.some((detail) => detail.agent_evaluation.confidence === "medium")) {
    return "medium";
  }
  return "high";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function buildAgentEvaluationSummary(details: ScoreFusionDetail[]): Record<string, unknown> {
  const baseScore = roundScore(
    details.reduce((sum, detail) => sum + detail.agent_evaluation.base_score, 0),
  );
  const logic = uniqueStrings(details.map((detail) => detail.agent_evaluation.logic));
  const keyEvidence = uniqueStrings(
    details.flatMap((detail) => detail.agent_evaluation.evidence_used),
  );

  return {
    base_score: baseScore,
    logic:
      logic.length > 0 ? logic.join(" ") : "缺少 rubric agent 评价明细，需人工复核该维度评分依据。",
    key_evidence: keyEvidence,
    confidence: combineConfidence(details),
  };
}

function buildRuleViolationSummary(details: ScoreFusionDetail[]): Record<string, unknown> {
  const violatedRuleIds = new Set(
    details.flatMap((detail) =>
      detail.rule_impacts
        .filter((impact) => impact.result === "不满足")
        .map((impact) => impact.rule_id),
    ),
  );
  const affectedItemCount = details.filter((detail) => detail.rule_impacts.length > 0).length;
  const totalRuleDelta = roundScore(
    details.reduce((sum, detail) => sum + detail.score_fusion.rule_delta, 0),
  );

  return {
    violated_rule_count: violatedRuleIds.size,
    affected_item_count: affectedItemCount,
    total_rule_delta: totalRuleDelta,
    summary:
      violatedRuleIds.size === 0
        ? "该维度未发现规则违规对评分项产生扣分影响。"
        : `该维度共有 ${violatedRuleIds.size} 条违规规则影响 ${affectedItemCount} 个评分项，累计规则修正 ${totalRuleDelta} 分。`,
  };
}

function buildDimensionResults(state: ScoreGraphState): Array<Record<string, unknown>> {
  const rubricSummary = state.rubricSnapshot;
  const dimensionScores = state.scoreComputation.dimensionScores;
  const submetricDetails = state.scoreComputation.submetricDetails;
  const scoreFusionDetails = state.scoreComputation.scoreFusionDetails;
  const scoreFusionDetailMap = new Map(
    scoreFusionDetails.map((detail) => [
      makeMetricKey(detail.dimension_name, detail.item_name),
      detail,
    ]),
  );

  return (rubricSummary?.dimension_summaries ?? []).map((dimensionSummary) => {
    const dimensionScore = dimensionScores.find(
      (item) => item.dimension_name === dimensionSummary.name,
    );
    const dimensionFusionDetails = scoreFusionDetails.filter(
      (detail) => detail.dimension_name === dimensionSummary.name,
    );

    return {
      dimension_name: dimensionSummary.name,
      dimension_intent: dimensionSummary.intent,
      score: dimensionScore?.score ?? 0,
      max_score: dimensionScore?.max_score ?? dimensionSummary.weight,
      comment: dimensionScore?.comment ?? "",
      agent_evaluation_summary: buildAgentEvaluationSummary(dimensionFusionDetails),
      rule_violation_summary: buildRuleViolationSummary(dimensionFusionDetails),
      item_results: dimensionSummary.item_summaries.map((itemSummary) => {
        const detail = submetricDetails.find(
          (item) =>
            item.dimension_name === dimensionSummary.name && item.metric_name === itemSummary.name,
        );
        const fusionDetail = scoreFusionDetailMap.get(
          makeMetricKey(dimensionSummary.name, itemSummary.name),
        );
        const itemScore = fusionDetail?.score_fusion.final_score ?? detail?.score ?? 0;
        const matchedBand =
          itemSummary.scoring_bands.find((band) => band.score === itemScore) ??
          itemSummary.scoring_bands.find(
            (band) => band.score === fusionDetail?.agent_evaluation.matched_band_score,
          ) ??
          null;

        return {
          item_name: itemSummary.name,
          item_weight: itemSummary.weight,
          score: itemScore,
          matched_band: matchedBand,
          confidence: fusionDetail?.agent_evaluation.confidence ?? detail?.confidence ?? "low",
          review_required:
            detail?.review_required ??
            fusionDetail?.rule_impacts.some((impact) => impact.needs_human_review) ??
            true,
          agent_evaluation: fusionDetail?.agent_evaluation ?? {
            base_score: 0,
            matched_band_score: 0,
            matched_criteria: "",
            logic: "缺少 rubric agent 对该评分项的评价逻辑。",
            evidence_used: [],
            deduction_trace: null,
            confidence: "low",
          },
          rule_impacts: fusionDetail?.rule_impacts ?? [],
          score_fusion: fusionDetail?.score_fusion ?? {
            base_score: 0,
            rule_delta: 0,
            final_score: detail?.score ?? 0,
            fusion_logic: "缺少评分融合明细，需人工复核该评分项。",
          },
        };
      }),
    };
  });
}

function buildBoundRulePacks(state: ScoreGraphState): Array<Record<string, string>> {
  const builtInPacks = getRegisteredRulePacks().map((pack) => ({
    pack_id: pack.packId,
    display_name: pack.displayName,
  }));
  const seenPackIds = new Set(builtInPacks.map((pack) => pack.pack_id));
  const casePacks = Array.from(
    new Set((state.caseRuleDefinitions ?? []).map((definition) => definition.pack_id)),
  )
    .filter((packId) => !seenPackIds.has(packId))
    .map((packId) => ({
      pack_id: packId,
      display_name: formatCaseRulePackDisplayName(packId, state.caseInput.caseId),
    }));

  return [...builtInPacks, ...casePacks];
}

function formatCaseRulePackDisplayName(packId: string, caseId: string): string {
  if (packId.startsWith("case-") && packId.length > "case-".length) {
    return `用例 ${packId.slice("case-".length)} 约束规则`;
  }
  return `用例 ${caseId} 约束规则`;
}

function enrichRuleAuditResultsWithSummary(
  state: ScoreGraphState,
  ruleAuditResults: RuleAuditResult[],
): RuleAuditResult[] {
  const ruleSummaryById = new Map(
    listRegisteredRules(state.caseRuleDefinitions ?? []).map((rule) => [
      rule.rule_id,
      rule.summary,
    ]),
  );

  return ruleAuditResults.map((rule) => ({
    ...rule,
    rule_summary: rule.rule_summary ?? ruleSummaryById.get(rule.rule_id) ?? "",
  }));
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
    const effectiveRuleAuditResultsWithSummary = enrichRuleAuditResultsWithSummary(
      state,
      effectiveRuleAuditResults,
    );
    const caseRuleResults = (state.caseRuleDefinitions ?? []).map((definition) => {
      const matchedRule = effectiveRuleAuditResults.find(
        (rule) => rule.rule_id === definition.rule_id,
      );
      return {
        rule_id: definition.rule_id,
        rule_name: definition.rule_name,
        priority: definition.priority,
        rule_source: definition.rule_source,
        result: matchedRule?.result ?? "待人工复核",
        conclusion: matchedRule?.conclusion ?? "缺少最终规则判定结果。",
        hard_gate_triggered: definition.priority === "P0" && matchedRule?.result === "不满足",
      };
    });

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
      overall_conclusion: state.scoreComputation.overallConclusion,
      dimension_results: buildDimensionResults(state),
      rule_violations: state.ruleViolations,
      bound_rule_packs: buildBoundRulePacks(state),
      risks: state.scoreComputation.risks,
      strengths: state.scoreComputation.strengths,
      main_issues: state.scoreComputation.mainIssues,
      human_review_items: state.scoreComputation.humanReviewItems,
      final_recommendation: state.scoreComputation.finalRecommendation,
      rule_audit_results: effectiveRuleAuditResultsWithSummary,
      case_rule_results: caseRuleResults,
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
