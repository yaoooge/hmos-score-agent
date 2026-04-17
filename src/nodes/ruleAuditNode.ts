import { runRuleEngine } from "../rules/ruleEngine.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function ruleAuditNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("ruleAuditNode");
  try {
    const result = await runRuleEngine({
      referenceRoot: config.referenceRoot,
      caseInput: state.caseInput,
      taskType: state.taskType,
    });

    return {
      staticRuleAuditResults: result.staticRuleAuditResults,
      deterministicRuleResults: result.deterministicRuleResults,
      assistedRuleCandidates: result.assistedRuleCandidates,
      ruleEvidenceIndex: result.ruleEvidenceIndex,
      ruleViolations: result.ruleViolations,
      evidenceSummary: result.evidenceSummary,
    };
  } catch (error) {
    emitNodeFailed("ruleAuditNode", error);
    throw error;
  }
}
