import { runOpencodeRuleAssessment } from "../agent/opencodeRuleAssessment.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../opencode/opencodeCliRunner.js";
import { emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function ruleAssessmentAgentNode(
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
  emitNodeStarted("ruleAssessmentAgentNode");
  if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
    await deps.logger?.warn("rule agent 判定跳过 reason=无候选规则");
    return {
      ruleAgentRunnerMode: "opencode",
      ruleAgentRunStatus: "not_enabled",
      ruleAgentRunnerResult: undefined,
    };
  }

  if (!deps.opencode) {
    await deps.logger?.warn("rule agent 判定跳过 reason=未配置 opencode runtime");
    return {
      ruleAgentRunnerMode: "opencode",
      ruleAgentRunStatus: "skipped",
      ruleAgentRunnerResult: undefined,
    };
  }

  try {
    const runnerResult = await runOpencodeRuleAssessment({
      sandboxRoot: deps.opencode.sandboxRoot,
      bootstrapPayload: state.ruleAgentBootstrapPayload,
      runPrompt: deps.opencode.runPrompt,
      logger: deps.logger,
    });
    if (!runnerResult.final_answer) {
      throw new Error(
        `rule opencode 输出无效 outcome=${runnerResult.outcome} reason=${runnerResult.failure_reason ?? ""}`,
      );
    }

    return {
      ruleAgentRunnerMode: "opencode",
      ruleAgentRunStatus: "success",
      ruleAgentRunnerResult: runnerResult,
      ruleAgentAssessmentResult: runnerResult.final_answer,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`rule agent 调用失败 error=${message}`);
    throw error;
  }
}
