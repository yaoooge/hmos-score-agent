import type { AgentBootstrapPayload } from "../types.js";
import { buildAgentInteractionPayload, renderAgentBootstrapPrompt } from "./ruleAssistance.js";

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
    "你后续每一轮都必须严格遵守首轮给出的合法 tool_call / final_answer 示例格式。",
    "禁止输出多个顶层 JSON object，禁止输出任何额外解释。",
    "如果证据已经足够，请直接输出 canonical final_answer。",
    "输出字段仅限首轮 canonical schema 中出现的字段。",
    "顶层 final_answer 必须直接包含 action、summary、rule_assessments。",
    "如果还需要补查，请继续输出 canonical tool_call，但必须控制在剩余预算内。",
    "如果你准备输出 final_answer，必须补齐每一条候选规则的 rule_assessments，不能只给总体判断。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "当前判定上下文如下：",
    JSON.stringify(buildAgentInteractionPayload(input.bootstrapPayload), null, 2),
  ].join("\n");
}

export function renderCaseAwareFinalAnswerRetryPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  latestObservation: string;
}): string {
  const requiredRuleIds = input.bootstrapPayload.assisted_rule_candidates.map(
    (candidate) => candidate.rule_id,
  );
  const ruleAssessments =
    requiredRuleIds.length > 0
      ? requiredRuleIds.map((ruleId) => ({
          rule_id: ruleId,
          decision: "uncertain",
          confidence: "low",
          reason: "请基于已读取证据填写该规则的中文判定理由。",
          evidence_used: [],
          needs_human_review: true,
        }))
      : [
          {
            rule_id: "RULE-ID",
            decision: "uncertain",
            confidence: "low",
            reason: "请基于已读取证据填写该规则的中文判定理由。",
            evidence_used: [],
            needs_human_review: true,
          },
        ];

  const finalAnswerTemplate = {
    action: "final_answer",
    summary: {
      assistant_scope: "基于补丁和必要文件上下文完成候选规则辅助判定。",
      overall_confidence: "medium",
    },
    rule_assessments: ruleAssessments,
  };

  return [
    "这是一次 final_answer 协议修复重试。",
    "上一轮已经进入最终判定阶段，但 final_answer 的 JSON 结构没有通过协议校验。",
    "本轮只能重新输出一个 final_answer JSON object，禁止继续调用工具，禁止输出 markdown、代码块或解释文字。",
    "必须严格使用以下字段名、层级和类型；除这些字段外不要添加任何额外字段：",
    JSON.stringify(finalAnswerTemplate, null, 2),
    "decision 只能是 violation、pass、not_applicable、uncertain。",
    "confidence 和 summary.overall_confidence 只能是 high、medium、low。",
    "summary 必须是 object，包含 assistant_scope 和 overall_confidence。",
    "rule_assessments 必须是 array，且每一项都必须包含 rule_id、decision、confidence、reason、evidence_used、needs_human_review。",
    requiredRuleIds.length > 0
      ? `必须逐条覆盖这些 rule_id: ${requiredRuleIds.join(", ")}。`
      : "当前没有候选 rule_id；如果上游误调用，仍必须保持 final_answer schema 合法。",
    "请用真实判定替换模板中的 decision、confidence、reason、evidence_used、needs_human_review；不要照抄占位理由。",
    `当前回合: ${input.turn}`,
    input.latestObservation
      ? ["最近一次工具观察结果：", input.latestObservation].join("\n")
      : "最近一次工具观察结果：无。",
    "",
    "当前判定上下文如下：",
    JSON.stringify(buildAgentInteractionPayload(input.bootstrapPayload), null, 2),
  ].join("\n");
}

export function renderCaseAwareToolCallRetryPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  turn: number;
  latestObservation: string;
}): string {
  const toolCallTemplate = {
    action: "tool_call",
    tool: "read_patch",
    args: {},
    reason: "请用中文说明为什么需要调用这个工具。",
  };

  return [
    "这是一次 tool_call 协议修复重试。",
    "上一轮准备调用工具，但 tool_call 的 JSON 结构没有通过协议校验。",
    "本轮只能重新输出一个 tool_call JSON object，禁止输出 final_answer，禁止输出 markdown、代码块或解释文字。",
    "必须严格使用以下字段名、层级和类型；除这些字段外不要添加任何额外字段：",
    JSON.stringify(toolCallTemplate, null, 2),
    `tool 只能从这些 allowed_tools 中选择: ${input.bootstrapPayload.tool_contract.allowed_tools.join(", ")}。`,
    "args 必须是 object；不同工具的 args 形状必须遵守首轮 prompt 中的工具参数说明。",
    "reason 是可选字段；如果输出，必须是非空中文字符串。",
    "如果要读取默认有效补丁，优先使用 read_patch 且 args 为 {}。",
    `当前回合: ${input.turn}`,
    input.latestObservation
      ? ["最近一次工具观察结果：", input.latestObservation].join("\n")
      : "最近一次工具观察结果：无。",
    "",
    "当前判定上下文如下：",
    JSON.stringify(buildAgentInteractionPayload(input.bootstrapPayload), null, 2),
  ].join("\n");
}
