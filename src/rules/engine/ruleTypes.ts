export type RuleSource = "must_rule" | "should_rule" | "forbidden_pattern";

export type StaticRuleResult = "满足" | "不满足" | "不涉及" | "未接入判定器";

// StaticRuleAuditResult 允许暴露静态层内部状态，供 agent 前置链路消费。
export interface StaticRuleAuditResult {
  rule_id: string;
  rule_source: RuleSource;
  result: StaticRuleResult;
  conclusion: string;
}

export type DetectorKind = "text_pattern" | "project_structure" | "not_implemented";

// RegisteredRule 描述规则包中的单条规则定义，不直接绑定具体 evaluator 实现。
export interface RegisteredRule {
  pack_id: string;
  rule_id: string;
  rule_source: RuleSource;
  summary: string;
  detector_kind: DetectorKind;
  detector_config: Record<string, unknown>;
  fallback_policy: "agent_assisted" | "not_applicable";
}

export interface RegisteredRulePack {
  packId: string;
  displayName: string;
  rules: RegisteredRule[];
}
