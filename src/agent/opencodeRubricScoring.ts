import { z } from "zod";
import { extractFinalJsonObject } from "../opencode/finalJson.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../opencode/opencodeCliRunner.js";
import type { LoadedRubricSnapshot, RubricScoringPayload, RubricScoringResult } from "../types.js";
import { buildOpencodeRequestTag } from "./opencodeRequestTag.js";

const confidenceSchema = z.enum(["high", "medium", "low"]);

const deductionTraceSchema = z
  .object({
    code_locations: z.array(z.string().min(1)).min(1),
    impact_scope: z.string().min(1),
    rubric_comparison: z.string().min(1),
    deduction_reason: z.string().min(1),
    improvement_suggestion: z.string(),
  })
  .strict();

const opencodeRubricScoringSchema = z
  .object({
    summary: z
      .object({
        overall_assessment: z.string().min(1),
        overall_confidence: confidenceSchema,
      })
      .strict(),
    item_scores: z.array(
      z
        .object({
          dimension_name: z.string().min(1),
          item_name: z.string().min(1),
          score: z.number(),
          max_score: z.number(),
          matched_band_score: z.number(),
          rationale: z.string().min(1),
          evidence_used: z.array(z.string()),
          confidence: confidenceSchema,
          review_required: z.boolean(),
          deduction_trace: deductionTraceSchema.optional(),
        })
        .strict(),
    ),
    hard_gate_candidates: z.array(
      z
        .object({
          gate_id: z.enum(["G1", "G2", "G3", "G4"]),
          triggered: z.boolean(),
          reason: z.string(),
          confidence: confidenceSchema,
        })
        .strict(),
    ),
    risks: z.array(
      z
        .object({
          level: z.string(),
          title: z.string(),
          description: z.string(),
          evidence: z.string(),
        })
        .strict(),
    ),
    strengths: z.array(z.string()),
    main_issues: z.array(z.string()),
  })
  .strict();

export type OpencodeRubricScoringOutcome = "success" | "request_failed" | "protocol_error";

export interface OpencodeRubricScoringResult {
  outcome: OpencodeRubricScoringOutcome;
  final_answer?: RubricScoringResult;
  final_answer_raw_text?: string;
  raw_events?: string;
  failure_reason?: string;
}

export interface OpencodeRubricScoringInput {
  sandboxRoot: string;
  scoringPayload: RubricScoringPayload;
  runPrompt: (request: OpencodeRunRequest) => Promise<OpencodeRunResult>;
  logger?: {
    info?(message: string): Promise<void> | void;
    warn?(message: string): Promise<void> | void;
    error?(message: string): Promise<void> | void;
  };
}

function stringifyForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function rubricOutputFormat(): Record<string, unknown> {
  return {
    summary: {
      overall_assessment: "中文总体评价",
      overall_confidence: "high | medium | low",
    },
    item_scores: [
      {
        dimension_name: "rubric 维度名",
        item_name: "rubric 评分项名",
        score: 40,
        max_score: 40,
        matched_band_score: 40,
        rationale: "中文说明评分依据",
        evidence_used: ["generated/entry/src/main.ets"],
        confidence: "high | medium | low",
        review_required: false,
        deduction_trace: {
          code_locations: ["generated/entry/src/main.ets:12"],
          impact_scope: "影响范围",
          rubric_comparison: "未命中更高档，因为...；命中当前档，因为...",
          deduction_reason: "扣分原因",
          improvement_suggestion: "改进建议",
        },
      },
    ],
    hard_gate_candidates: [
      {
        gate_id: "G1 | G2 | G3 | G4",
        triggered: false,
        reason: "中文说明",
        confidence: "high | medium | low",
      },
    ],
    risks: [
      {
        level: "low | medium | high",
        title: "风险标题",
        description: "风险描述",
        evidence: "证据摘要",
      },
    ],
    strengths: ["优势"],
    main_issues: ["主要问题"],
  };
}

function strictOutputInstructions(): string[] {
  return [
    "强制输出格式:",
    "- 最终答案的第一个非空字符必须是 {。",
    "- 最后一个非空字符必须是 }。",
    "- 不要输出分析过程、评分步骤、说明文字、Markdown、代码块或自然语言前后缀。",
    "- 不要输出自然语言前后缀；不要写“以下是 JSON”。",
    "- 必须直接按“正确输出格式”输出 JSON object。",
    "- 输出前必须自检 JSON 语法：所有 { }、[ ] 成对闭合，所有字符串使用双引号，所有数组元素和对象字段之间用逗号分隔。",
    "- item_scores 是数组；每个 item_scores 条目必须先闭合自身对象，再输出下一个条目或闭合 item_scores 数组。",
    "- deduction_trace 是对象；如果输出 deduction_trace，必须先闭合 deduction_trace 对象，再闭合当前 item_scores 条目对象。",
    "正确输出格式:",
    stringifyForPrompt(rubricOutputFormat()),
  ];
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

function compactRubricRetryPayload(payload: RubricScoringPayload): Record<string, unknown> {
  return {
    case_id: payload.case_context.case_id,
    task_type: payload.case_context.task_type,
    task_understanding: payload.task_understanding,
    rubric_items: payload.rubric_summary.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => ({
        dimension_name: dimension.name,
        item_name: item.name,
        max_score: item.weight,
        allowed_scores: item.scoring_bands.map((band) => band.score),
      })),
    ),
    hard_gate_ids: payload.rubric_summary.hard_gates.map((gate) => gate.id),
    initial_target_files: (payload.initial_target_files ?? []).slice(0, 20),
  };
}

