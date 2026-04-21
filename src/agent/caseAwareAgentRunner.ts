import type {
  AgentBootstrapPayload,
  AgentRunStatus,
  CaseAwareAgentFinalAnswer,
  CaseAwareAgentTurn,
  CaseToolTraceItem,
} from "../types.js";
import { createCaseToolExecutor } from "./caseTools.js";
import {
  parseCaseAwarePlannerOutput,
  renderCaseAwareBootstrapPrompt,
  renderCaseAwareFollowupPrompt,
} from "./caseAwarePrompt.js";
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

  await input.logger?.info(
    `case-aware agent 判定开始 candidates=${input.bootstrapPayload.assisted_rule_candidates.length} caseId=${input.bootstrapPayload.case_context.case_id} hasPatch=${Boolean(input.bootstrapPayload.case_context.effective_patch_path)}`,
  );
  await input.logger?.info(
    `case-aware bootstrap 完成 targetFiles=${input.bootstrapPayload.initial_target_files.length} initialPatch=${Boolean(input.bootstrapPayload.case_context.effective_patch_path)} toolBudget=${input.bootstrapPayload.tool_contract.max_tool_calls} byteBudget=${input.bootstrapPayload.tool_contract.max_total_bytes}`,
  );

  for (let turn = 1; turn <= input.bootstrapPayload.tool_contract.max_tool_calls + 1; turn += 1) {
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

    const rawText = await input.completeJsonPrompt(prompt);

    let decision;
    try {
      decision = parseCaseAwarePlannerOutput(rawText);
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
      finalAnswer = decision;
      finalAnswerRawText = rawText;
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
