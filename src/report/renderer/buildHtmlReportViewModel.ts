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
      matchedBandText: string;
      confidence: string;
      reviewRequired: boolean;
      rationale: string;
      evidence: string;
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
          return {
            name: String(currentItem.item_name ?? ""),
            weight: Number(currentItem.item_weight ?? 0),
            score: Number(currentItem.score ?? 0),
            matchedBandText: formatMatchedBand(currentItem.matched_band),
            confidence: String(currentItem.confidence ?? "low"),
            reviewRequired: Boolean(currentItem.review_required),
            rationale: String(
              currentItem.rationale ?? agentEvaluation.logic ?? "暂无理由。",
            ),
            evidence: formatEvidence(currentItem.evidence ?? agentEvaluation.evidence_used),
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
