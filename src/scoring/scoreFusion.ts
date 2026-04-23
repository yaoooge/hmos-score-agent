import type { LoadedRubric } from "./rubricLoader.js";
import type {
  AgentRunStatus,
  CaseRuleDefinition,
  DimensionScore,
  EvidenceSummary,
  LoadedRubricSnapshot,
  RiskItem,
  RuleAuditResult,
  RuleImpactDetail,
  RuleViolation,
  RubricScoringItemScore,
  RubricScoringResult,
  ScoreComputation,
  ScoreFusionDetail,
  SubmetricDetail,
  TaskType,
} from "../types.js";

type FuseRubricScoreWithRulesInput = {
  taskType: TaskType;
  rubric: LoadedRubric;
  rubricSnapshot: LoadedRubricSnapshot;
  rubricScoringResult?: RubricScoringResult;
  rubricAgentRunStatus: AgentRunStatus;
  ruleAuditResults: RuleAuditResult[];
  ruleViolations: RuleViolation[];
  evidenceSummary: EvidenceSummary;
  caseRuleDefinitions?: CaseRuleDefinition[];
};

type MetricPenaltyRule = {
  metricNames: string[];
  ratio: number;
  severity: RuleImpactDetail["severity"];
};

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function makeMetricKey(dimensionName: string, metricName: string): string {
  return `${dimensionName}::${metricName}`;
}

const typeSafetyMetrics = [
  "ArkTS/ArkUI语法与类型安全",
  "ArkTS约束遵循度",
  "ArkTS/ArkUI规范符合度",
];
const staticQualityMetrics = ["静态坏味道控制"];
const namingMetrics = ["命名表达清晰度", "命名与风格一致性"];
const complexityMetrics = ["复杂度控制"];
const stateFlowMetrics = ["状态与数据流组织", "状态接入合理性"];
const stabilityRiskMetrics = ["稳定性风险", "回归风险控制"];
const securityBoundaryMetrics = ["安全与边界意识", "安全/边界意识"];
const performanceRiskMetrics = ["性能风险"];

function makePenaltyRule(input: {
  metricNames: string[];
  ratio: number;
  severity?: RuleImpactDetail["severity"];
}): MetricPenaltyRule[] {
  return [
    {
      metricNames: input.metricNames,
      ratio: input.ratio,
      severity: input.severity ?? "medium",
    },
  ];
}

