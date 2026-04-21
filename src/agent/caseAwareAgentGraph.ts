import type { AgentRunStatus, CaseAwareAgentPlannerOutput } from "../types.js";

export function getCaseAwareAgentNextStep(input: {
  decision?: CaseAwareAgentPlannerOutput;
  status?: AgentRunStatus;
  toolCallsUsed: number;
  maxToolCalls: number;
}): "tool_executor" | "done" {
  if (input.status && input.status !== "success") {
    return "done";
  }

  if (!input.decision) {
    return "done";
  }

  if (input.decision.action === "final_answer") {
    return "done";
  }

  if (input.toolCallsUsed >= input.maxToolCalls) {
    return "done";
  }

  return "tool_executor";
}
