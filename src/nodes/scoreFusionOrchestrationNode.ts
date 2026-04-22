import { buildRubricSnapshot } from "../agent/ruleAssistance.js";
import { getConfig } from "../config.js";
import { fuseRubricScoreWithRules } from "../scoring/scoreFusion.js";
import { loadRubricForTaskType } from "../scoring/rubricLoader.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function scoreFusionOrchestrationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("scoreFusionOrchestrationNode");
  try {
    const config = getConfig();
    const effectiveRuleAuditResults =
      (state.mergedRuleAuditResults?.length ?? 0) > 0
        ? state.mergedRuleAuditResults
        : (state.deterministicRuleResults ?? []);
    const rubric = await loadRubricForTaskType(state.taskType, config.referenceRoot);
    const scoreComputation = fuseRubricScoreWithRules({
      taskType: state.taskType,
      rubric,
      rubricSnapshot: state.rubricSnapshot ?? buildRubricSnapshot(rubric),
      rubricScoringResult: state.rubricScoringResult,
      rubricAgentRunStatus: state.rubricAgentRunStatus ?? "skipped",
      ruleAuditResults: effectiveRuleAuditResults,
      ruleViolations: state.ruleViolations ?? [],
      evidenceSummary: state.evidenceSummary ?? {
        workspaceFileCount: 0,
        originalFileCount: 0,
        changedFileCount: 0,
        changedFiles: [],
        hasPatch: false,
      },
      caseRuleDefinitions: state.caseRuleDefinitions ?? [],
    });

    return { scoreComputation };
  } catch (error) {
    emitNodeFailed("scoreFusionOrchestrationNode", error);
    throw error;
  }
}