function findPenaltyRules(rule: RuleAuditResult): MetricPenaltyRule[] {
  const typeRuleIds = new Set([
    "ARKTS-MUST-001",
    "ARKTS-MUST-002",
    "ARKTS-MUST-003",
    "ARKTS-MUST-004",
    "ARKTS-MUST-006",
    "ARKTS-MUST-007",
    "ARKTS-MUST-008",
    "ARKTS-MUST-010",
    "ARKTS-MUST-011",
    "ARKTS-MUST-012",
    "ARKTS-MUST-013",
    "ARKTS-MUST-014",
    "ARKTS-MUST-016",
    "ARKTS-MUST-018",
    "ARKTS-MUST-019",
    "ARKTS-MUST-021",
    "ARKTS-MUST-023",
    "ARKTS-MUST-024",
    "ARKTS-MUST-026",
    "ARKTS-MUST-029",
    "ARKTS-SHOULD-002",
    "ARKTS-SHOULD-003",
    "ARKTS-SHOULD-019",
    "ARKTS-SHOULD-021",
    "ARKTS-FORBID-001",
    "ARKTS-FORBID-003",
    "ARKTS-FORBID-004",
    "ARKTS-FORBID-007",
  ]);
  const namingRuleIds = new Set([
    "ARKTS-SHOULD-004",
    "ARKTS-SHOULD-005",
    "ARKTS-SHOULD-006",
    "ARKTS-SHOULD-007",
    "ARKTS-SHOULD-008",
  ]);
  const styleRuleIds = new Set([
    "ARKTS-MUST-005",
    "ARKTS-MUST-028",
    "ARKTS-SHOULD-009",
    "ARKTS-SHOULD-010",
    "ARKTS-SHOULD-012",
    "ARKTS-SHOULD-013",
    "ARKTS-SHOULD-014",
    "ARKTS-SHOULD-015",
    "ARKTS-SHOULD-016",
    "ARKTS-SHOULD-017",
    "ARKTS-SHOULD-018",
    "ARKTS-SHOULD-020",
  ]);
  const controlFlowRuleIds = new Set([
    "ARKTS-MUST-020",
    "ARKTS-MUST-022",
    "ARKTS-MUST-030",
    "ARKTS-SHOULD-011",
    "ARKTS-FORBID-005",
    "ARKTS-FORBID-006",
    "ARKTS-FORBID-011",
    "ARKTS-FORBID-012",
  ]);
  const runtimeRiskRuleIds = new Set([
    "ARKTS-MUST-015",
    "ARKTS-MUST-017",
    "ARKTS-MUST-025",
    "ARKTS-MUST-027",
    "ARKTS-FORBID-002",
    "ARKTS-FORBID-008",
    "ARKTS-FORBID-009",
    "ARKTS-FORBID-010",
    "ARKTS-PERF-FORBID-001",
  ]);

  if (typeRuleIds.has(rule.rule_id)) {
    return makePenaltyRule({
      metricNames:
        rule.rule_source === "forbidden_pattern"
          ? [...typeSafetyMetrics, ...stabilityRiskMetrics, ...securityBoundaryMetrics]
          : typeSafetyMetrics,
      ratio: rule.rule_source === "must_rule" ? 0.35 : 0.15,
      severity: rule.rule_source === "must_rule" ? "medium" : "light",
    });
  }
  if (namingRuleIds.has(rule.rule_id)) {
    return makePenaltyRule({ metricNames: namingMetrics, ratio: 0.15, severity: "light" });
  }
  if (styleRuleIds.has(rule.rule_id)) {
    return makePenaltyRule({
      metricNames: staticQualityMetrics,
      ratio: rule.rule_source === "must_rule" ? 0.25 : 0.15,
      severity: rule.rule_source === "must_rule" ? "medium" : "light",
    });
  }
  if (controlFlowRuleIds.has(rule.rule_id)) {
    return makePenaltyRule({
      metricNames: [...complexityMetrics, ...staticQualityMetrics, ...stabilityRiskMetrics],
      ratio: rule.rule_source === "forbidden_pattern" ? 0.5 : 0.25,
      severity: rule.rule_source === "forbidden_pattern" ? "heavy" : "medium",
    });
  }
  if (rule.rule_id === "ARKTS-PERF-FORBID-001") {
    return makePenaltyRule({
      metricNames: [...performanceRiskMetrics, ...typeSafetyMetrics],
      ratio: 0.5,
      severity: "heavy",
    });
  }
  if (runtimeRiskRuleIds.has(rule.rule_id)) {
    return makePenaltyRule({
      metricNames: [...stabilityRiskMetrics, ...securityBoundaryMetrics, ...typeSafetyMetrics],
      ratio: rule.rule_source === "forbidden_pattern" ? 0.5 : 0.35,
      severity: rule.rule_source === "forbidden_pattern" ? "heavy" : "medium",
    });
  }
  if (rule.rule_id === "ARKTS-SHOULD-001") {
    return makePenaltyRule({
      metricNames: [...stateFlowMetrics, ...stabilityRiskMetrics],
      ratio: 0.15,
      severity: "light",
    });
  }

  if (rule.rule_source === "must_rule") {
    return makePenaltyRule({ metricNames: typeSafetyMetrics, ratio: 0.35, severity: "medium" });
  }
  if (rule.rule_source === "forbidden_pattern") {
    return makePenaltyRule({
      metricNames: [...stabilityRiskMetrics, ...securityBoundaryMetrics],
      ratio: 0.5,
      severity: "heavy",
    });
  }
  return [];
}

function buildCriteriaByMetric(rubricSnapshot: LoadedRubricSnapshot): Map<string, string> {
  return new Map(
    rubricSnapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => [
        makeMetricKey(dimension.name, item.name),
        item.scoring_bands.map((band) => `${band.score}分：${band.criteria}`).join(" / "),
      ]),
    ),
  );
}

function buildFallbackRubricItems(rubric: LoadedRubric): RubricScoringItemScore[] {
  return rubric.dimensions.flatMap((dimension) =>
    dimension.items.map((item) => {
      const bestBand = item.scoringBands[0];
      return {
        dimension_name: dimension.name,
        item_name: item.name,
        score: bestBand?.score ?? item.weight,
        max_score: item.weight,
        matched_band_score: bestBand?.score ?? item.weight,
        rationale: "rubric agent 未产出可信扣分依据，暂按满分保留，待人工复核。",
        evidence_used: [],
        confidence: "low",
        review_required: true,
        deduction_trace: undefined,
      };
    }),
  );
}

