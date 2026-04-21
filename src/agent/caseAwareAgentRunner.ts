import type {
  AgentBootstrapPayload,
  CaseAwareAgentFinalAnswer,
  CaseAwareRunnerResult,
  CaseAwareAgentTurn,
  CaseToolTraceItem,
} from "../types.js";
import { createCaseToolExecutor } from "./caseTools.js";
import {
  renderCaseAwareBootstrapPrompt,
  renderCaseAwareFinalAnswerRetryPrompt,
  renderCaseAwareFollowupPrompt,
} from "./caseAwarePrompt.js";
import {
  describeFinalAnswerValidationFailure,
  parseCaseAwarePlannerOutputStrict,
  validateCaseAwareFinalAnswerAgainstCandidates,
} from "./caseAwareProtocol.js";
import { getCaseAwareAgentNextStep } from "./caseAwareAgentGraph.js";

function isFinalAnswerRetryCandidate(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "action" in parsed &&
      (parsed as { action?: unknown }).action === "final_answer"
    );
  } catch {
    return false;
  }
}

export async function runCaseAwareAgent(input: {
  caseRoot: string;
  bootstrapPayload: AgentBootstrapPayload;
  completeJsonPrompt: (prompt: string) => Promise<string>;
  logger?: {
    info(message: string): Promise<void>;
    warn(message: string): Promise<void>;
    error(message: string): Promise<void>;
  };
}): Promise<CaseAwareRunnerResult> {
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
  let finalAnswerRawJson: string | undefined;
  let finalAnswer: CaseAwareAgentFinalAnswer | undefined;
  let outcome: CaseAwareRunnerResult["outcome"] | undefined;
  let failureReason: string | undefined;
  let finalAnswerRepairRetryUsed = false;

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
      turn === 1
        ? renderCaseAwareBootstrapPrompt(input.bootstrapPayload)
        : renderCaseAwareFollowupPrompt({
            bootstrapPayload: input.bootstrapPayload,
            turn,
            latestObservation,
          });

    let rawText: string;
    try {
      rawText = await input.completeJsonPrompt(prompt);
    } catch (error) {
      outcome = "request_failed";
      failureReason = error instanceof Error ? error.message : String(error);
      await input.logger?.error(`case-aware 模型调用失败 turn=${turn} error=${failureReason}`);
      break;
    }

    let decision;
    try {
      decision = parseCaseAwarePlannerOutputStrict(rawText);
    } catch (error) {
      finalAnswerRawJson = rawText;
      failureReason = error instanceof Error ? error.message : String(error);
      if (!finalAnswerRepairRetryUsed && isFinalAnswerRetryCandidate(rawText)) {
        finalAnswerRepairRetryUsed = true;
        turns.push({
          turn,
          action: "final_answer",
          status: "error",
          raw_output_text: rawText,
        });
        await input.logger?.warn(
          `case-aware final_answer 结构违反协议，发起一次修复重试 turn=${turn} error=${failureReason}`,
        );

        const retryPrompt = renderCaseAwareFinalAnswerRetryPrompt({
          bootstrapPayload: input.bootstrapPayload,
          turn,
          latestObservation,
        });
        try {
          rawText = await input.completeJsonPrompt(retryPrompt);
        } catch (retryError) {
          outcome = "request_failed";
          failureReason =
            retryError instanceof Error ? retryError.message : String(retryError);
          await input.logger?.error(
            `case-aware final_answer 修复重试模型调用失败 turn=${turn} error=${failureReason}`,
          );
          break;
        }

        try {
          decision = parseCaseAwarePlannerOutputStrict(rawText);
        } catch (retryParseError) {
          finalAnswerRawJson = rawText;
          failureReason =
            retryParseError instanceof Error ? retryParseError.message : String(retryParseError);
          outcome = "protocol_error";
          await input.logger?.warn(
            `case-aware final_answer 修复重试仍违反协议 turn=${turn} error=${failureReason}`,
          );
          break;
        }

        if (decision.action !== "final_answer") {
          finalAnswerRawJson = rawText;
          failureReason = "protocol_error: final_answer repair retry must return final_answer";
          outcome = "protocol_error";
          await input.logger?.warn(
            `case-aware final_answer 修复重试返回了非 final_answer action turn=${turn}`,
          );
          break;
        }
      } else {
        outcome = "protocol_error";
        await input.logger?.warn(`case-aware 输出违反协议 turn=${turn} error=${failureReason}`);
        break;
      }
    }

    const nextStep = getCaseAwareAgentNextStep({
      decision,
      status: undefined,
      toolCallsUsed: toolTrace.length,
      maxToolCalls: input.bootstrapPayload.tool_contract.max_tool_calls,
    });

    if (decision.action === "final_answer") {
      const validation = validateCaseAwareFinalAnswerAgainstCandidates(
        decision,
        input.bootstrapPayload.assisted_rule_candidates,
      );
      if (!validation.ok) {
        finalAnswerRawJson = JSON.stringify(decision, null, 2);
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
            missing_rule_ids: validation.missing_rule_ids,
            duplicate_rule_ids: validation.duplicate_rule_ids,
            unexpected_rule_ids: validation.unexpected_rule_ids,
            received_rule_ids: decision.rule_assessments.map((item) => item.rule_id),
          },
          null,
          2,
        );
        await input.logger?.warn(
          `case-aware final_answer 不完整 turn=${turn} detail=${describeFinalAnswerValidationFailure(validation)}`,
        );
        outcome = "protocol_error";
        failureReason = `protocol_error: ${describeFinalAnswerValidationFailure(validation)}`;
        break;
      }

      finalAnswer = decision;
      finalAnswerRawJson = JSON.stringify(decision, null, 2);
      outcome = "success";
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
      outcome = "tool_budget_exhausted";
      failureReason = "tool_budget_exceeded";
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
      ...(decision.reason ? { reason: decision.reason } : {}),
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
      outcome = "tool_budget_exhausted";
      failureReason = toolResult.error.code;
      break;
    }
  }

  return {
    outcome: outcome ?? "protocol_error",
    turns,
    tool_trace: toolTrace,
    final_answer: finalAnswer,
    final_answer_raw_text: finalAnswerRawJson,
    failure_reason: failureReason,
  };
}
