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

export interface ProjectStructureSummary {
  rootPath: string;
  topLevelEntries: string[];
  modulePaths: string[];
  representativeFiles: string[];
  implementationHints: string[];
  omittedFileCount: number;
}

export interface PatchSummary {
  hasPatch: boolean;
  changedFiles: string[];
  affectedRoots: string[];
  addedLines: number;
  deletedLines: number;
  changeTypes: string[];
  intrusionLevel: "none" | "low" | "medium" | "high";
  rawPatchLength: number;
}

export interface TaskUnderstandingAgentInput {
  caseId: string;
  promptText: string;
  originalProjectPath: string;
  generatedProjectPath: string;
  projectStructure: ProjectStructureSummary;
  patchSummary: PatchSummary;
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
  result: "满足" | "不满足" | "不涉及" | "待人工复核";
  conclusion: string;
}

export interface StaticRuleAuditResult {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "满足" | "不满足" | "不涉及" | "未接入判定器";
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

// AssistedRuleCandidate 描述需要 Agent 辅助判定的弱规则候选及其证据。
export interface AssistedRuleCandidate {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  why_uncertain: string;
  local_preliminary_signal: string;
  evidence_files: string[];
  evidence_snippets: string[];
}

export type AgentRunStatus = "not_enabled" | "success" | "failed" | "invalid_output" | "skipped";

// LoadedRubricSnapshot 是从 rubric 裁剪出的轻量快照，专供 prompt 构建与落盘。
export interface LoadedRubricSnapshot {
  task_type: TaskType;
  evaluation_mode: string;
  scenario: string;
  scoring_method: string;
  scoring_note: string;
  common_risks: string[];
  report_emphasis: string[];
  dimension_summaries: Array<{
    name: string;
    weight: number;
    intent: string;
    item_summaries: Array<{
      name: string;
      weight: number;
      scoring_bands: Array<{
        score: number;
        criteria: string;
      }>;
    }>;
  }>;
  hard_gates: Array<{
    id: string;
    score_cap: number;
  }>;
  review_rule_summary: string[];
}

export interface AgentPromptPayload {
  case_context: {
    case_id: string;
    task_type: TaskType;
    original_prompt_summary: string;
    has_patch: boolean;
    project_paths: {
      original_project_path: string;
      generated_project_path: string;
    };
  };
  task_understanding: ConstraintSummary;
  rubric_summary: LoadedRubricSnapshot;
  deterministic_rule_results: RuleAuditResult[];
  assisted_rule_candidates: AssistedRuleCandidate[];
  response_contract: {
    output_language: "zh-CN";
    json_only: true;
    fallback_rule: "不确定时必须返回 needs_human_review=true";
    required_top_level_fields: ["summary", "rule_assessments"];
    summary_schema: {
      assistant_scope: "string";
      overall_confidence: ["high", "medium", "low"];
    };
    rule_assessment_schema: {
      required_fields: ["rule_id", "decision", "confidence", "reason", "evidence_used", "needs_human_review"];
      decision_enum: ["violation", "pass", "not_applicable", "uncertain"];
      confidence_enum: ["high", "medium", "low"];
    };
  };
}

export interface AgentRuleAssessment {
  rule_id: string;
  decision: "violation" | "pass" | "not_applicable" | "uncertain";
  confidence: ConfidenceLevel;
  reason: string;
  evidence_used: string[];
  needs_human_review: boolean;
}

export interface AgentAssistedRuleResult {
  summary: {
    assistant_scope: string;
    overall_confidence: ConfidenceLevel;
  };
  rule_assessments: AgentRuleAssessment[];
}

export type RuleEvidenceIndex = Record<
  string,
  {
    evidenceFiles: string[];
    evidenceSnippets: string[];
  }
>;

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