function renderRubricScoringRetryPrompt(input: {
  scoringPayload: RubricScoringPayload;
  retryContext: { failureReason: string; rawText: string };
}): string {
  return [
    "你是评分流程中的 rubric 评分 agent。本次是重试，只修正最终 JSON 输出格式。",
    `上一次失败原因: ${summarizeRetryFailureReason(input.retryContext.failureReason)}`,
    "",
    "输入边界（必须遵守）:",
    "- 不要重新读取原始 prompt、rubric 全量说明或大段上下文。",
    "- 不要输出分析过程、评分步骤、Markdown、代码块或自然语言前后缀。",
    "- 只根据 rubric_retry_payload 覆盖所有评分项。",
    "",
    "任务:",
    "1. 输出一个合法 JSON object。",
    "2. item_scores 必须覆盖 rubric_retry_payload.rubric_items 中每个 dimension_name + item_name，不能新增、遗漏或重复。",
    "3. 每个 score 必须来自对应 allowed_scores；matched_band_score 必须与 score 相同；max_score 必须等于 max_score。",
    "4. 对扣分项必须提供 deduction_trace。",
    "5. evidence_used 只能填写 sandbox 相对路径。",
    "6. risks 必须是 array；其中每一项必须且只能包含 level、title、description、evidence 四个 string 字段。",
    "7. 禁止在 risks 中使用 risk_level、message、reason 等自造字段；如果没有风险，risks 必须输出空数组 []。",
    "",
    "最终输出要求:",
    "- 只输出一个 JSON object，不要 Markdown，不要解释文字。",
    "- 只输出下方结构中列出的字段。",
    "- JSON 字段必须完全符合下面结构，不能增加额外字段。",
    ...strictOutputInstructions(),
    "",
    "rubric_retry_payload:",
    stringifyForPrompt(compactRubricRetryPayload(input.scoringPayload)),
  ].join("\n");
}

function renderRubricScoringPrompt(input: {
  sandboxRoot: string;
  scoringPayload: RubricScoringPayload;
  retryContext?: { failureReason: string; rawText: string };
}): string {
  const payload = input.scoringPayload;
  if (input.retryContext) {
    return renderRubricScoringRetryPrompt({
      scoringPayload: input.scoringPayload,
      retryContext: input.retryContext,
    });
  }
  return [
    "你是评分流程中的 rubric 评分 agent。只能阅读当前 sandbox 目录内的文件，不能修改文件，不能运行命令，不能访问网络。",
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
    "1. 按 rubric_summary 中的每个维度和评分项完成评分。",
    "2. 必须覆盖 rubric_summary.dimension_summaries 中的每一个 item，不能新增、遗漏或重复。",
    "3. 每个 item 的 score 必须等于该 item 声明的某个 scoring_bands.score，matched_band_score 必须与 score 相同，max_score 必须等于 item weight。",
    "4. 对扣分项必须提供 deduction_trace，说明未命中更高档、命中当前档、扣分原因和改进建议。",
    "5. evidence_used 只能填写 sandbox 内相对路径，例如 generated/、original/、patch/、metadata/、references/ 下的路径。",
    "",
    "最终输出要求:",
    "- 只输出一个 JSON object，不要 Markdown，不要解释文字。",
    "- 只输出下方结构中列出的字段。",
    "- JSON 字段必须完全符合下面结构，不能增加额外字段。",
    ...strictOutputInstructions(),
    "",
    "scoring_payload:",
    stringifyForPrompt({
      case_context: payload.case_context,
      task_understanding: payload.task_understanding,
      rubric_summary: payload.rubric_summary,
      initial_target_files: payload.initial_target_files,
      workspace_project_structure: payload.workspace_project_structure,
      workspace_project_structure_note: payload.workspace_project_structure_note,
    }),
  ].join("\n");
}

function schemaFailureMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function itemKey(dimensionName: string, itemName: string): string {
  return `${dimensionName}::${itemName}`;
}

