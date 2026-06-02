import path from "node:path";
import { buildAgentBootstrapPayload } from "../../../agents/normalization/ruleAssistance.js";
import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../../graph/state.js";

export async function ruleAgentPromptBuilderNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("ruleAgentPromptBuilderNode");
  try {
    const deterministicRuleResults = state.deterministicRuleResults ?? [];
    const assistedRuleCandidates = state.assistedRuleCandidates ?? [];
    const caseRoot = state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath);
    const payload = buildAgentBootstrapPayload({
      caseInput: state.caseInput,
      caseRoot,
      effectivePatchPath: state.effectivePatchPath,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
      assistedRuleCandidates,
    });
    await deps.logger?.info(
      `rule agent payload 组装完成 candidates=${assistedRuleCandidates.length} deterministic=${deterministicRuleResults.length}`,
    );

    return {
      deterministicRuleResults,
      assistedRuleCandidates,
      ruleAgentBootstrapPayload: payload,
    };
  } catch (error) {
    emitNodeFailed("ruleAgentPromptBuilderNode", error);
    throw error;
  }
}
