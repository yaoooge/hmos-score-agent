import { Annotation } from "@langchain/langgraph";
import {
  CaseInput,
  ConstraintSummary,
  FeatureExtraction,
  RuleAuditResult,
  RuleViolation,
  ScoreComputation,
  TaskType,
} from "../types.js";

export const ScoreState = Annotation.Root({
  caseInput: Annotation<CaseInput>(),
  caseDir: Annotation<string>(),
  constraintSummary: Annotation<ConstraintSummary>(),
  taskType: Annotation<TaskType>(),
  featureExtraction: Annotation<FeatureExtraction>(),
  ruleAuditResults: Annotation<RuleAuditResult[]>(),
  ruleViolations: Annotation<RuleViolation[]>(),
  scoreComputation: Annotation<ScoreComputation>(),
  resultJson: Annotation<Record<string, unknown>>(),
  htmlReport: Annotation<string>(),
  uploadMessage: Annotation<string>(),
});

export type ScoreGraphState = typeof ScoreState.State;
