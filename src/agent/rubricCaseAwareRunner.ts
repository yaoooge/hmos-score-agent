import type {
  CaseAwareAgentTurn,
  CaseToolTraceItem,
  RubricCaseAwareRunnerResult,
  RubricScoringPayload,
  RubricScoringResult,
} from "../types.js";
import { createCaseToolExecutor } from "./caseTools.js";
import {
  describeRubricFinalAnswerValidationFailure,
  parseRubricCaseAwarePlannerOutputStrict,
  type RubricCaseAwareFinalAnswer,
  validateRubricFinalAnswerAgainstSnapshot,
} from "./rubricCaseAwareProtocol.js";
import {
  renderRubricCaseAwareBootstrapPrompt,
  renderRubricCaseAwareFinalAnswerRetryPrompt,
  renderRubricCaseAwareFollowupPrompt,
  renderRubricCaseAwareSingleActionRetryPrompt,
  renderRubricCaseAwareSystemPrompt,
  renderRubricCaseAwareToolCallRetryPrompt,
} from "./rubricCaseAwarePrompt.js";

function isActionRetryCandidate(rawText: string, action: "final_answer" | "tool_call"): boolean {
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
      (parsed as { action?: unknown }).action === action
    );
  } catch {
    return false;
  }
}

function stripFinalAnswerAction(finalAnswer: RubricCaseAwareFinalAnswer): RubricScoringResult {
  const { action: _action, ...result } = finalAnswer;
  return result;
}

function toolContract(
  payload: RubricScoringPayload,
): NonNullable<RubricScoringPayload["tool_contract"]> {
  return (
    payload.tool_contract ?? {
      allowed_tools: [
        "read_patch",
        "list_dir",
        "read_file",
        "read_file_chunk",
        "grep_in_files",
        "read_json",
      ],
      max_tool_calls: 4,
      max_total_bytes: 40960,
      max_files: 12,
    }
  );
}

