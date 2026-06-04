import { runRuleEngine } from "../../../rules/core/ruleEngine.js";
import { resolveEnabledRulePackIds } from "../../../rules/registry/rulePackRegistry.js";
import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../../graph/state.js";

export async function ruleAuditNode(
  state: ScoreGraphState,
  config: { referenceRoot: string },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("ruleAuditNode");
  try {
    const enabledRulePackIds = resolveEnabledRulePackIds({
      crossDeviceAdaptation: state.constraintSummary?.crossDeviceAdaptation,
    });
    const result = await runRuleEngine({
      referenceRoot: config.referenceRoot,
      caseInput: state.caseInput,
      taskType: state.taskType,
      runtimeRules: state.caseRuleDefinitions,
      enabledRulePackIds,
    });

    return {
      staticRuleAuditResults: result.staticRuleAuditResults,
      deterministicRuleResults: result.deterministicRuleResults,
      enabledRulePacks: result.enabledRulePacks,
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