function selectBaseItems(input: FuseRubricScoreWithRulesInput): RubricScoringItemScore[] {
  if (input.rubricAgentRunStatus === "success" && input.rubricScoringResult) {
    return input.rubricScoringResult.item_scores;
  }
  return buildFallbackRubricItems(input.rubric);
}

function selectTriggeredGateIds(input: FuseRubricScoreWithRulesInput): Array<"G1" | "G2" | "G3" | "G4"> {
  const violatedRules = input.ruleAuditResults.filter((rule) => rule.result === "不满足");
  const mustViolations = violatedRules.filter((rule) => rule.rule_source === "must_rule");
  const forbiddenViolations = violatedRules.filter(
    (rule) => rule.rule_source === "forbidden_pattern",
  );
  const caseMustRuleIds = new Set(
    (input.caseRuleDefinitions ?? [])
      .filter((rule) => rule.priority === "P0")
      .map((rule) => rule.rule_id),
  );
  const triggered = new Set<"G1" | "G2" | "G3" | "G4">();

  if (violatedRules.some((rule) => caseMustRuleIds.has(rule.rule_id))) {
    triggered.add("G1");
  }
  if (mustViolations.length >= 2) {
    triggered.add("G1");
  }
  if (
    mustViolations.some((rule) =>
      ["ARKTS-MUST-003", "ARKTS-MUST-005", "ARKTS-MUST-006"].includes(rule.rule_id),
    )
  ) {
    triggered.add("G2");
  }
  if (forbiddenViolations.length > 0) {
    triggered.add("G3");
  }
  if (
    input.taskType === "bug_fix" &&
    (input.evidenceSummary.changedFileCount > 8 || input.evidenceSummary.changedFiles.length > 8)
  ) {
    triggered.add("G4");
  }

  return Array.from(triggered);
}

