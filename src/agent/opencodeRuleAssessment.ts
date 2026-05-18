import { z } from "zod";
import { extractFinalJsonObject } from "../opencode/finalJson.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../opencode/opencodeCliRunner.js";
import type { AgentAssistedRuleResult, AgentBootstrapPayload, AssistedRuleCandidate } from "../types.js";
import { booleanLikeSchema } from "./agentOutputNormalization.js";
import { buildOpencodeRequestTag } from "./opencodeRequestTag.js";

const opencodeRuleAssessmentSchema = z
  .object({
    summary: z
      .object({
        assistant_scope: z.string().min(1),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strip(),
    rule_assessments: z
      .array(
        z
          .object({
            rule_id: z.string().min(1),
            decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
            confidence: z.enum(["high", "medium", "low"]),
            reason: z.string().min(1),
            evidence_used: z.array(z.string()),
            needs_human_review: booleanLikeSchema,
          })
          .strip(),
      ),
  })
  .strip();

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

const MAX_RULE_REPRESENTATIVE_FILES = 5;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function pickRepresentativeFiles(input: {
  evidenceFiles: string[];
  targetFiles: string[];
  matchedFiles: string[];
}): string[] {
  return uniqueStrings([...input.matchedFiles, ...input.evidenceFiles, ...input.targetFiles]).slice(
    0,
    MAX_RULE_REPRESENTATIVE_FILES,
  );
}

function trimExpectedOutputFromPromptSummary(summary: string): string {
  return summary.replace(/\n{0,2}(?:期望输出|Expected\s+Output)\s*[：:][\s\S]*$/iu, "").trim();
}

function compactRuleAssessmentPayload(payload: AgentBootstrapPayload): Record<string, unknown> {
  return {
    case_context: {
      ...payload.case_context,
      original_prompt_summary: trimExpectedOutputFromPromptSummary(
        payload.case_context.original_prompt_summary,
      ),
    },
    task_understanding: payload.task_understanding,
    assisted_rule_candidates: payload.assisted_rule_candidates.map((candidate) => {
      const { evidence_snippets: _evidenceSnippets, ...candidateWithoutSnippets } = candidate;
      if (!candidate.is_case_rule) {
        return candidateWithoutSnippets;
      }

      const {
        evidence_files: evidenceFiles,
        static_precheck: staticPrecheck,
        ...caseCandidate
      } = candidateWithoutSnippets;
      const targetFiles = staticPrecheck?.target_files ?? [];
      const matchedFiles = staticPrecheck?.matched_files ?? [];
      const compactStaticPrecheck = staticPrecheck
        ? (() => {
            const {
              target_files: _targetFiles,
              matched_files: _matchedFiles,
              ...restStaticPrecheck
            } = staticPrecheck;
            return restStaticPrecheck;
          })()
        : undefined;
      const allTargetFiles = uniqueStrings([...evidenceFiles, ...targetFiles]);
      return {
        ...caseCandidate,
        static_precheck: compactStaticPrecheck
          ? {
              ...compactStaticPrecheck,
              target_file_count: allTargetFiles.length,
              representative_files: pickRepresentativeFiles({
                evidenceFiles,
                targetFiles,
                matchedFiles,
              }),
            }
          : undefined,
      };
    }),
  };
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
    "- 只修复 listed protocol errors；但若任一已有 rule 判断的 reason 与该 rule_id 的候选规则语义不相关，必须按 hmos-rule-assessment skill 重新判定该 rule_id。",
    "- 相关性修正不视为违规重判。禁止改变与 listed protocol errors 无关且结论相关的 rule 判断。",
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
  const hasPreviousOutput = input.retryContext.rawText.trim().length > 0;
  return [
    "你是评分流程中的规则判定 agent。本次是重试，只修正最终 JSON 输出格式。",
    "本次是重试。仍必须使用 hmos-rule-assessment skill，但只修复 listed protocol errors，不重新判定。",
    "该 skill 中的输出契约和自检清单是本次输出的强制要求。",
    `上一次失败原因: ${summarizeRetryFailureReason(input.retryContext.failureReason)}`,
    "",
    "输入边界（必须遵守）:",
    "- 不要重新读取原始 prompt、rubric 全量内容或大段上下文。",
    "- 不要输出分析过程、Markdown、代码块或自然语言前后缀。",
    ...(hasPreviousOutput
      ? ["- 先读取并修改已有 output_file，保留上一轮已完成且与候选规则相关的 rule_assessments。"]
      : []),
    "- 只根据 candidate_rule_ids 覆盖所有候选 rule_id。",
    ...retryFailureGuidance(input.retryContext.failureReason),
    "- JSON 字符串中的英文双引号必须转义；如果必须引用原文，先改写为不含双引号的中文转述再写入字段。",
    "",
    "任务:",
    hasPreviousOutput ? "1. 在已有 output_file 内容基础上输出一个合法 JSON object。" : "1. 输出一个合法 JSON object。",
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
    "执行任务前必须使用 hmos-rule-assessment skill。该 skill 中的输出契约和自检清单是本次输出的强制要求。",
    "",
    `Sandbox 根目录: ${input.sandboxRoot}`,
    "可阅读目录约定:",
    "- generated/: 待评分的生成结果代码。",
    "- original/: 原始工程代码；如果不存在，说明本用例没有提供原始工程。",
    "- patch/: 生成结果相对原始工程的补丁，优先查看 patch/effective.patch。",
    "- metadata/: 用例元数据。",
    "",
    "任务:",
    "1. 阅读 bootstrap_payload 中的候选规则和任务理解。",
    "2. 优先阅读 patch/effective.patch，只基于 patch 内可见文件完成每条候选规则的判定；根据 patch 中出现的文件路径继续阅读相关 generated/ 或 original/ 上下文辅助理解。",
    "3. 必须覆盖 assisted_rule_candidates 中的每一个 rule_id，不能新增、遗漏或重复 rule_id。",
    "4. 无法确认时使用 decision=\"uncertain\"，并设置 needs_human_review=true。",
    "5. 未接入静态判定器本身不是人工复核理由；它只表示该候选规则需要你阅读 patch/generated/original 后做语义判定。",
    "6. 新增代码未发现该规则相关问题时，必须输出 decision=\"pass\" 且 needs_human_review=false，不要因为 local_preliminary_signal 或 why_uncertain 包含“未接入静态判定器”而输出 uncertain。",
    "7. 同一候选规则包含多个 target_checks 时，必须逐个 target 审视对应文件和 llm_prompt，再汇总为该 rule_id 的最终判定。",
    "8. 候选规则包含 kit 时，必须重点核查指定 Kit 的导入、声明、权限、生命周期和 API 使用是否与规则要求一致。",
    "9. evidence_used 只能填写 sandbox 内文件相对路径，不要带行号，例如 generated/、original/、patch/、metadata/ 下的路径。",
    "10. 如果在 reason 中输出带行号的代码证据，必须使用 generated/ 工程文件中的真实行号；patch 只能用于定位变更，禁止使用 patch hunk 行号作为证据行号。",
    "11. 每条 reason 必须直接回答该 rule_id 的 rule_summary/llm_prompt，且至少围绕规则文本中的核心对象、API、组件、场景或适用条件展开；禁止用通用工程质量、代码规模、复杂度、配置完整性等内容替代规则判断。",
    "12. 若规则要求某 API/Kit/场景但工程不涉及，必须说明不涉及该 API/Kit/场景的证据；不能转而评价其他无关问题。",
    "13. 输出前按 hmos-rule-assessment skill 自检结论相关性；发现不相关时重新判定对应 rule_id，无法给出相关依据时输出 decision=\"uncertain\" 且 needs_human_review=true。",
    "14. JSON 字符串中的英文双引号必须转义；如果必须引用原文，先改写为不含双引号的中文转述再写入字段。",
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
    stringifyForPrompt(compactRuleAssessmentPayload(payload)),
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
  const seen = new Set<string>();

  for (const assessment of finalAnswer.rule_assessments) {
    seen.add(assessment.rule_id);
  }

  const missing = expectedRuleIds.filter((ruleId) => !seen.has(ruleId));
  return missing.length > 0 ? { ok: false, failureReason: `missing=${missing.join(",")}` } : { ok: true };
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
      if (!assessment) {
        throw new Error(`internal rule coverage validation missed missing=${candidate.rule_id}`);
      }
      return {
        ...assessment,
        rule_id: candidate.rule_id,
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

  const validation = validateRuleCoverage(parsed.data, candidates);
  if (!validation.ok) {
    return {
      outcome: "protocol_error",
      final_answer_raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
      failure_reason: validation.failureReason,
    };
  }

  const finalAnswer = normalizeRuleAssessmentResult(parsed.data, candidates);
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
    const preserveOutputFileOnStart =
      retryContext && retryContext.rawText.trim().length > 0 ? true : undefined;
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
      preserveOutputFileOnStart,
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
