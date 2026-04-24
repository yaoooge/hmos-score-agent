type RuleAuditResultLabel = "不满足" | "待人工复核" | "满足" | "不涉及";

export interface HtmlReportViewModel {
  summary: {
    title: string;
    totalScore: string;
    hardGateLabel: string;
    summaryText: string;
    recommendationText: string;
    caseId: string;
    taskType: string;
    generatedAt: string;
    reviewCount: number;
    riskCount: number;
    violationCount: number;
    recommendations: string[];
  };
  dimensions: Array<{
    name: string;
    intent: string;
    scoreText: string;
    progressPercent: number;
    comment: string;
    summaryLogic: string;
    summaryEvidence: string;
    items: Array<{
      name: string;
      weight: number;
      score: number;
      rubricScore: number;
      ruleScoreText: string;
      finalScore: number;
      matchedBandText: string;
      confidence: string;
      reviewRequired: boolean;
      scoreCalculation: string;
      rubricOpinion: string;
      rubricEvidence: string;
      ruleOpinion: string;
      ruleEvidence: string;
      deductionTrace: null | {
        codeLocations: string;
        impactScope: string;
        rubricComparison: string;
        deductionReason: string;
        improvementSuggestion: string;
      };
    }>;
  }>;
  humanReview: {
    items: Array<{
      item: string;
      currentAssessment: string;
      uncertaintyReason: string;
      suggestedFocus: string;
    }>;
    emptyState: string;
  };
  ruleAudit: {
    counts: Record<RuleAuditResultLabel, number>;
    items: Array<{
      ruleId: string;
      ruleSummary: string;
      ruleSource: string;
      result: string;
      conclusion: string;
    }>;
    emptyState: string;
  };
  boundRulePacks: {
    items: Array<{
      packId: string;
      displayName: string;
    }>;
    emptyState: string;
  };
  caseRules: {
    items: Array<{
      ruleId: string;
      ruleName: string;
      priority: string;
      result: string;
      conclusion: string;
      hardGateTriggered: boolean;
    }>;
    emptyState: string;
  };
  risks: { items: string[]; emptyState: string };
  issues: { items: string[]; emptyState: string };
  strengths: string[];
  recommendations: string[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function formatTimestamp(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return "未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMatchedBand(matchedBand: unknown): string {
  const current = asRecord(matchedBand);
  if (Object.keys(current).length === 0) {
    return "未命中评分档位";
  }
  return `${String(current.score ?? "")} 分：${String(current.criteria ?? "")}`;
}

function formatRiskItem(item: unknown): string {
  if (typeof item === "string") {
    return item;
  }
  const current = asRecord(item);
  const title = String(current.title ?? "").trim();
  const description = String(current.description ?? "").trim();
  if (title && description) {
    return `${title}：${description}`;
  }
  return title || description || "未命名风险项";
}

function formatEvidence(value: unknown): string {
  if (typeof value === "string") {
    return value.trim() || "暂无证据。";
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item).trim()).filter(Boolean);
    return items.length > 0 ? items.join("\n") : "暂无证据。";
  }
  return "暂无证据。";
}

function formatConfidence(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high") {
    return "高";
  }
  if (normalized === "medium") {
    return "中";
  }
  if (normalized === "low") {
    return "低";
  }
  return normalized || "低";
}

function normalizeCalculationText(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "暂无计算过程说明。";
  }
  return text
    .replaceAll("rubric agent 基础分", "细则评分基础分")
    .replaceAll("rubric 基础分", "细则评分基础分")
    .replaceAll("规则修正", "规则校验修正")
    .replaceAll("按 rubric 档位收敛为", "按评分档位收敛为")
    .replaceAll("最终分等于", "最终得分等于");
}

function formatRuleDelta(value: unknown): string {
  const delta = Number(value ?? 0);
  if (!Number.isFinite(delta) || delta === 0) {
    return "0 分";
  }
  return `${delta > 0 ? "+" : ""}${delta} 分`;
}

