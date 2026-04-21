import path from "node:path";
import type { AgentClient } from "../agent/agentClient.js";
import { runCaseAwareAgent } from "../agent/caseAwareAgentRunner.js";
import { emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function agentAssistedRuleNode(
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
  emitNodeStarted("agentAssistedRuleNode");
  if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
    await deps.logger?.warn("agent 辅助判定跳过 reason=无候选规则");
    return {
      agentRunnerMode: "case_aware",
      agentRunStatus: "not_enabled",
      agentRunnerResult: undefined,
      agentTurns: [],
      agentToolTrace: [],
    };
  }

  if (!deps.agentClient) {
    await deps.logger?.warn("agent 辅助判定跳过 reason=未配置 agent client");
    return {
      agentRunnerMode: "case_aware",
      agentRunStatus: "skipped",
      agentRunnerResult: undefined,
      agentTurns: [],
      agentToolTrace: [],
    };
  }

  try {
    const runnerResult = await runCaseAwareAgent({
      caseRoot: state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath),
      bootstrapPayload: state.agentBootstrapPayload,
      completeJsonPrompt: (prompt) => deps.agentClient!.completeJsonPrompt(prompt),
      logger: deps.logger,
    });
    const agentRunStatus = runnerResult.final_answer ? "success" : "invalid_output";
    return {
      agentRunnerMode: "case_aware",
      agentRunStatus,
      agentRunnerResult: runnerResult,
      agentAssistedRuleResults: runnerResult.final_answer,
      agentTurns: runnerResult.turns,
      agentToolTrace: runnerResult.tool_trace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`agent 调用失败 error=${message}`);
    return {
      agentRunnerMode: "case_aware",
      agentRunStatus: "failed",
      agentRunnerResult: {
        outcome: "request_failed",
        failure_reason: message,
        turns: [],
        tool_trace: [],
      },
      agentTurns: [],
      agentToolTrace: [],
    };
  }
}
