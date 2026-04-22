import path from "node:path";
import { buildAgentBootstrapPayload, renderAgentBootstrapPrompt } from "../agent/ruleAssistance.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

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
    const initialTargetFiles = Array.from(
      new Set(assistedRuleCandidates.flatMap((candidate) => candidate.evidence_files)),
    ).slice(0, 20);
    const caseRoot = state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath);
    const payload = buildAgentBootstrapPayload({
      caseInput: state.caseInput,
      caseRoot,
      effectivePatchPath: state.effectivePatchPath,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
      assistedRuleCandidates,
      initialTargetFiles,
    });
    const prompt = renderAgentBootstrapPrompt(payload);
    await deps.logger?.info(
      `rule agent prompt 组装完成 candidates=${assistedRuleCandidates.length} deterministic=${deterministicRuleResults.length} targetFiles=${initialTargetFiles.length}`,
    );

    return {
      deterministicRuleResults,
      assistedRuleCandidates,
      ruleAgentBootstrapPayload: payload,
      ruleAgentPromptText: prompt,
    };
  } catch (error) {
    emitNodeFailed("ruleAgentPromptBuilderNode", error);
    throw error;
  }
}
