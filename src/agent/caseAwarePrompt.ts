import type { AgentBootstrapPayload } from "../types.js";
import { renderAgentBootstrapPrompt } from "./ruleAssistance.js";

export function renderCaseAwareBootstrapPrompt(payload: AgentBootstrapPayload): string {
  return renderAgentBootstrapPrompt(payload);
}

export function renderCaseAwareFollowupPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  latestObservation: string;
}): string {
  return [
    "你正在继续同一个 case-aware 辅助判定任务。",
    "下面是最近一次工具调用返回的结果，请结合已有上下文继续决定下一步。",
    "如果证据已经足够，请直接输出 final_answer。",
    "如果你准备输出 final_answer，必须补齐每一条候选规则的 rule_assessments，不能只给总体判断。",
    "如果还需要补查，请继续输出 tool_call，但必须控制在剩余预算内。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "原始 bootstrap 载荷如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}

export function renderCaseAwareRepairPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  missingRuleIds: string[];
  receivedRuleIds: string[];
  latestObservation: string;
}): string {
  return [
    "你上一轮输出的 final_answer 不完整，当前不能结束任务。",
    "请直接重发完整的 final_answer，不要再次输出 summary-only，不要省略 rule_assessments。",
    "除非你明确缺少关键证据，否则不要再次调用 tool_call。",
    "如果某条规则证据不足，也必须保留该 rule_id，并将 decision 设为 uncertain、needs_human_review 设为 true。",
    `当前回合: ${input.turn}`,
    `缺失的 rule_id: ${input.missingRuleIds.join(", ")}`,
    input.receivedRuleIds.length > 0
      ? `已收到的 rule_id: ${input.receivedRuleIds.join(", ")}`
      : "已收到的 rule_id: 无",
    "最近一次校验反馈：",
    input.latestObservation,
    "",
    "请确保 rule_assessments 覆盖以下全部候选规则：",
    input.bootstrapPayload.assisted_rule_candidates
      .map((candidate) => `- ${candidate.rule_id}`)
      .join("\n"),
    "",
    "请直接输出一个完整 JSON object，字段要求如下：",
    "顶层 action 必须为 final_answer。",
    "summary.assistant_scope 使用中文说明本次辅助范围。",
    "summary.overall_confidence 只能为 high、medium、low。",
    "rule_assessments 必须覆盖下方全部 rule_id，每条包含 rule_id、decision、confidence、reason、evidence_used、needs_human_review。",
    "如果某条规则证据不足，decision 使用 uncertain，needs_human_review 使用 true。",
  ].join("\n");
}
