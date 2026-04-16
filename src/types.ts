export type TaskType = "full_generation" | "continuation" | "bug_fix";

// CaseInput 描述单条评分用例的 before/after/prompt/patch 四元组。
export interface CaseInput {
  caseId: string;
  promptText: string;
  originalProjectPath: string;
  generatedProjectPath: string;
  patchPath?: string;
}

export interface ConstraintSummary {
  explicitConstraints: string[];
  contextualConstraints: string[];
  implicitConstraints: string[];
  classificationHints: string[];
}

export interface FeatureExtraction {
  basicFeatures: string[];
  structuralFeatures: string[];
  semanticFeatures: string[];
  changeFeatures: string[];
}

export interface RuleAuditResult {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "满足" | "不满足" | "不涉及";
  conclusion: string;
}

export interface RuleViolation {
  rule_source: string;
  rule_id: string;
  rule_summary: string;
  affected_items: string[];
  handling_result: string;
  evidence: string;
}

export type ConfidenceLevel = "high" | "medium" | "low";

// 以下结构基本直接映射到 `result.json` schema，保持命名一致以减少转换成本。
export interface DimensionScore {
  dimension_name: string;
  score: number;
  max_score: number;
  comment: string;
}

export interface SubmetricDetail {
  dimension_name: string;
  metric_name: string;
  score: number;
  confidence: ConfidenceLevel;
  review_required: boolean;
  rationale: string;
  evidence: string;
}

export interface RiskItem {
  level: string;
  title: string;
  description: string;
  evidence: string;
}

export interface HumanReviewItem {
  item: string;
  current_assessment: string;
  uncertainty_reason: string;
  suggested_focus: string;
}

export interface EvidenceSummary {
  workspaceFileCount: number;
  originalFileCount: number;
  changedFileCount: number;
  changedFiles: string[];
  hasPatch: boolean;
}

export interface ScoreComputation {
  totalScore: number;
  hardGateTriggered: boolean;
  hardGateReason?: string;
  overallConclusion: {
    total_score: number;
    hard_gate_triggered: boolean;
    summary: string;
  };
  dimensionScores: DimensionScore[];
  submetricDetails: SubmetricDetail[];
  risks: RiskItem[];
  humanReviewItems: HumanReviewItem[];
  strengths: string[];
  mainIssues: string[];
  finalRecommendation: string[];
}