function formatRuleOpinion(ruleImpacts: unknown[]): string {
  if (ruleImpacts.length === 0) {
    return "未发现足够的负面规则证据，保持细则评分结果。";
  }
  return ruleImpacts
    .map((item) => {
      const current = asRecord(item);
      const ruleId = String(current.rule_id ?? "").trim();
      const result = String(current.result ?? "").trim();
      const reason = String(current.reason ?? "").trim() || "暂无规则意见。";
      const scoreDelta = Number(current.score_delta ?? 0);
      const deltaText =
        scoreDelta === 0 ? "不调整分数" : `调整 ${scoreDelta > 0 ? "+" : ""}${scoreDelta} 分`;
      return [ruleId, result, deltaText, reason].filter(Boolean).join(" | ");
    })
    .join("\n");
}

function formatRuleEvidence(ruleImpacts: unknown[]): string {
  if (ruleImpacts.length === 0) {
    return "未发现影响该评分项的规则证据。";
  }
  const evidences = ruleImpacts
    .map((item) => String(asRecord(item).evidence ?? "").trim())
    .filter(Boolean);
  return evidences.length > 0 ? evidences.join("\n") : "暂无规则证据。";
}

export function buildHtmlReportViewModel(resultJson: Record<string, unknown>): HtmlReportViewModel {
  const basicInfo = asRecord(resultJson.basic_info);
  const overallConclusion = asRecord(resultJson.overall_conclusion);
  const reportMeta = asRecord(resultJson.report_meta);
  const dimensionResults = Array.isArray(resultJson.dimension_results)
    ? resultJson.dimension_results
    : [];
  const humanReviewItems = Array.isArray(resultJson.human_review_items)
    ? resultJson.human_review_items
    : [];
  const ruleAuditResults = Array.isArray(resultJson.rule_audit_results)
    ? resultJson.rule_audit_results
    : [];
  const boundRulePacks = Array.isArray(resultJson.bound_rule_packs)
    ? resultJson.bound_rule_packs
    : [];
  const caseRuleResults = Array.isArray(resultJson.case_rule_results)
    ? resultJson.case_rule_results
    : [];
  const risks = Array.isArray(resultJson.risks) ? resultJson.risks : [];
  const mainIssues = asStringArray(resultJson.main_issues);
  const strengths = asStringArray(resultJson.strengths);
  const recommendations = asStringArray(resultJson.final_recommendation);

  const counts: Record<RuleAuditResultLabel, number> = {
    不满足: 0,
    待人工复核: 0,
    满足: 0,
    不涉及: 0,
  };

  for (const item of ruleAuditResults) {
    const result = String(asRecord(item).result ?? "") as RuleAuditResultLabel;
    if (result in counts) {
      counts[result] += 1;
    }
  }

  const mergedHumanReviewItems = [
    ...humanReviewItems.map((item) => {
      const current = asRecord(item);
      return {
        item: String(current.item ?? ""),
        currentAssessment: String(current.current_assessment ?? ""),
        uncertaintyReason: String(current.uncertainty_reason ?? ""),
        suggestedFocus: String(current.suggested_focus ?? ""),
      };
    }),
    ...ruleAuditResults
      .map((item) => asRecord(item))
      .filter((item) => item.result === "待人工复核")
      .map((item) => ({
        item: `规则复核：${String(item.rule_id ?? "")}`,
        currentAssessment: String(item.conclusion ?? ""),
        uncertaintyReason: "当前规则缺少足够证据支持稳定自动判定。",
        suggestedFocus: "结合相关代码上下文确认该规则是否真实涉及当前实现。",
      })),
  ];

  return {
    summary: {
      title: "评分报告",
      totalScore: String(overallConclusion.total_score ?? "-"),
      hardGateLabel: overallConclusion.hard_gate_triggered ? "已触发硬门禁" : "未触发硬门禁",
      summaryText: String(overallConclusion.summary ?? "暂无总体结论。"),
      recommendationText:
        recommendations.length > 0 ? `建议动作：${recommendations.join("；")}` : "",
      caseId: String(reportMeta.unit_name ?? "unknown-case"),
      taskType: String(basicInfo.task_type ?? "unknown"),
      generatedAt: formatTimestamp(reportMeta.generated_at),
      reviewCount: mergedHumanReviewItems.length,
      riskCount: risks.length,
      violationCount: counts.不满足,
      recommendations,
    },
    dimensions: dimensionResults.map((dimension) => {
      const current = asRecord(dimension);
      const score = Number(current.score ?? 0);
      const maxScore = Number(current.max_score ?? 0);
      const itemResults = Array.isArray(current.item_results) ? current.item_results : [];
      return {
        name: String(current.dimension_name ?? ""),
        intent: String(current.dimension_intent ?? ""),
        scoreText: `${score} / ${maxScore}`,
        progressPercent: maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 100)) : 0,
        comment: String(current.comment ?? "暂无评语。"),
        summaryLogic: String(
          asRecord(current.agent_evaluation_summary).logic ?? "暂无理由。",
        ),
        summaryEvidence: formatEvidence(asRecord(current.agent_evaluation_summary).key_evidence),
        items: itemResults.map((item) => {
          const currentItem = asRecord(item);
          const agentEvaluation = asRecord(currentItem.agent_evaluation);
          const scoreFusion = asRecord(currentItem.score_fusion);
          const ruleImpacts = Array.isArray(currentItem.rule_impacts) ? currentItem.rule_impacts : [];
          const deductionTrace = asRecord(agentEvaluation.deduction_trace);
          return {
            name: String(currentItem.item_name ?? ""),
            weight: Number(currentItem.item_weight ?? 0),
            score: Number(currentItem.score ?? 0),
            rubricScore: Number(agentEvaluation.base_score ?? currentItem.score ?? 0),
            ruleScoreText: formatRuleDelta(scoreFusion.rule_delta),
            finalScore: Number(scoreFusion.final_score ?? currentItem.score ?? 0),
            matchedBandText: formatMatchedBand(currentItem.matched_band),
            confidence: formatConfidence(currentItem.confidence ?? "low"),
            reviewRequired: Boolean(currentItem.review_required),
            scoreCalculation: normalizeCalculationText(scoreFusion.fusion_logic),
            rubricOpinion: String(agentEvaluation.logic ?? currentItem.rationale ?? "暂无评分意见。"),
            rubricEvidence: formatEvidence(agentEvaluation.evidence_used ?? currentItem.evidence),
            ruleOpinion: formatRuleOpinion(ruleImpacts),
            ruleEvidence: formatRuleEvidence(ruleImpacts),
            deductionTrace:
              Object.keys(deductionTrace).length === 0
                ? null
                : {
                    codeLocations: formatEvidence(deductionTrace.code_locations),
                    impactScope: String(deductionTrace.impact_scope ?? ""),
                    rubricComparison: String(deductionTrace.rubric_comparison ?? ""),
                    deductionReason: String(deductionTrace.deduction_reason ?? ""),
                    improvementSuggestion: String(deductionTrace.improvement_suggestion ?? ""),
                  },
          };
        }),
      };
    }),
    humanReview: {
      items: mergedHumanReviewItems,
      emptyState: "当前没有待人工复核项。",
    },
    ruleAudit: {
      counts,
      items: ruleAuditResults.map((item) => {
        const current = asRecord(item);
        return {
          ruleId: String(current.rule_id ?? ""),
          ruleSummary: String(current.rule_summary ?? ""),
          ruleSource: String(current.rule_source ?? ""),
          result: String(current.result ?? ""),
          conclusion: String(current.conclusion ?? ""),
        };
      }),
      emptyState: "当前没有可展示的规则审计结果。",
    },
    boundRulePacks: {
      items: boundRulePacks.map((item) => {
        const current = asRecord(item);
        return {
          packId: String(current.pack_id ?? ""),
          displayName: String(current.display_name ?? ""),
        };
      }),
      emptyState: "当前没有可展示的绑定规则集。",
    },
    caseRules: {
      items: caseRuleResults.map((item) => {
        const current = asRecord(item);
        return {
          ruleId: String(current.rule_id ?? ""),
          ruleName: String(current.rule_name ?? ""),
          priority: String(current.priority ?? ""),
          result: String(current.result ?? ""),
          conclusion: String(current.conclusion ?? ""),
          hardGateTriggered: Boolean(current.hard_gate_triggered),
        };
      }),
      emptyState: "当前没有可展示的用例规则结果。",
    },
    risks: {
      items: risks.map(formatRiskItem),
      emptyState: "当前没有明显风险项。",
    },
    issues: {
      items: mainIssues,
      emptyState: "当前没有主要问题项。",
    },
    strengths,
    recommendations,
  };
}
