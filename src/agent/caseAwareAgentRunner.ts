import type {
  AgentBootstrapPayload,
  AgentRunStatus,
  CaseAwareAgentFinalAnswer,
  CaseAwareAgentTurn,
  CaseToolTraceItem,
} from "../types.js";
import { createCaseToolExecutor } from "./caseTools.js";
import {
  renderCaseAwareBootstrapPrompt,
  renderCaseAwareFollowupPrompt,
  renderCaseAwareRepairPrompt,
} from "./caseAwarePrompt.js";
import { parseCaseAwarePlannerOutputStrict } from "./caseAwareProtocol.js";
import { getCaseAwareAgentNextStep } from "./caseAwareAgentGraph.js";

export async function runCaseAwareAgent(input: {
  caseRoot: string;
  bootstrapPayload: AgentBootstrapPayload;
  completeJsonPrompt: (prompt: string) => Promise<string>;
  logger?: {
    info(message: string): Promise<void>;
    warn(message: string): Promise<void>;
    error(message: string): Promise<void>;
  };
}): Promise<{
  status: AgentRunStatus;
  turns: CaseAwareAgentTurn[];
  toolTrace: CaseToolTraceItem[];
  finalAnswer?: CaseAwareAgentFinalAnswer;
  finalAnswerRawText: string;
  forcedFinalizeReason?: string;
}> {
  const executor = createCaseToolExecutor({
    caseRoot: input.caseRoot,
    effectivePatchPath: input.bootstrapPayload.case_context.effective_patch_path,
    maxToolCalls: input.bootstrapPayload.tool_contract.max_tool_calls,
    maxTotalBytes: input.bootstrapPayload.tool_contract.max_total_bytes,
    maxFiles: input.bootstrapPayload.tool_contract.max_files,
  });
  const turns: CaseAwareAgentTurn[] = [];
  const toolTrace: CaseToolTraceItem[] = [];
  let latestObservation = "";
  let finalAnswerRawText = "";
  let finalAnswer: CaseAwareAgentFinalAnswer | undefined;
  let status: AgentRunStatus | undefined;
  let forcedFinalizeReason: string | undefined;
  let repairPrompt: string | undefined;

  await input.logger?.info(
    `case-aware agent 判定开始 candidates=${input.bootstrapPayload.assisted_rule_candidates.length} caseId=${input.bootstrapPayload.case_context.case_id} hasPatch=${Boolean(input.bootstrapPayload.case_context.effective_patch_path)}`,
  );
  await input.logger?.info(
    `case-aware bootstrap 完成 targetFiles=${input.bootstrapPayload.initial_target_files.length} initialPatch=${Boolean(input.bootstrapPayload.case_context.effective_patch_path)} toolBudget=${input.bootstrapPayload.tool_contract.max_tool_calls} byteBudget=${input.bootstrapPayload.tool_contract.max_total_bytes}`,
  );

  const maxTurns = input.bootstrapPayload.tool_contract.max_tool_calls + 1;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const budget = executor.getBudget();
    await input.logger?.info(
      `case-aware planner 开始 turn=${turn} remainingTools=${budget.remainingToolCalls} remainingBytes=${budget.remainingBytes}`,
    );

    const prompt =
      repairPrompt ??
      (turn === 1
        ? renderCaseAwareBootstrapPrompt(input.bootstrapPayload)
        : renderCaseAwareFollowupPrompt({
            bootstrapPayload: input.bootstrapPayload,
            turn,
            latestObservation,
          }));
    repairPrompt = undefined;

    let rawText: string;
    try {
      rawText = await input.completeJsonPrompt(prompt);
    } catch (error) {
      status = "failed";
      forcedFinalizeReason = "agent_request_failed";
      const message = error instanceof Error ? error.message : String(error);
      await input.logger?.error(`case-aware 模型调用失败 turn=${turn} error=${message}`);
      break;
    }

    let decision;
    try {
      decision = parseCaseAwarePlannerOutputStrict(rawText);
    } catch {
      status = "invalid_output";
      finalAnswerRawText = rawText;
      forcedFinalizeReason = "invalid_model_output";
      await input.logger?.warn(`case-aware 输出无效 turn=${turn}`);
      break;
    }

    const nextStep = getCaseAwareAgentNextStep({
      decision,
      status,
      toolCallsUsed: toolTrace.length,
      maxToolCalls: input.bootstrapPayload.tool_contract.max_tool_calls,
    });

    if (decision.action === "final_answer") {
      const missingRuleIds = findMissingCandidateRuleIds(
        decision,
        input.bootstrapPayload.assisted_rule_candidates,
      );
      if (missingRuleIds.length > 0) {
        finalAnswerRawText = JSON.stringify(decision, null, 2);
        turns.push({
          turn,
          action: "final_answer",
          status: "error",
          raw_output_text: rawText,
        });
        latestObservation = JSON.stringify(
          {
            validation_error: "incomplete_final_answer",
            message:
              "final_answer 必须补齐每一条候选规则的结论，不能只输出总体判断或部分 rule_assessments。",
            missing_rule_ids: missingRuleIds,
            received_rule_ids: decision.rule_assessments.map((item) => item.rule_id),
          },
          null,
          2,
        );
        await input.logger?.warn(
          `case-aware final_answer 不完整 turn=${turn} missingRules=${missingRuleIds.join(",")}`,
        );
        repairPrompt = renderCaseAwareRepairPrompt({
          bootstrapPayload: input.bootstrapPayload,
          turn: turn + 1,
          missingRuleIds,
          receivedRuleIds: decision.rule_assessments.map((item) => item.rule_id),
          latestObservation,
        });
        if (turn >= maxTurns) {
          status = "invalid_output";
          forcedFinalizeReason = "incomplete_final_answer";
          break;
        }
        continue;
      }

      finalAnswer = decision;
      finalAnswerRawText = JSON.stringify(decision, null, 2);
      status = "success";
      turns.push({
        turn,
        action: "final_answer",
        status: "success",
        raw_output_text: rawText,
      });
      await input.logger?.info(
        `case-aware 判定完成 turns=${turns.length} reviewedRules=${decision.rule_assessments.length} humanReview=${decision.rule_assessments.filter((item) => item.needs_human_review).length} status=success`,
      );
      break;
    }

    if (nextStep !== "tool_executor") {
      status = "invalid_output";
      forcedFinalizeReason = "tool_budget_exceeded";
      await input.logger?.warn(`case-aware 结束但未产出 final_answer turn=${turn}`);
      break;
    }

    const toolResult = await executor.execute({
      tool: decision.tool,
      args: decision.args,
    });
    toolTrace.push({
      turn,
      tool: decision.tool,
      args: decision.args,
      ok: toolResult.ok,
      error_code: toolResult.ok ? undefined : toolResult.error.code,
      error_message: toolResult.ok ? undefined : toolResult.error.message,
      paths_read: toolResult.pathsRead,
      bytes_returned: toolResult.bytesReturned,
      truncated: Boolean(toolResult.ok ? toolResult.result.truncated : false),
      budget_after_call: toolResult.budget,
    });
    turns.push({
      turn,
      action: "tool_call",
      status: toolResult.ok ? "success" : "error",
      raw_output_text: rawText,
      tool: decision.tool,
      args: decision.args,
      reason: decision.reason,
    });

    latestObservation = JSON.stringify(
      {
        tool: decision.tool,
        args: decision.args,
        ok: toolResult.ok,
        result: toolResult.ok ? toolResult.result : undefined,
        error: toolResult.ok ? undefined : toolResult.error,
        budget: toolResult.budget,
      },
      null,
      2,
    );
    await input.logger?.info(
      `case-aware 工具执行 turn=${turn} tool=${decision.tool} ok=${toolResult.ok} bytes=${toolResult.bytesReturned} paths=${toolResult.pathsRead.length}`,
    );

    if (
      !toolResult.ok &&
      (toolResult.error.code === "tool_budget_exceeded" ||
        toolResult.error.code === "byte_budget_exceeded" ||
        toolResult.error.code === "file_budget_exceeded")
    ) {
      status = "invalid_output";
      forcedFinalizeReason = toolResult.error.code;
      break;
    }
  }

  return {
    status: status ?? "invalid_output",
    turns,
    toolTrace,
    finalAnswer,
    finalAnswerRawText,
    forcedFinalizeReason,
  };
}

function findMissingCandidateRuleIds(
  finalAnswer: CaseAwareAgentFinalAnswer,
  candidates: AgentBootstrapPayload["assisted_rule_candidates"],
): string[] {
  const expectedRuleIds = new Set(candidates.map((candidate) => candidate.rule_id));
  const receivedRuleIds = new Set(
    finalAnswer.rule_assessments
      .map((assessment) => assessment.rule_id)
      .filter((ruleId) => expectedRuleIds.has(ruleId)),
  );

  return candidates
    .map((candidate) => candidate.rule_id)
    .filter((ruleId) => !receivedRuleIds.has(ruleId));
}
