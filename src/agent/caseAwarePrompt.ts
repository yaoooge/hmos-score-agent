import { z } from "zod";
import type {
  AgentBootstrapPayload,
  CaseAwareAgentFinalAnswer,
  CaseAwareAgentPlannerOutput,
} from "../types.js";
import { renderAgentBootstrapPrompt } from "./ruleAssistance.js";
import { caseToolNameSchema } from "./caseToolSchemas.js";

const finalAnswerSchema = z
  .object({
    action: z.literal("final_answer"),
    summary: z
      .object({
        assistant_scope: z.string(),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    rule_assessments: z.array(
      z
        .object({
          rule_id: z.string(),
          decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
          confidence: z.enum(["high", "medium", "low"]),
          reason: z.string(),
          evidence_used: z.array(z.string()),
          needs_human_review: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const toolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string(),
  })
  .strict();

const plannerOutputSchema = z.union([toolCallSchema, finalAnswerSchema]);

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
    "如果还需要补查，请继续输出 tool_call，但必须控制在剩余预算内。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "原始 bootstrap 载荷如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}

export function parseCaseAwarePlannerOutput(rawText: string): CaseAwareAgentPlannerOutput {
  const parsed = JSON.parse(rawText) as unknown;
  return plannerOutputSchema.parse(parsed) as CaseAwareAgentPlannerOutput;
}

export function stripFinalAnswerAction(
  finalAnswer: CaseAwareAgentFinalAnswer,
): Omit<CaseAwareAgentFinalAnswer, "action"> {
  const { action: _ignored, ...rest } = finalAnswer;
  return rest;
}
