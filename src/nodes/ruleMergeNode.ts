import { mergeRuleAuditResults } from "../agent/ruleAssistance.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function ruleMergeNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("ruleMergeNode");
  try {
    if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
      await deps.logger?.info("agent 辅助判定合并完成 source=deterministic-only");
      return {
        mergedRuleAuditResults: state.deterministicRuleResults ?? [],
        agentAssistedRuleResults: undefined,
      };
    }

    if (state.agentRunStatus === "skipped" || state.agentRunStatus === "not_enabled") {
      const mergedRuleAuditResults = [
        ...(state.deterministicRuleResults ?? []),
        ...(state.assistedRuleCandidates ?? []).map((candidate) => ({
          rule_id: candidate.rule_id,
          rule_summary: candidate.rule_summary ?? candidate.rule_name,
          rule_source: candidate.rule_source,
          result: "待人工复核" as const,
          conclusion: `Agent 不可用，候选规则 ${candidate.rule_id} 已回退为待人工复核。`,
        })),
      ];
      await deps.logger?.info(`agent 辅助判定合并完成 status=${state.agentRunStatus}`);
      return {
        mergedRuleAuditResults,
        agentAssistedRuleResults: undefined,
      };
    }

    const finalAnswer = state.agentRunnerResult?.final_answer;
    const merged = mergeRuleAuditResults({
      deterministicRuleResults: state.deterministicRuleResults ?? [],
      assistedRuleCandidates: state.assistedRuleCandidates ?? [],
      agentFinalAnswer: finalAnswer,
    });
    const effectiveAgentRunStatus = finalAnswer
      ? "success"
      : state.agentRunStatus === "failed"
        ? state.agentRunStatus
        : merged.agentRunStatus;
    await deps.logger?.info(`agent 辅助判定合并完成 status=${effectiveAgentRunStatus}`);

    return {
      agentRunStatus: effectiveAgentRunStatus,
      agentAssistedRuleResults: merged.agentAssistedRuleResults ?? undefined,
      mergedRuleAuditResults: merged.mergedRuleAuditResults,
    };
  } catch (error) {
    emitNodeFailed("ruleMergeNode", error);
    throw error;
  }
}
