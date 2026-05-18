type AnyRecord = Record<string, unknown>;

export type CaseReportSummary = {
  totalScore?: number;
  hardGateTriggered?: boolean;
  conclusion?: string;
  taskType?: string;
  targetDescription?: string;
  generatedAt?: string;
};

export type CaseReportDimension = {
  name: string;
  score?: number;
  maxScore?: number;
  comment?: string;
  itemCount: number;
};

export type CaseReportRisk = {
  id?: number;
  level?: string;
  title: string;
  description?: string;
  evidence?: string;
};

export type CaseReportHumanReviewItem = {
  id?: string | number;
  title: string;
  currentAssessment?: string;
  reason?: string;
  suggestedFocus?: string;
};

export type CaseReportLinterSummary = {
  runStatus?: string;
  effectiveFindingCount?: number;
};

export type CaseReportRuleAuditItem = {
  ruleId: string;
  result?: string;
  conclusion?: string;
};

export type CaseReportViewModel = {
  summary: CaseReportSummary;
  dimensions: CaseReportDimension[];
  risks: CaseReportRisk[];
  humanReviewItems: CaseReportHumanReviewItem[];
  linterSummary?: CaseReportLinterSummary;
  ruleAuditItems: CaseReportRuleAuditItem[];
  strengths: string[];
  mainIssues: string[];
  recommendations: string[];
};

export function buildCaseReportViewModel(resultData: unknown): CaseReportViewModel {
  const result = asRecord(resultData);
  const basicInfo = asRecord(result.basic_info);
  const overall = asRecord(result.overall_conclusion);
  const reportMeta = asRecord(result.report_meta);
  const linterSummary = asRecord(result.official_linter_summary);

  return {
    summary: omitUndefined({
      totalScore: readNumber(overall.total_score),
      hardGateTriggered: readBoolean(overall.hard_gate_triggered),
      conclusion: readString(overall.summary),
      taskType: readString(basicInfo.task_type),
      targetDescription: readString(basicInfo.target_description),
      generatedAt: readString(reportMeta.generated_at),
    }),
    dimensions: readArray(result.dimension_results).map((item) => {
      const dimension = asRecord(item);
      return {
        name: readString(dimension.dimension_name) ?? "未命名维度",
        score: readNumber(dimension.score),
        maxScore: readNumber(dimension.max_score),
        comment: readString(dimension.comment),
        itemCount: readArray(dimension.item_results).length,
      };
    }),
    risks: readArray(result.risks).map((item, index) => {
      const risk = asRecord(item);
      return {
        id: readNumber(risk.id),
        level: readString(risk.level),
        title: readString(risk.title) ?? `风险 ${String(index + 1)}`,
        description: readString(risk.description),
        evidence: readString(risk.evidence),
      };
    }),
    humanReviewItems: readArray(result.human_review_items).map((item, index) => {
      const review = asRecord(item);
      return {
        id: readString(review.id) ?? readNumber(review.id),
        title:
          readString(review.title) ??
          readString(review.item) ??
          readString(review.suggested_focus) ??
          `复核项 ${String(index + 1)}`,
        currentAssessment: readString(review.current_assessment),
        reason: readString(review.reason) ?? readString(review.uncertainty_reason),
        suggestedFocus: readString(review.suggested_focus),
      };
    }),
    linterSummary:
      Object.keys(linterSummary).length > 0
        ? {
            runStatus: readString(linterSummary.runStatus),
            effectiveFindingCount: readNumber(linterSummary.effectiveFindingCount),
          }
        : undefined,
    ruleAuditItems: readArray(result.rule_audit_results).map((item) => {
      const rule = asRecord(item);
      return {
        ruleId: readString(rule.rule_id) ?? "-",
        result: readString(rule.result),
        conclusion: readString(rule.conclusion) ?? readString(rule.rule_summary),
      };
    }),
    strengths: readStringArray(result.strengths),
    mainIssues: readStringArray(result.main_issues),
    recommendations: readStringArray(result.final_recommendation),
  };
}

function asRecord(value: unknown): AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return readArray(value).flatMap((item) => {
    const text = readString(item);
    return text === undefined ? [] : [text];
  });
}

function omitUndefined<T extends AnyRecord>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as T;
}
