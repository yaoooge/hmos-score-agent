import { buildAgentPromptPayload, renderAgentPrompt } from "../agent/ruleAssistance.js";
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
    const deterministicRuleResults = state.deterministicRuleResults ?? [];
    const assistedRuleCandidates = state.assistedRuleCandidates ?? [];
    const payload = buildAgentPromptPayload({
      caseInput: state.caseInput,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
      deterministicRuleResults,
      assistedRuleCandidates,
    });
    const prompt = renderAgentPrompt(payload);
    await deps.logger?.info(
      `agent prompt 组装完成 candidates=${assistedRuleCandidates.length} deterministic=${deterministicRuleResults.length}`,
    );

    return {
      deterministicRuleResults,
      assistedRuleCandidates,
      agentPromptPayload: payload,
      agentPromptText: prompt,
    };
  } catch (error) {
    emitNodeFailed("agentPromptBuilderNode", error);
    throw error;
  }
}
