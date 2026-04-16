import { mergeRuleAuditResults } from "../agent/ruleAssistance.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function ruleMergeNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
    await deps.logger?.info("agent 辅助判定合并完成 source=deterministic-only");
    return {
      mergedRuleAuditResults: state.ruleAuditResults,
      agentAssistedRuleResults: undefined,
    };
  }

  if (state.agentRunStatus === "failed" || state.agentRunStatus === "skipped" || !state.agentRawOutputText) {
    const mergedRuleAuditResults = [
      ...(state.deterministicRuleResults ?? []),
      ...(state.assistedRuleCandidates ?? []).map((candidate) => ({
        rule_id: candidate.rule_id,
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

  const merged = mergeRuleAuditResults({
    deterministicRuleResults: state.deterministicRuleResults ?? [],
    assistedRuleCandidates: state.assistedRuleCandidates ?? [],
    agentOutputText: state.agentRawOutputText,
  });
  await deps.logger?.info(`agent 辅助判定合并完成 status=${merged.agentRunStatus}`);

  return {
    agentRunStatus: merged.agentRunStatus,
    agentAssistedRuleResults: merged.agentAssistedRuleResults ?? undefined,
    mergedRuleAuditResults: merged.mergedRuleAuditResults,
  };
}