export function fuseRubricScoreWithRules(input: FuseRubricScoreWithRulesInput): ScoreComputation {
  const criteriaByMetric = buildCriteriaByMetric(input.rubricSnapshot);
  const baseItems = selectBaseItems(input);
  const detailsByKey = new Map<string, ScoreFusionDetail>();

  for (const item of baseItems) {
    const key = makeMetricKey(item.dimension_name, item.item_name);
    detailsByKey.set(key, {
      dimension_name: item.dimension_name,
      item_name: item.item_name,
      agent_evaluation: {
        base_score: item.score,
        matched_band_score: item.matched_band_score,
        matched_criteria: criteriaByMetric.get(key) ?? "",
        logic: item.rationale,
        evidence_used: item.evidence_used,
        confidence: item.confidence,
        deduction_trace: item.deduction_trace ?? null,
      },
      rule_impacts: [],
      score_fusion: {
        base_score: item.score,
        rule_delta: 0,
        final_score: item.score,
        fusion_logic: "未命中影响该评分项的规则，最终分等于 rubric agent 基础分。",
      },
    });
  }

  const risks: RiskItem[] = [...(input.rubricScoringResult?.risks ?? [])];

  for (const rule of input.ruleAuditResults) {
    if (rule.result !== "不满足" && rule.result !== "待人工复核") {
      continue;
    }

    const penaltyRules = findPenaltyRules(rule);
    for (const detail of detailsByKey.values()) {
      const penalty = penaltyRules.find((candidate) =>
        candidate.metricNames.includes(detail.item_name),
      );
      if (!penalty) {
        continue;
      }

      const delta =
        rule.result === "待人工复核"
          ? 0
          : -roundScore(detail.agent_evaluation.base_score * penalty.ratio);
      detail.rule_impacts.push({
        rule_id: rule.rule_id,
        rule_source: rule.rule_source,
        result: rule.result,
        severity: rule.result === "待人工复核" ? "review_only" : penalty.severity,
        score_delta: delta,
        reason: rule.conclusion,
        evidence: rule.conclusion,
        agent_assisted: rule.rule_source === "should_rule",
        needs_human_review: rule.result === "待人工复核",
      });
    }

    if (rule.result === "不满足") {
      risks.push({
        level: rule.rule_source === "forbidden_pattern" ? "high" : "medium",
        title: `规则违规：${rule.rule_id}`,
        description: rule.conclusion,
        evidence: rule.conclusion,
      });
    }
  }

  const scoreFusionDetails = Array.from(detailsByKey.values()).map((detail) => {
    const ruleDelta = roundScore(
      detail.rule_impacts.reduce((sum, impact) => sum + impact.score_delta, 0),
    );
    const finalScore = roundScore(Math.max(0, detail.agent_evaluation.base_score + ruleDelta));
    return {
      ...detail,
      score_fusion: {
        base_score: detail.agent_evaluation.base_score,
        rule_delta: ruleDelta,
        final_score: finalScore,
        fusion_logic:
          ruleDelta === 0
            ? "未命中影响该评分项的规则，最终分等于 rubric agent 基础分。"
            : `rubric agent 基础分 ${detail.agent_evaluation.base_score}，规则修正 ${ruleDelta}，最终 ${finalScore}。`,
      },
    };
  });

  const dimensionScores: DimensionScore[] = input.rubric.dimensions.map((dimension) => {
    const metrics = scoreFusionDetails.filter((detail) => detail.dimension_name === dimension.name);
    const score = roundScore(
      metrics.reduce((sum, detail) => sum + detail.score_fusion.final_score, 0),
    );
    return {
      dimension_name: dimension.name,
      score,
      max_score: dimension.weight,
      comment: metrics.some((metric) => metric.rule_impacts.length > 0)
        ? "包含规则修正项。"
        : "未发现规则修正项。",
    };
  });

  const submetricDetails: SubmetricDetail[] = scoreFusionDetails.map((detail) => ({
    dimension_name: detail.dimension_name,
    metric_name: detail.item_name,
    score: detail.score_fusion.final_score,
    confidence: detail.agent_evaluation.confidence,
    review_required:
      detail.agent_evaluation.confidence === "low" ||
      detail.rule_impacts.some((impact) => impact.needs_human_review),
    rationale: detail.score_fusion.fusion_logic,
    evidence: [
      ...detail.agent_evaluation.evidence_used,
      ...detail.rule_impacts.map((impact) => impact.evidence),
    ].join(" "),
  }));

  const rawTotalScore = roundScore(
    dimensionScores.reduce((sum, dimension) => sum + dimension.score, 0),
  );
  const triggeredGateIds = selectTriggeredGateIds(input);
  const scoreCap = triggeredGateIds
    .map((gateId) => input.rubric.hardGates.find((gate) => gate.id === gateId)?.scoreCap)
    .filter((value): value is number => typeof value === "number")
    .reduce<number | undefined>(
      (minCap, current) => (minCap === undefined ? current : Math.min(minCap, current)),
      undefined,
    );
  const totalScore = scoreCap === undefined ? rawTotalScore : Math.min(rawTotalScore, scoreCap);
  const humanReviewItems =
    input.rubricAgentRunStatus === "success"
        ? []
        : [
          {
            item: "Rubric Agent 降级",
            current_assessment: "rubric agent 未产出可信扣分依据，当前按满分保留。",
            uncertainty_reason: `rubricAgentRunStatus=${input.rubricAgentRunStatus}`,
            suggested_focus: "人工复核 rubric 逐项评分是否合理。",
          },
        ];
  if (triggeredGateIds.length > 0) {
    humanReviewItems.push({
      item: "硬门槛复核",
      current_assessment: triggeredGateIds.join(", "),
      uncertainty_reason: "规则分支触发了 rubric hard gate 候选条件。",
      suggested_focus: "确认规则违规是否真实构成硬门槛风险。",
    });
  }

  return {
    totalScore,
    hardGateTriggered: triggeredGateIds.length > 0,
    hardGateReason: triggeredGateIds.join(", "),
    overallConclusion: {
      total_score: totalScore,
      hard_gate_triggered: triggeredGateIds.length > 0,
      summary:
        triggeredGateIds.length > 0
          ? `已完成 rubric 基础评分与规则修正融合，并触发硬门槛：${triggeredGateIds.join(", ")}。`
          : "已完成 rubric 基础评分与规则修正融合。",
    },
    dimensionScores,
    submetricDetails,
    scoreFusionDetails,
    risks,
    humanReviewItems,
    strengths: input.rubricScoringResult?.strengths ?? [],
    mainIssues: input.rubricScoringResult?.main_issues ?? [],
    finalRecommendation: ["当前分数可作为 rubric-first 自动预检结果使用。"],
  };
}
