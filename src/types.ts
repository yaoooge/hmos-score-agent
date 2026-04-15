export type TaskType = "full_generation" | "continuation" | "bug_fix";

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

export interface ScoreComputation {
  totalScore: number;
  hardGateTriggered: boolean;
  hardGateReason?: string;
}
