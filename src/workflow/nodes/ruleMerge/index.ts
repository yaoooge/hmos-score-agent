import { mergeRuleAuditResults } from "../../../agents/normalization/ruleAssistance.js";
import type { NormalizedRuleImpact, RuleAuditResult } from "../../../types.js";
import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../../graph/state.js";

function normalizeOfficialSeverity(
  severity: RuleAuditResult["official_linter_severity"],
): NormalizedRuleImpact["severity"] {
  if (severity === "error") {
    return "major";
  }
  if (severity === "suggestion") {
    return "info";
  }
  return "minor";
}

function normalizeRuleImpact(rule: RuleAuditResult): NormalizedRuleImpact {
  const isOfficial = rule.rule_id.startsWith("OFFICIAL-LINTER:");
  const severity: NormalizedRuleImpact["severity"] = isOfficial
    ? normalizeOfficialSeverity(rule.official_linter_severity)
    : rule.rule_source === "should_rule"
      ? "minor"
      : "major";
  const ruleSource = isOfficial ? "official_linter" : rule.rule_source;

  if (rule.result !== "不满足") {
    return {
      rule_id: rule.rule_id,
      rule_source: ruleSource,
      result: rule.result,
      severity: rule.result === "待人工复核" ? "review" : "info",
      score_effect: {
        mode: rule.result === "待人工复核" ? "review_only" : "none",
        reason: rule.conclusion,
      },
    };
  }

  if (rule.rule_source === "should_rule" || severity === "minor") {
    return {
      rule_id: rule.rule_id,
      rule_source: ruleSource,
      result: rule.result,
      severity,
      score_effect: {
        mode: "deduct",
        points: 2,
        reason: rule.conclusion,
      },
    };
  }

  return {
    rule_id: rule.rule_id,
    rule_source: ruleSource,
    result: rule.result,
    severity,
    score_effect: {
      mode: "cap",
      score_cap: 85,
      reason: rule.conclusion,
    },
  };
}

function normalizeRuleImpacts(rules: RuleAuditResult[]): NormalizedRuleImpact[] {
  return rules.map((rule) => normalizeRuleImpact(rule));
}

export async function ruleMergeNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("ruleMergeNode");
  try {
    const deterministicRuleResults = [
      ...(state.deterministicRuleResults ?? []),
      ...(state.officialLinterRuleResults ?? []),
    ];
    if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
      await deps.logger?.info("rule agent 判定合并完成 source=deterministic-only");
      return {
        mergedRuleAuditResults: deterministicRuleResults,
        normalizedRuleImpacts: normalizeRuleImpacts(deterministicRuleResults),
        ruleAgentAssessmentResult: undefined,
      };
    }

    const ruleAgentRunStatus = state.ruleAgentRunStatus;
    if (ruleAgentRunStatus === "skipped" || ruleAgentRunStatus === "not_enabled") {
      const mergedRuleAuditResults = [
        ...deterministicRuleResults,
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
        normalizedRuleImpacts: normalizeRuleImpacts(mergedRuleAuditResults),
        ruleAgentAssessmentResult: undefined,
      };
    }

    const finalAnswer = state.ruleAgentRunnerResult?.final_answer;
    const merged = mergeRuleAuditResults({
      deterministicRuleResults,
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
      normalizedRuleImpacts: normalizeRuleImpacts(merged.mergedRuleAuditResults),
    };
  } catch (error) {
    emitNodeFailed("ruleMergeNode", error);
    throw error;
  }
}
