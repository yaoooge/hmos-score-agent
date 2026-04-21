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
    "你后续每一轮都必须严格遵守首轮给出的合法 tool_call / final_answer 示例格式。",
    "禁止输出多个顶层 JSON object，禁止混用旧字段名，禁止输出任何额外解释。",
    "如果证据已经足够，请直接输出 canonical final_answer。",
    "如果还需要补查，请继续输出 canonical tool_call，但必须控制在剩余预算内。",
    "如果你准备输出 final_answer，必须补齐每一条候选规则的 rule_assessments，不能只给总体判断。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "原始 bootstrap 载荷如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}
