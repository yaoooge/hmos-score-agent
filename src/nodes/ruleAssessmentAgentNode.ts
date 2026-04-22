import path from "node:path";
import type { AgentClient } from "../agent/agentClient.js";
import { runCaseAwareAgent } from "../agent/caseAwareAgentRunner.js";
import { emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function ruleAssessmentAgentNode(
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
  emitNodeStarted("ruleAssessmentAgentNode");
  if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
    await deps.logger?.warn("rule agent 判定跳过 reason=无候选规则");
    return {
      ruleAgentRunnerMode: "case_aware",
      ruleAgentRunStatus: "not_enabled",
      ruleAgentRunnerResult: undefined,
      ruleAgentTurns: [],
      ruleAgentToolTrace: [],
    };
  }

  if (!deps.agentClient) {
    await deps.logger?.warn("rule agent 判定跳过 reason=未配置 agent client");
    return {
      ruleAgentRunnerMode: "case_aware",
      ruleAgentRunStatus: "skipped",
      ruleAgentRunnerResult: undefined,
      ruleAgentTurns: [],
      ruleAgentToolTrace: [],
    };
  }

  try {
    const runnerResult = await runCaseAwareAgent({
      caseRoot: state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath),
      bootstrapPayload: state.ruleAgentBootstrapPayload,
      completeJsonPrompt: (prompt, options) =>
        deps.agentClient!.completeJsonPrompt(prompt, options),
      logger: deps.logger,
    });
    const ruleAgentRunStatus = runnerResult.final_answer ? "success" : "invalid_output";
    return {
      ruleAgentRunnerMode: "case_aware",
      ruleAgentRunStatus,
      ruleAgentRunnerResult: runnerResult,
      ruleAgentAssessmentResult: runnerResult.final_answer,
      ruleAgentTurns: runnerResult.turns,
      ruleAgentToolTrace: runnerResult.tool_trace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`rule agent 调用失败 error=${message}`);
    return {
      ruleAgentRunnerMode: "case_aware",
      ruleAgentRunStatus: "failed",
      ruleAgentRunnerResult: {
        outcome: "request_failed",
        failure_reason: message,
        turns: [],
        tool_trace: [],
      },
      ruleAgentTurns: [],
      ruleAgentToolTrace: [],
    };
  }
}
