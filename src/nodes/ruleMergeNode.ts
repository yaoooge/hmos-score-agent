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
      await deps.logger?.info("rule agent 判定合并完成 source=deterministic-only");
      return {
        mergedRuleAuditResults: state.deterministicRuleResults ?? [],
        ruleAgentAssessmentResult: undefined,
      };
    }

    const ruleAgentRunStatus = state.ruleAgentRunStatus;
    if (ruleAgentRunStatus === "skipped" || ruleAgentRunStatus === "not_enabled") {
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
      await deps.logger?.info(`rule agent 判定合并完成 status=${ruleAgentRunStatus}`);
      return {
        mergedRuleAuditResults,
        ruleAgentAssessmentResult: undefined,
      };
    }

    const finalAnswer = state.ruleAgentRunnerResult?.final_answer;
    const merged = mergeRuleAuditResults({
      deterministicRuleResults: state.deterministicRuleResults ?? [],
      assistedRuleCandidates: state.assistedRuleCandidates ?? [],
      agentFinalAnswer: finalAnswer,
    });
    const effectiveAgentRunStatus = finalAnswer
      ? "success"
      : ruleAgentRunStatus === "failed"
        ? ruleAgentRunStatus
        : merged.ruleAgentRunStatus;
    await deps.logger?.info(`rule agent 判定合并完成 status=${effectiveAgentRunStatus}`);

    return {
      ruleAgentRunStatus: effectiveAgentRunStatus,
      ruleAgentAssessmentResult: merged.ruleAgentAssessmentResult ?? undefined,
      mergedRuleAuditResults: merged.mergedRuleAuditResults,
    };
  } catch (error) {
    emitNodeFailed("ruleMergeNode", error);
    throw error;
  }
}
