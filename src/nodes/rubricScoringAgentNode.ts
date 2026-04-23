import path from "node:path";
import type { AgentClient } from "../agent/agentClient.js";
import { runRubricCaseAwareAgent } from "../agent/rubricCaseAwareRunner.js";
import { emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function rubricScoringAgentNode(
  state: ScoreGraphState,
  deps: {
    agentClient?: AgentClient;
    logger?: {
      info(message: string): Promise<void>;
      warn(message: string): Promise<void>;
      error(message: string): Promise<void>;
    };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("rubricScoringAgentNode");
  if (!deps.agentClient) {
    await deps.logger?.warn("rubric agent 评分跳过 reason=未配置 agent client");
    return {
      rubricAgentRunnerMode: "case_aware",
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentRunnerResult: undefined,
      rubricAgentTurns: [],
      rubricAgentToolTrace: [],
    };
  }
  if (!state.rubricScoringPromptText || !state.rubricScoringPayload) {
    await deps.logger?.warn("rubric agent 评分跳过 reason=缺少 rubric prompt");
    return {
      rubricAgentRunnerMode: "case_aware",
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentRunnerResult: undefined,
      rubricAgentTurns: [],
      rubricAgentToolTrace: [],
    };
  }

  try {
    const runnerResult = await runRubricCaseAwareAgent({
      caseRoot: state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath),
      bootstrapPayload: state.rubricScoringPayload,
      completeJsonPrompt: (prompt, options) =>
        deps.agentClient!.completeJsonPrompt(prompt, options),
      logger: deps.logger,
    });
    const rubricAgentRunStatus = runnerResult.final_answer ? "success" : "invalid_output";
    return {
      rubricAgentRunnerMode: "case_aware",
      rubricAgentRunStatus,
      rubricAgentRawText: runnerResult.final_answer_raw_text ?? "",
      rubricScoringResult: runnerResult.final_answer,
      rubricAgentRunnerResult: runnerResult,
      rubricAgentTurns: runnerResult.turns,
      rubricAgentToolTrace: runnerResult.tool_trace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`rubric agent 调用失败 error=${message}`);
    return {
      rubricAgentRunnerMode: "case_aware",
      rubricAgentRunStatus: "failed",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentRunnerResult: {
        outcome: "request_failed",
        failure_reason: message,
        turns: [],
        tool_trace: [],
      },
      rubricAgentTurns: [],
      rubricAgentToolTrace: [],
    };
  }
}
