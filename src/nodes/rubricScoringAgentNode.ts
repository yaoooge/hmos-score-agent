import type { AgentClient } from "../agent/agentClient.js";
import {
  renderCompactRubricScoringPrompt,
  parseRubricScoringResultStrict,
  renderRubricScoringRetryPrompt,
} from "../agent/rubricScoring.js";
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
    return await runRubricPromptWithSchemaRepair(
      deps.agentClient,
      deps.logger,
      state.rubricScoringPromptText,
      state.rubricSnapshot,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (shouldRetryWithCompactPrompt(error) && state.rubricScoringPayload) {
      await deps.logger?.warn(`rubric agent 请求失败，切换 compact prompt 重试 error=${message}`);
      try {
        return await runRubricPromptWithSchemaRepair(
          deps.agentClient,
          deps.logger,
          renderCompactRubricScoringPrompt(state.rubricScoringPayload),
          state.rubricSnapshot,
        );
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
        await deps.logger?.error(`rubric agent 评分失败 error=${retryMessage}`);
        return {
          rubricAgentRunStatus: "invalid_output",
          rubricAgentRawText: "",
          rubricScoringResult: undefined,
        };
      }
    }
    await deps.logger?.error(`rubric agent 评分失败 error=${message}`);
    return {
      rubricAgentRunStatus: "invalid_output",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
    };
  }
}

async function runRubricPromptWithSchemaRepair(
  agentClient: AgentClient,
  logger:
    | {
        info(message: string): Promise<void>;
        warn(message: string): Promise<void>;
        error(message: string): Promise<void>;
      }
    | undefined,
  promptText: string,
  rubricSnapshot: ScoreGraphState["rubricSnapshot"],
): Promise<Partial<ScoreGraphState>> {
  const rawText = await agentClient.completeJsonPrompt(promptText, {
    requestTag: "rubric_scoring",
  });
  try {
    const result = parseRubricScoringResultStrict(rawText, rubricSnapshot);
    await logger?.info(`rubric agent 评分完成 items=${result.item_scores.length}`);
    return {
      rubricAgentRunStatus: "success",
      rubricAgentRawText: rawText,
      rubricScoringResult: result,
    };
  } catch (parseError) {
    const parseMessage = parseError instanceof Error ? parseError.message : String(parseError);
    await logger?.warn(`rubric agent 输出违反协议，发起一次修复重试 error=${parseMessage}`);
    const retryPrompt = renderRubricScoringRetryPrompt({
      originalPrompt: promptText,
      invalidOutput: rawText,
      errorMessage: parseMessage,
    });
    const retryRawText = await agentClient.completeJsonPrompt(retryPrompt, {
      requestTag: "rubric_scoring",
    });
    const retryResult = parseRubricScoringResultStrict(retryRawText, rubricSnapshot);
    await logger?.info(`rubric agent 评分完成 items=${retryResult.item_scores.length}`);
    return {
      rubricAgentRunStatus: "success",
      rubricAgentRawText: retryRawText,
      rubricScoringResult: retryResult,
    };
  }
}

function shouldRetryWithCompactPrompt(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "Agent 网络请求失败",
    "fetch failed",
    "UND_ERR_SOCKET",
    "other side closed",
    "Headers Timeout",
    "ETIMEDOUT",
    "ECONNRESET",
  ].some((keyword) => message.includes(keyword));
}
