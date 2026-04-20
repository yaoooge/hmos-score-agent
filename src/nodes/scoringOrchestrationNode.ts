import { ScoreGraphState } from "../workflow/state.js";
import { getConfig } from "../config.js";
import { loadRubricForTaskType } from "../scoring/rubricLoader.js";
import { computeScoreBreakdown } from "../scoring/scoringEngine.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";

export async function scoringOrchestrationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("scoringOrchestrationNode");
  try {
    const config = getConfig();
    const effectiveRuleAuditResults =
      (state.mergedRuleAuditResults?.length ?? 0) > 0
        ? state.mergedRuleAuditResults
        : (state.deterministicRuleResults ?? []);
    const rubric = await loadRubricForTaskType(state.taskType, config.referenceRoot);
    const scoreBreakdown = computeScoreBreakdown({
      taskType: state.taskType,
      rubric,
      ruleAuditResults: effectiveRuleAuditResults,
      ruleViolations: state.ruleViolations,
      constraintSummary: state.constraintSummary,
      featureExtraction: state.featureExtraction,
      evidenceSummary: state.evidenceSummary,
      caseRuleDefinitions: state.caseRuleDefinitions,
    });

    return {
      scoreComputation: scoreBreakdown,
    };
  } catch (error) {
    emitNodeFailed("scoringOrchestrationNode", error);
    throw error;
  }
}
