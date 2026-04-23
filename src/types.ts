export type TaskType = "full_generation" | "continuation" | "bug_fix";

export interface RemoteTaskFileManifest {
  files: Array<{
    path: string;
    content: string;
  }>;
}

export interface RemoteTestCase {
  id: number;
  name: string;
  type: string;
  description: string;
  input: string;
  expectedOutput: string;
  fileUrl: string;
}

export interface RemoteExecutionResult {
  isBuildSuccess: boolean;
  outputCodeUrl: string;
  diffFileUrl?: string;
}

export interface RemoteEvaluationTask {
  taskId: number;
  testCase: RemoteTestCase;
  executionResult: RemoteExecutionResult;
  token: string;
  callback: string;
}

export interface RemoteCallbackPayload {
  taskId: number;
  status: "completed" | "failed";
  totalScore: number;
  maxScore: number;
  resultData: Record<string, unknown>;
}

// CaseInput 描述单条评分用例的 before/after/prompt/patch 四元组。
export interface CaseInput {
  caseId: string;
  promptText: string;
  originalProjectPath: string;
  generatedProjectPath: string;
  originalProjectProvided?: boolean;
  patchPath?: string;
  expectedConstraintsPath?: string;
}

export type CaseConstraintPriority = "P0" | "P1";

export interface CaseRuleDefinition {
  pack_id: string;
  rule_id: string;
  rule_name: string;
  rule_source: "must_rule" | "should_rule";
  summary: string;
  priority: CaseConstraintPriority;
  detector_kind: "case_constraint";
  detector_config: {
    targetPatterns: string[];
    astSignals: Array<Record<string, string>>;
    llmPrompt: string;
  };
  fallback_policy: "agent_assisted";
  is_case_rule: true;
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
  originalProjectProvided?: boolean;
  projectStructure: ProjectStructureSummary;
  patchSummary: PatchSummary;
}

export interface RuleAuditResult {
  rule_id: string;
  rule_summary?: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "满足" | "不满足" | "不涉及" | "待人工复核";
  conclusion: string;
}

