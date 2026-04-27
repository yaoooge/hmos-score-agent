import { z } from "zod";
import { extractFinalJsonObject } from "../opencode/finalJson.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../opencode/opencodeCliRunner.js";
import type { AgentAssistedRuleResult, AgentBootstrapPayload, AssistedRuleCandidate } from "../types.js";
import { buildOpencodeRequestTag } from "./opencodeRequestTag.js";

const opencodeRuleAssessmentSchema = z
  .object({
    summary: z
      .object({
        assistant_scope: z.string().min(1),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    rule_assessments: z
      .array(
        z
          .object({
            rule_id: z.string().min(1),
            decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
            confidence: z.enum(["high", "medium", "low"]),
            reason: z.string().min(1),
            evidence_used: z.array(z.string()),
            needs_human_review: z.boolean(),
          })
          .strict(),
      ),
  })
  .strict();

export type OpencodeRuleAssessmentOutcome = "success" | "request_failed" | "protocol_error";

export interface OpencodeRuleAssessmentResult {
  outcome: OpencodeRuleAssessmentOutcome;
  final_answer?: AgentAssistedRuleResult;
  final_answer_raw_text?: string;
  raw_events?: string;
  failure_reason?: string;
}

export interface OpencodeRuleAssessmentInput {
  sandboxRoot: string;
  bootstrapPayload: AgentBootstrapPayload;
  runPrompt: (request: OpencodeRunRequest) => Promise<OpencodeRunResult>;
  logger?: {
    info?(message: string): Promise<void> | void;
    warn?(message: string): Promise<void> | void;
    error?(message: string): Promise<void> | void;
  };
}

const RULE_ASSESSMENT_OUTPUT_FILE = "metadata/agent-output/rule-assessment.json";

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function summarizeRetryFailureReason(reason: string): string {
  if (reason.includes("缺少 assistant 最终文本")) {
    return "缺少 assistant 最终文本";
  }
  if (reason.includes("JSON object")) {
    return "最终输出不是唯一 JSON object";
  }
  return reason.split(/\r?\n/, 1)[0]?.slice(0, 120) || "未知输出格式错误";
}

function retryFailureGuidance(reason: string): string[] {
  const guidance = [
    "协议错误修复清单:",
    `- listed protocol errors: ${summarizeRetryFailureReason(reason)}`,
    "- 只修复 listed protocol errors，禁止重新判定，禁止改变未列出的 rule 判断。",
  ];
  if (reason.includes("missing=")) {
    guidance.push("- missing: 只补齐列出的候选 rule_id；无法确认时 decision=\"uncertain\" 且 needs_human_review=true。");
  }
  if (reason.includes("duplicate=")) {
    guidance.push("- duplicate: 只保留每个 rule_id 的一个判定，删除重复条目。");
  }
  if (reason.includes("unexpected=")) {
    guidance.push("- unexpected: 删除不在候选规则列表中的未知 rule_id。");
  }
  if (reason.includes("Unrecognized key") || reason.includes("Expected") || reason.includes("Invalid input")) {
    guidance.push("- schema_error: 删除未声明字段，补齐缺失字段，并修正字段类型。");
    guidance.push("- 删除未声明字段，例如 extra、message、risk_level 等。");
  }
  return guidance;
}

function compactRuleRetryPayload(payload: AgentBootstrapPayload): Record<string, unknown> {
  return {
    candidate_rule_ids: payload.assisted_rule_candidates.map((candidate) => candidate.rule_id),
    output_file: RULE_ASSESSMENT_OUTPUT_FILE,
  };
}

function renderRuleAssessmentRetryPrompt(input: {
  bootstrapPayload: AgentBootstrapPayload;
  retryContext: { failureReason: string; rawText: string };
}): string {
  return [
    "你是评分流程中的规则判定 agent。本次是重试，只修正最终 JSON 输出格式。",
    `上一次失败原因: ${summarizeRetryFailureReason(input.retryContext.failureReason)}`,
    "",
    "输入边界（必须遵守）:",
    "- 不要重新读取原始 prompt、rubric 全量内容或大段上下文。",
    "- 不要输出分析过程、Markdown、代码块或自然语言前后缀。",
    "- 只根据 candidate_rule_ids 覆盖所有候选 rule_id。",
    ...retryFailureGuidance(input.retryContext.failureReason),
    "",
    "任务:",
    "1. 输出一个合法 JSON object。",
    "2. rule_assessments 必须覆盖 candidate_rule_ids 中每个 rule_id，不能新增、遗漏或重复。",
    "3. 无法确认时使用 decision=\"uncertain\"，并设置 needs_human_review=true。",
    "4. evidence_used 只能填写 sandbox 相对路径。",
    "",
    "最终输出要求:",
    "- 将最终 JSON object 写入 output_file。",
    "- assistant 最终回复只输出 {\"output_file\":\"metadata/agent-output/rule-assessment.json\"}。",
    "- 覆盖写入 output_file，不要沿用旧文件内容。",
    `output_file: ${RULE_ASSESSMENT_OUTPUT_FILE}`,
    "- 严格遵守 system prompt 中的正确输出格式。",
    "- 只输出一个 JSON object，不要 Markdown，不要解释文字。",
    "- JSON 字段必须完全符合 system prompt 中的结构，不能增加额外字段。",
    "- 最终答案的第一个非空字符必须是 {。",
    "- 最后一个非空字符必须是 }。",
    "",
    "candidate_rule_ids:",
    stringifyForPrompt(compactRuleRetryPayload(input.bootstrapPayload)),
  ].join("\n");
}

function renderRuleAssessmentPrompt(input: {
  sandboxRoot: string;
  bootstrapPayload: AgentBootstrapPayload;
  retryContext?: { failureReason: string; rawText: string };
}): string {
  const payload = input.bootstrapPayload;
  if (input.retryContext) {
    return renderRuleAssessmentRetryPrompt({
      bootstrapPayload: input.bootstrapPayload,
      retryContext: input.retryContext,
    });
  }
  return [
    "你是评分流程中的规则判定 agent。只能阅读当前 sandbox 目录内的文件，不能修改文件，不能运行命令，不能访问网络。",
    "",
    `Sandbox 根目录: ${input.sandboxRoot}`,
    "可阅读目录约定:",
    "- generated/: 待评分的生成结果代码。",
    "- original/: 原始工程代码；如果不存在，说明本用例没有提供原始工程。",
    "- patch/: 生成结果相对原始工程的补丁，优先查看 patch/effective.patch。",
    "- metadata/: 用例元数据。",
    "- references/: 评分参考材料。",
    "",
    "任务:",
    "1. 阅读 bootstrap_payload 中的候选规则、任务理解、rubric 摘要和目标文件。",
    "2. 只基于 patch/effective.patch 内可见文件完成每条候选规则的判定，generated/ 仅用于相关上下文辅助。",
    "3. 必须覆盖 assisted_rule_candidates 中的每一个 rule_id，不能新增、遗漏或重复 rule_id。",
    "4. 无法确认时使用 decision=\"uncertain\"，并设置 needs_human_review=true。",
    "5. evidence_used 只能填写 sandbox 内相对路径，例如 generated/、original/、patch/、metadata/、references/ 下的路径。",
    "",
    "最终输出要求:",
    "- 将最终 JSON object 写入 output_file。",
    "- assistant 最终回复只输出 {\"output_file\":\"metadata/agent-output/rule-assessment.json\"}。",
    `output_file: ${RULE_ASSESSMENT_OUTPUT_FILE}`,
    "- 严格遵守 system prompt 中的正确输出格式。",
    "- 只输出一个 JSON object，不要 Markdown，不要解释文字。",
    "- JSON 字段必须完全符合 system prompt 中的结构，不能增加额外字段。",
    "- 最终答案的第一个非空字符必须是 {。",
    "- 最后一个非空字符必须是 }。",
    "- 不要输出分析过程、说明文字、Markdown、代码块或自然语言前后缀。",
    "- 严格遵守 system prompt 中的正确输出格式。",
    "",
    "bootstrap_payload:",
    stringifyForPrompt({
      case_context: payload.case_context,
      task_understanding: payload.task_understanding,
      rubric_summary: payload.rubric_summary,
      assisted_rule_candidates: payload.assisted_rule_candidates,
      initial_target_files: payload.initial_target_files,
    }),
  ].join("\n");
}

function schemaFailureMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function validateRuleCoverage(
  finalAnswer: AgentAssistedRuleResult,
  candidates: AssistedRuleCandidate[],
): { ok: boolean; failureReason?: string } {
  const expectedRuleIds = candidates.map((candidate) => candidate.rule_id);
  const expected = new Set(expectedRuleIds);
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();

  for (const assessment of finalAnswer.rule_assessments) {
    if (seen.has(assessment.rule_id)) {
      duplicate.add(assessment.rule_id);
    }
    seen.add(assessment.rule_id);
    if (!expected.has(assessment.rule_id)) {
      unexpected.add(assessment.rule_id);
    }
  }

  const missing = expectedRuleIds.filter((ruleId) => !seen.has(ruleId));
  const parts = [
    missing.length > 0 ? `missing=${missing.join(",")}` : "",
    duplicate.size > 0 ? `duplicate=${Array.from(duplicate).join(",")}` : "",
    unexpected.size > 0 ? `unexpected=${Array.from(unexpected).join(",")}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? { ok: false, failureReason: parts.join("; ") } : { ok: true };
}

function normalizeRuleAssessmentResult(
  finalAnswer: AgentAssistedRuleResult,
  candidates: AssistedRuleCandidate[],
): AgentAssistedRuleResult {
  const assessmentsByRuleId = new Map<string, AgentAssistedRuleResult["rule_assessments"][number]>();
  for (const assessment of finalAnswer.rule_assessments) {
    if (!assessmentsByRuleId.has(assessment.rule_id)) {
      assessmentsByRuleId.set(assessment.rule_id, assessment);
    }
  }

  return {
    ...finalAnswer,
    rule_assessments: candidates.map((candidate) => {
      const assessment = assessmentsByRuleId.get(candidate.rule_id);
      if (assessment) {
        return {
          ...assessment,
          rule_id: candidate.rule_id,
        };
      }
      return {
        rule_id: candidate.rule_id,
        decision: "uncertain",
        confidence: "low",
        reason: "agent 输出遗漏该候选规则，本地骨架补为 uncertain，需人工复核。",
        evidence_used: [],
        needs_human_review: true,
      };
    }),
  };
}

function parseRuleAssessmentRunResult(
  runResult: OpencodeRunResult,
  candidates: AssistedRuleCandidate[],
): OpencodeRuleAssessmentResult {
  let parsedJson: Record<string, unknown>;
  try {
    parsedJson = extractFinalJsonObject(runResult.rawText);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    return {
      outcome: "protocol_error",
      final_answer_raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
      failure_reason: failureReason,
    };
  }

  const parsed = opencodeRuleAssessmentSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      outcome: "protocol_error",
      final_answer_raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
      failure_reason: schemaFailureMessage(parsed.error),
    };
  }

  const finalAnswer = normalizeRuleAssessmentResult(parsed.data, candidates);
  const validation = validateRuleCoverage(finalAnswer, candidates);
  if (!validation.ok) {
    return {
      outcome: "protocol_error",
      final_answer_raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
      failure_reason: validation.failureReason,
    };
  }

  return {
    outcome: "success",
    final_answer: finalAnswer,
    final_answer_raw_text: runResult.rawText,
    raw_events: runResult.rawEvents,
  };
}

export async function runOpencodeRuleAssessment(
  input: OpencodeRuleAssessmentInput,
): Promise<OpencodeRuleAssessmentResult> {
  const requestTag = buildOpencodeRequestTag({
    prefix: "rule-assessment",
    caseId: input.bootstrapPayload.case_context.case_id,
    sandboxRoot: input.sandboxRoot,
  });
  let runResult: OpencodeRunResult;

  async function runOnce(inputRequestTag: string, retryContext?: { failureReason: string; rawText: string }) {
    return input.runPrompt({
      prompt: renderRuleAssessmentPrompt({
        sandboxRoot: input.sandboxRoot,
        bootstrapPayload: input.bootstrapPayload,
        retryContext,
      }),
      sandboxRoot: input.sandboxRoot,
      requestTag: inputRequestTag,
      title: inputRequestTag,
      agent: "hmos-rule-assessment",
      outputFile: RULE_ASSESSMENT_OUTPUT_FILE,
    });
  }

  try {
    runResult = await runOnce(requestTag);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await input.logger?.warn?.(`opencode rule assessment request failed: ${failureReason}`);
    try {
      const retryRunResult = await runOnce(`${requestTag}-retry-1`, {
        failureReason,
        rawText: "",
      });
      return parseRuleAssessmentRunResult(retryRunResult, input.bootstrapPayload.assisted_rule_candidates);
    } catch (retryError) {
      const retryFailureReason = retryError instanceof Error ? retryError.message : String(retryError);
      await input.logger?.warn?.(`opencode rule assessment retry request failed: ${retryFailureReason}`);
      return {
        outcome: "request_failed",
        failure_reason: retryFailureReason,
      };
    }
  }

  const firstParseResult = parseRuleAssessmentRunResult(runResult, input.bootstrapPayload.assisted_rule_candidates);
  if (firstParseResult.outcome !== "protocol_error") {
    return firstParseResult;
  }

  let retryRunResult: OpencodeRunResult;
  try {
    retryRunResult = await runOnce(`${requestTag}-retry-1`, {
      failureReason: firstParseResult.failure_reason ?? "unknown protocol error",
      rawText: firstParseResult.final_answer_raw_text ?? "",
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await input.logger?.warn?.(`opencode rule assessment retry request failed: ${failureReason}`);
    return {
      outcome: "request_failed",
      failure_reason: failureReason,
    };
  }

  return parseRuleAssessmentRunResult(retryRunResult, input.bootstrapPayload.assisted_rule_candidates);
}
