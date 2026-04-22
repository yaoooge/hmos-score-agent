import type { AgentClient } from "../agent/agentClient.js";
import { parseRubricScoringResultStrict } from "../agent/rubricScoring.js";
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
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
    };
  }
  if (!state.rubricScoringPromptText) {
    await deps.logger?.warn("rubric agent 评分跳过 reason=缺少 rubric prompt");
    return {
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
    };
  }

  try {
    const rawText = await deps.agentClient.completeJsonPrompt(state.rubricScoringPromptText);
    const result = parseRubricScoringResultStrict(rawText, state.rubricSnapshot);
    await deps.logger?.info(`rubric agent 评分完成 items=${result.item_scores.length}`);
    return {
      rubricAgentRunStatus: "success",
      rubricAgentRawText: rawText,
      rubricScoringResult: result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`rubric agent 评分失败 error=${message}`);
    return {
      rubricAgentRunStatus: "invalid_output",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
    };
  }
}
