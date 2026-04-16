import { ScoreGraphState } from "../workflow/state.js";
import { getConfig } from "../config.js";
import { loadRubricForTaskType } from "../scoring/rubricLoader.js";
import { computeScoreBreakdown } from "../scoring/scoringEngine.js";

export async function scoringOrchestrationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  const config = getConfig();
  const rubric = await loadRubricForTaskType(state.taskType, config.referenceRoot);
  const scoreBreakdown = computeScoreBreakdown({
    taskType: state.taskType,
    rubric,
    ruleAuditResults: state.ruleAuditResults,
    ruleViolations: state.ruleViolations,
    constraintSummary: state.constraintSummary,
    featureExtraction: state.featureExtraction,
    evidenceSummary: state.evidenceSummary,
  });

  return {
    scoreComputation: scoreBreakdown,
  };
}
