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
    },
    fallback_policy: "agent_assisted",
  };
}
