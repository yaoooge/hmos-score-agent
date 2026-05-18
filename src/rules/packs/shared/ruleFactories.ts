import type { RegisteredRule, RuleSource } from "../../engine/ruleTypes.js";

const defaultFileExtensions = [".ets"];

// createPendingRule 用于声明已纳入规则包、但当前版本仍需 agent 辅助的规则。
export function createPendingRule(
  pack_id: string,
  rule_source: RuleSource,
  rule_id: string,
  summary: string,
): RegisteredRule {
  return {
    pack_id,
    rule_id,
    rule_source,
    summary,
    detector_kind: "not_implemented",
    detector_config: {},
    fallback_policy: "agent_assisted",
  };
}

// createTextRule 为文本可判规则提供统一 detector 配置，避免三类规则文件重复拼装。
export function createTextRule(
  pack_id: string,
  rule_source: RuleSource,
  rule_id: string,
  summary: string,
  patterns: string[],
  applicabilityPatterns?: string[],
  options: {
    ignoreStringLiteralMatches?: boolean;
    stripStringLiteralContents?: boolean;
    finallyBlockControlFlowOnly?: boolean;
  } = {},
): RegisteredRule {
  return {
    pack_id,
    rule_id,
    rule_source,
    summary,
    detector_kind: "text_pattern",
    detector_config: {
      fileExtensions: defaultFileExtensions,
      patterns,
      ...(applicabilityPatterns?.length ? { applicabilityPatterns } : {}),
      ...(options.ignoreStringLiteralMatches ? { ignoreStringLiteralMatches: true } : {}),
      ...(options.stripStringLiteralContents ? { stripStringLiteralContents: true } : {}),
      ...(options.finallyBlockControlFlowOnly ? { finallyBlockControlFlowOnly: true } : {}),
    },
    fallback_policy: "agent_assisted",
  };
}

export function createAgentAssistedTargetRule(input: {
  packId: string;
  ruleSource: Extract<RuleSource, "must_rule" | "should_rule">;
  ruleId: string;
  ruleName: string;
  summary: string;
  priority: "P0" | "P1";
  kit?: string[];
  targetChecks: Array<{
    target: string;
    llmPrompt: string;
    astSignals?: Array<Record<string, string>>;
  }>;
}): RegisteredRule {
  const targetChecks = input.targetChecks.map((check) => ({
    target: check.target,
    astSignals: check.astSignals ?? [],
    llmPrompt: check.llmPrompt,
  }));

  return {
    pack_id: input.packId,
    rule_id: input.ruleId,
    rule_source: input.ruleSource,
    summary: input.summary,
    detector_kind: "case_constraint",
    detector_config: {
      targetPatterns: Array.from(new Set(targetChecks.map((check) => check.target))),
      ...(input.kit && input.kit.length > 0 ? { kit: input.kit } : {}),
      targetChecks,
      llmPrompt: targetChecks
        .filter((check) => check.llmPrompt.length > 0)
        .map((check) => check.llmPrompt)
        .join("\n"),
    },
    fallback_policy: "agent_assisted",
    rule_name: input.ruleName,
    priority: input.priority,
  };
}