function hasValidDeductionTrace(item: RubricScoringResult["item_scores"][number]): boolean {
  if (item.score >= item.max_score) {
    return true;
  }
  const trace = item.deduction_trace;
  return Boolean(
    trace &&
      trace.code_locations.length > 0 &&
      trace.rubric_comparison.includes("未命中") &&
      trace.rubric_comparison.includes("命中当前档") &&
      trace.improvement_suggestion.trim().length > 0,
  );
}

function validateRubricCoverage(
  finalAnswer: RubricScoringResult,
  rubricSnapshot: LoadedRubricSnapshot,
): { ok: boolean; failureReason?: string } {
  const expected = new Map(
    rubricSnapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map(
        (item) =>
          [
            itemKey(dimension.name, item.name),
            { weight: item.weight, scores: new Set(item.scoring_bands.map((band) => band.score)) },
          ] as const,
      ),
    ),
  );
  const expectedKeys = Array.from(expected.keys());
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();
  const invalidBand = new Set<string>();
  const invalidWeight = new Set<string>();
  const invalidDeductionTrace = new Set<string>();

  for (const item of finalAnswer.item_scores) {
    const key = itemKey(item.dimension_name, item.item_name);
    const expectedItem = expected.get(key);
    if (seen.has(key)) {
      duplicate.add(key);
    }
    seen.add(key);
    if (!expectedItem) {
      unexpected.add(key);
      continue;
    }
    if (item.max_score !== expectedItem.weight) {
      invalidWeight.add(key);
    }
    if (!expectedItem.scores.has(item.score) || item.matched_band_score !== item.score) {
      invalidBand.add(key);
    }
    if (!hasValidDeductionTrace(item)) {
      invalidDeductionTrace.add(key);
    }
  }

  const missing = expectedKeys.filter((key) => !seen.has(key));
  const parts = [
    missing.length > 0 ? `missing=${missing.join(",")}` : "",
    duplicate.size > 0 ? `duplicate=${Array.from(duplicate).join(",")}` : "",
    unexpected.size > 0 ? `unexpected=${Array.from(unexpected).join(",")}` : "",
    invalidBand.size > 0 ? `invalid_band=${Array.from(invalidBand).join(",")}` : "",
    invalidWeight.size > 0 ? `invalid_weight=${Array.from(invalidWeight).join(",")}` : "",
    invalidDeductionTrace.size > 0
      ? `invalid_deduction_trace=${Array.from(invalidDeductionTrace).join(",")}`
      : "",
  ].filter(Boolean);
  return parts.length > 0 ? { ok: false, failureReason: parts.join("; ") } : { ok: true };
}

function parseRubricRunResult(
  runResult: OpencodeRunResult,
  rubricSnapshot: LoadedRubricSnapshot,
): OpencodeRubricScoringResult {
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

  const parsed = opencodeRubricScoringSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      outcome: "protocol_error",
      final_answer_raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
      failure_reason: schemaFailureMessage(parsed.error),
    };
  }

  const finalAnswer: RubricScoringResult = parsed.data;
  const validation = validateRubricCoverage(finalAnswer, rubricSnapshot);
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

export async function runOpencodeRubricScoring(
  input: OpencodeRubricScoringInput,
): Promise<OpencodeRubricScoringResult> {
  const requestTag = buildOpencodeRequestTag({
    prefix: "rubric-scoring",
    caseId: input.scoringPayload.case_context.case_id,
    sandboxRoot: input.sandboxRoot,
  });

  async function runOnce(inputRequestTag: string, retryContext?: { failureReason: string; rawText: string }) {
    return input.runPrompt({
      prompt: renderRubricScoringPrompt({
        sandboxRoot: input.sandboxRoot,
        scoringPayload: input.scoringPayload,
        retryContext,
      }),
      sandboxRoot: input.sandboxRoot,
      requestTag: inputRequestTag,
      title: inputRequestTag,
    });
  }

  let runResult: OpencodeRunResult;

  try {
    runResult = await runOnce(requestTag);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await input.logger?.warn?.(`opencode rubric scoring request failed: ${failureReason}`);
    try {
      const retryRunResult = await runOnce(`${requestTag}-retry-1`, {
        failureReason,
        rawText: "",
      });
      return parseRubricRunResult(retryRunResult, input.scoringPayload.rubric_summary);
    } catch (retryError) {
      const retryFailureReason = retryError instanceof Error ? retryError.message : String(retryError);
      await input.logger?.warn?.(`opencode rubric scoring retry request failed: ${retryFailureReason}`);
      return {
        outcome: "request_failed",
        failure_reason: retryFailureReason,
      };
    }
  }

  const firstParseResult = parseRubricRunResult(runResult, input.scoringPayload.rubric_summary);
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
    await input.logger?.warn?.(`opencode rubric scoring retry request failed: ${failureReason}`);
    return {
      outcome: "request_failed",
      failure_reason: failureReason,
    };
  }

  return parseRubricRunResult(retryRunResult, input.scoringPayload.rubric_summary);
}
