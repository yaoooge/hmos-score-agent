import type { AgentClient } from "../agent/agentClient.js";
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
      agentRunStatus: "not_enabled",
      agentRawOutputText: "",
    };
  }

  if (!deps.agentClient) {
    await deps.logger?.warn("agent 辅助判定跳过 reason=未配置 agent client");
    return {
      agentRunStatus: "skipped",
      agentRawOutputText: "",
    };
  }

  try {
    await deps.logger?.info(`agent 调用开始 candidates=${state.assistedRuleCandidates.length}`);
    const rawOutputText = await deps.agentClient.evaluateRules({
      prompt: state.agentPromptText,
      payload: state.agentPromptPayload,
    });
    await deps.logger?.info("agent 调用完成");
    return {
      agentRunStatus: "success",
      agentRawOutputText: rawOutputText,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`agent 调用失败 error=${message}`);
    return {
      agentRunStatus: "failed",
      agentRawOutputText: "",
    };
  }
}