export async function runRubricCaseAwareAgent(input: {
  caseRoot: string;
  bootstrapPayload: RubricScoringPayload;
  completeJsonPrompt: (
    prompt: string,
    options?: { systemPrompt?: string; requestTag?: string },
  ) => Promise<string>;
  logger?: {
    info(message: string): Promise<void>;
    warn(message: string): Promise<void>;
    error(message: string): Promise<void>;
  };
}): Promise<RubricCaseAwareRunnerResult> {
  const contract = toolContract(input.bootstrapPayload);
  const executor = createCaseToolExecutor({
    caseRoot: input.caseRoot,
    effectivePatchPath: input.bootstrapPayload.case_context.effective_patch_path,
    maxToolCalls: contract.max_tool_calls,
    maxTotalBytes: contract.max_total_bytes,
    maxFiles: contract.max_files,
  });
  const turns: CaseAwareAgentTurn[] = [];
  const toolTrace: CaseToolTraceItem[] = [];
  let latestObservation = "";
  let finalAnswerRawText: string | undefined;
  let finalAnswer: RubricScoringResult | undefined;
  let outcome: RubricCaseAwareRunnerResult["outcome"] | undefined;
  let failureReason: string | undefined;
  let topLevelRepairRetryUsed = false;
  let finalAnswerRepairRetryUsed = false;
  let toolCallRepairRetryUsed = false;
  const systemPrompt = renderRubricCaseAwareSystemPrompt(input.bootstrapPayload);

  await input.logger?.info(
    `rubric case-aware agent 评分开始 caseId=${input.bootstrapPayload.case_context.case_id} targetFiles=${input.bootstrapPayload.initial_target_files?.length ?? 0} hasPatch=${Boolean(input.bootstrapPayload.case_context.effective_patch_path)}`,
  );

  const maxTurns = contract.max_tool_calls + 1;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const budget = executor.getBudget();
    await input.logger?.info(
      `rubric case-aware planner 开始 turn=${turn} remainingTools=${budget.remainingToolCalls} remainingBytes=${budget.remainingBytes}`,
    );

    const prompt =
      turn === 1
        ? renderRubricCaseAwareBootstrapPrompt(input.bootstrapPayload)
        : renderRubricCaseAwareFollowupPrompt({
            bootstrapPayload: input.bootstrapPayload,
            turn,
            latestObservation,
          });

    let rawText: string;
    try {
      rawText = await input.completeJsonPrompt(prompt, {
        systemPrompt,
        requestTag: `rubric_case_aware_turn_${turn}`,
      });
    } catch (error) {
      outcome = "request_failed";
      failureReason = error instanceof Error ? error.message : String(error);
      await input.logger?.error(
        `rubric case-aware 模型调用失败 turn=${turn} error=${failureReason}`,
      );
      break;
    }

    let decision;
    try {
      decision = parseRubricCaseAwarePlannerOutputStrict(rawText);
    } catch (error) {
      failureReason = error instanceof Error ? error.message : String(error);
      finalAnswerRawText = rawText;
      if (!finalAnswerRepairRetryUsed && isActionRetryCandidate(rawText, "final_answer")) {
        finalAnswerRepairRetryUsed = true;
        turns.push({
          turn,
          action: "final_answer",
          status: "error",
          raw_output_text: rawText,
        });
        await input.logger?.warn(
          `rubric case-aware final_answer 结构违反协议，发起一次修复重试 turn=${turn} error=${failureReason}`,
        );
        try {
          rawText = await input.completeJsonPrompt(
            renderRubricCaseAwareFinalAnswerRetryPrompt({
              bootstrapPayload: input.bootstrapPayload,
              turn,
              latestObservation,
              failureReason,
            }),
            {
              systemPrompt,
              requestTag: `rubric_case_aware_turn_${turn}_final_answer_retry`,
            },
          );
          decision = parseRubricCaseAwarePlannerOutputStrict(rawText);
        } catch (retryError) {
          outcome = "protocol_error";
          failureReason = retryError instanceof Error ? retryError.message : String(retryError);
          finalAnswerRawText = rawText;
          break;
        }
        if (decision.action !== "final_answer") {
          outcome = "protocol_error";
          failureReason = "protocol_error: final_answer repair retry must return final_answer";
          finalAnswerRawText = rawText;
          break;
        }
      } else if (!toolCallRepairRetryUsed && isActionRetryCandidate(rawText, "tool_call")) {
        toolCallRepairRetryUsed = true;
        turns.push({
          turn,
          action: "tool_call",
          status: "error",
          raw_output_text: rawText,
        });
        await input.logger?.warn(
          `rubric case-aware tool_call 结构违反协议，发起一次修复重试 turn=${turn} error=${failureReason}`,
        );
        try {
          rawText = await input.completeJsonPrompt(
            renderRubricCaseAwareToolCallRetryPrompt({
              bootstrapPayload: input.bootstrapPayload,
              turn,
              latestObservation,
              failureReason,
            }),
            {
              systemPrompt,
              requestTag: `rubric_case_aware_turn_${turn}_tool_retry`,
            },
          );
          decision = parseRubricCaseAwarePlannerOutputStrict(rawText);
        } catch (retryError) {
          outcome = "protocol_error";
          failureReason = retryError instanceof Error ? retryError.message : String(retryError);
          finalAnswerRawText = rawText;
          break;
        }
        if (decision.action !== "tool_call") {
          outcome = "protocol_error";
          failureReason = "protocol_error: tool_call repair retry must return tool_call";
          finalAnswerRawText = rawText;
          break;
        }
      } else if (!topLevelRepairRetryUsed) {
        topLevelRepairRetryUsed = true;
        await input.logger?.warn(
          `rubric case-aware 顶层 action 违反协议，发起一次修复重试 turn=${turn} error=${failureReason}`,
        );
        try {
          rawText = await input.completeJsonPrompt(
            renderRubricCaseAwareSingleActionRetryPrompt({
              bootstrapPayload: input.bootstrapPayload,
              turn,
              latestObservation,
              failureReason,
              rawOutputText: rawText,
            }),
            {
              systemPrompt,
              requestTag: `rubric_case_aware_turn_${turn}_single_action_retry`,
            },
          );
          decision = parseRubricCaseAwarePlannerOutputStrict(rawText);
        } catch (retryError) {
          outcome = "protocol_error";
          failureReason = retryError instanceof Error ? retryError.message : String(retryError);
          finalAnswerRawText = rawText;
          break;
        }
      } else {
        outcome = "protocol_error";
        await input.logger?.warn(
          `rubric case-aware 输出违反协议 turn=${turn} error=${failureReason}`,
        );
        break;
      }
    }

    if (decision.action === "final_answer") {
      const validation = validateRubricFinalAnswerAgainstSnapshot(
        decision,
        input.bootstrapPayload.rubric_summary,
      );
      if (!validation.ok) {
        finalAnswerRawText = JSON.stringify(decision, null, 2);
        turns.push({
          turn,
          action: "final_answer",
          status: "error",
          raw_output_text: rawText,
        });
        outcome = "protocol_error";
        failureReason = `protocol_error: ${describeRubricFinalAnswerValidationFailure(validation)}`;
        await input.logger?.warn(
          `rubric case-aware final_answer 不完整 turn=${turn} detail=${describeRubricFinalAnswerValidationFailure(validation)}`,
        );
        break;
      }

      finalAnswer = stripFinalAnswerAction(decision);
      finalAnswerRawText = rawText;
      outcome = "success";
      turns.push({
        turn,
        action: "final_answer",
        status: "success",
        raw_output_text: rawText,
      });
      await input.logger?.info(
        `rubric case-aware 评分完成 turns=${turns.length} items=${finalAnswer.item_scores.length} status=success`,
      );
      break;
    }

    if (toolTrace.length >= contract.max_tool_calls) {
      outcome = "tool_budget_exhausted";
      failureReason = "tool_budget_exceeded";
      await input.logger?.warn(`rubric case-aware 工具预算耗尽 turn=${turn}`);
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
      `rubric case-aware 工具执行 turn=${turn} tool=${decision.tool} ok=${toolResult.ok} bytes=${toolResult.bytesReturned} paths=${toolResult.pathsRead.length}`,
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
    final_answer: finalAnswer,
    final_answer_raw_text: finalAnswerRawText,
    failure_reason: failureReason,
    turns,
    tool_trace: toolTrace,
  };
}
