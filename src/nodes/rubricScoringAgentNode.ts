import { runOpencodeRubricScoring } from "../agent/opencodeRubricScoring.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../opencode/opencodeCliRunner.js";
import { emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function rubricScoringAgentNode(
  state: ScoreGraphState,
  deps: {
    opencode?: {
      sandboxRoot: string;
      runPrompt(request: OpencodeRunRequest): Promise<OpencodeRunResult>;
    };
    logger?: {
      info(message: string): Promise<void>;
      warn(message: string): Promise<void>;
      error(message: string): Promise<void>;
    };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("rubricScoringAgentNode");
  if (!deps.opencode) {
    await deps.logger?.warn("rubric agent 评分跳过 reason=未配置 opencode runtime");
    return {
      rubricAgentRunnerMode: "opencode",
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentRunnerResult: undefined,
    };
  }
  if (!state.rubricScoringPromptText || !state.rubricScoringPayload) {
    await deps.logger?.warn("rubric agent 评分跳过 reason=缺少 rubric prompt");
    return {
      rubricAgentRunnerMode: "opencode",
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentRunnerResult: undefined,
    };
  }

  try {
    const runnerResult = await runOpencodeRubricScoring({
      sandboxRoot: deps.opencode.sandboxRoot,
      scoringPayload: state.rubricScoringPayload,
      runPrompt: deps.opencode.runPrompt,
      logger: deps.logger,
    });
    if (!runnerResult.final_answer) {
      throw new Error(
        `rubric opencode 输出无效 outcome=${runnerResult.outcome} reason=${runnerResult.failure_reason ?? ""}`,
      );
    }

    return {
      rubricAgentRunnerMode: "opencode",
      rubricAgentRunStatus: "success",
      rubricAgentRawText: runnerResult.final_answer_raw_text ?? "",
      rubricScoringResult: runnerResult.final_answer,
      rubricAgentRunnerResult: runnerResult,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`rubric agent 调用失败 error=${message}`);
    throw error;
  }
}