export interface StaticRuleAuditResult {
  rule_id: string;
  rule_summary?: string;
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

export interface CaseRuleStaticPrecheck {
  target_matched: boolean;
  target_files: string[];
  signal_status: "all_matched" | "partial_matched" | "none_matched" | "no_target_files";
  matched_tokens: string[];
  summary: string;
}

// AssistedRuleCandidate 描述需要 Agent 辅助判定的弱规则候选及其证据。
export interface AssistedRuleCandidate {
  rule_id: string;
  rule_summary?: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  why_uncertain: string;
  local_preliminary_signal: string;
  evidence_files: string[];
  evidence_snippets: string[];
  rule_name?: string;
  priority?: CaseConstraintPriority;
  llm_prompt?: string;
  ast_signals?: Array<Record<string, string>>;
  static_precheck?: CaseRuleStaticPrecheck;
  is_case_rule?: boolean;
}

export type CaseToolName =
  | "read_patch"
  | "list_dir"
  | "read_file"
  | "read_file_chunk"
  | "grep_in_files"
  | "read_json";

export interface CaseRuleResult {
  rule_id: string;
  rule_name: string;
  priority: CaseConstraintPriority;
  rule_source: "must_rule" | "should_rule";
  result: "满足" | "不满足" | "不涉及" | "待人工复核";
  conclusion: string;
  hard_gate_triggered: boolean;
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

export interface AgentBootstrapPayload {
  case_context: {
    case_id: string;
    case_root: string;
    task_type: TaskType;
    original_prompt_summary: string;
    original_project_path: string;
    generated_project_path: string;
    effective_patch_path?: string;
  };
  task_understanding: ConstraintSummary;
  rubric_summary: LoadedRubricSnapshot;
  assisted_rule_candidates: AssistedRuleCandidate[];
  initial_target_files: string[];
  tool_contract: {
    allowed_tools: CaseToolName[];
    max_tool_calls: number;
    max_total_bytes: number;
    max_files: number;
  };
  response_contract: {
    action_enum: ["tool_call", "final_answer"];
    output_language: "zh-CN";
    json_only: true;
  };
}

export interface RubricScoringPayload {
  case_context: {
    case_id: string;
    case_root: string;
    task_type: TaskType;
    original_prompt_summary: string;
    original_project_path: string;
    generated_project_path: string;
    effective_patch_path?: string;
  };
  task_understanding: ConstraintSummary;
  rubric_summary: LoadedRubricSnapshot;
  response_contract: {
    output_language: "zh-CN";
    json_only: true;
    required_top_level_fields: [
      "summary",
      "item_scores",
      "hard_gate_candidates",
      "risks",
      "strengths",
      "main_issues",
    ];
  };
}

export interface RubricScoringItemScore {
  dimension_name: string;
  item_name: string;
  score: number;
  max_score: number;
  matched_band_score: number;
  rationale: string;
  evidence_used: string[];
  confidence: ConfidenceLevel;
  review_required: boolean;
}

export interface RubricScoringResult {
  summary: {
    overall_assessment: string;
    overall_confidence: ConfidenceLevel;
  };
  item_scores: RubricScoringItemScore[];
  hard_gate_candidates: Array<{
    gate_id: "G1" | "G2" | "G3" | "G4";
    triggered: boolean;
    reason: string;
    confidence: ConfidenceLevel;
  }>;
  risks: RiskItem[];
  strengths: string[];
  main_issues: string[];
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

export interface CaseAwareAgentToolCallAction {
  action: "tool_call";
  tool: CaseToolName;
  args: Record<string, unknown>;
  reason?: string;
}

export interface CaseAwareAgentFinalAnswer extends AgentAssistedRuleResult {
  action: "final_answer";
}

export type CaseAwareAgentPlannerOutput = CaseAwareAgentToolCallAction | CaseAwareAgentFinalAnswer;

export interface CaseToolBudgetSnapshot {
  usedToolCalls: number;
  usedBytes: number;
  readFileCount: number;
  remainingToolCalls: number;
  remainingBytes: number;
  remainingFileSlots: number;
}

export interface CaseToolTraceItem {
  turn: number;
  tool: CaseToolName;
  args: Record<string, unknown>;
  ok: boolean;
  error_code?: string;
  error_message?: string;
  paths_read: string[];
  bytes_returned: number;
  truncated: boolean;
  budget_after_call: CaseToolBudgetSnapshot;
}

export interface CaseAwareAgentTurn {
  turn: number;
  action: "tool_call" | "final_answer";
  status: "success" | "error";
  raw_output_text: string;
  tool?: CaseToolName;
  args?: Record<string, unknown>;
  reason?: string;
}

export type CaseAwareRunnerOutcome =
  | "success"
  | "request_failed"
  | "protocol_error"
  | "tool_budget_exhausted";

export interface CaseAwareRunnerResult {
  outcome: CaseAwareRunnerOutcome;
  final_answer?: CaseAwareAgentFinalAnswer;
  final_answer_raw_text?: string;
  failure_reason?: string;
  turns: CaseAwareAgentTurn[];
  tool_trace: CaseToolTraceItem[];
}

export interface CaseAwareFinalAnswerValidation {
  ok: boolean;
  missing_rule_ids: string[];
  duplicate_rule_ids: string[];
  unexpected_rule_ids: string[];
}

export type RuleImpactSeverity = "review_only" | "light" | "medium" | "heavy" | "gating";

export interface RuleImpactDetail {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "不满足" | "待人工复核";
  severity: RuleImpactSeverity;
  score_delta: number;
  reason: string;
  evidence: string;
  agent_assisted: boolean;
  needs_human_review: boolean;
}

export interface ScoreFusionDetail {
  dimension_name: string;
  item_name: string;
  agent_evaluation: {
    base_score: number;
    matched_band_score: number;
    matched_criteria: string;
    logic: string;
    evidence_used: string[];
    confidence: ConfidenceLevel;
  };
  rule_impacts: RuleImpactDetail[];
  score_fusion: {
    base_score: number;
    rule_delta: number;
    final_score: number;
    fusion_logic: string;
  };
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
  scoreFusionDetails: ScoreFusionDetail[];
  risks: RiskItem[];
  humanReviewItems: HumanReviewItem[];
  strengths: string[];
  mainIssues: string[];
  finalRecommendation: string[];
}
