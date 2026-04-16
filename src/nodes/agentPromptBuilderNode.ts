import { buildAgentPromptPayload, renderAgentPrompt, selectAssistedRuleCandidates } from "../agent/ruleAssistance.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function agentPromptBuilderNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("agentPromptBuilderNode");
  try {
    const selection = selectAssistedRuleCandidates(state.ruleAuditResults, {
      evidenceByRuleId: state.ruleEvidenceIndex,
      fallbackEvidence: state.ruleEvidenceIndex?.__fallback__,
    });
    const payload = buildAgentPromptPayload({
      caseInput: state.caseInput,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
      deterministicRuleResults: selection.deterministicRuleResults,
      assistedRuleCandidates: selection.assistedRuleCandidates,
    });
    const prompt = renderAgentPrompt(payload);
    await deps.logger?.info(
      `agent prompt 组装完成 candidates=${selection.assistedRuleCandidates.length} deterministic=${selection.deterministicRuleResults.length}`,
    );

    return {
      deterministicRuleResults: selection.deterministicRuleResults,
      assistedRuleCandidates: selection.assistedRuleCandidates,
      agentPromptPayload: payload,
      agentPromptText: prompt,
    };
  } catch (error) {
    emitNodeFailed("agentPromptBuilderNode", error);
    throw error;
  }
}
