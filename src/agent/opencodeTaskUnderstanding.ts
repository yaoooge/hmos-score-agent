import { extractFinalJsonObject } from "../opencode/finalJson.js";
import type { OpencodeRunRequest, OpencodeRunResult } from "../opencode/opencodeCliRunner.js";
import type { ConstraintSummary, TaskUnderstandingAgentInput } from "../types.js";
import { buildOpencodeRequestTag } from "./opencodeRequestTag.js";
import { parseConstraintSummary } from "./taskUnderstanding.js";

export type OpencodeTaskUnderstandingOutcome = "success" | "request_failed" | "protocol_error";

export interface OpencodeTaskUnderstandingResult {
  outcome: OpencodeTaskUnderstandingOutcome;
  summary?: ConstraintSummary;
  raw_text?: string;
  raw_events?: string;
  failure_reason?: string;
}

export interface OpencodeTaskUnderstandingInput {
  sandboxRoot: string;
  agentInput: TaskUnderstandingAgentInput;
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

function taskUnderstandingOutputFormat(): Record<string, unknown> {
  return {
    explicitConstraints: ["中文短句：从 prompt 提取任务类型、场景、目标和明确要求"],
    contextualConstraints: ["中文短句：从工程结构和相关代码提取模块、分层、技术栈和实现边界"],
    implicitConstraints: ["中文短句：从 patch 和上下文提取修改范围、侵入程度、改动类型和隐含风险"],
    classificationHints: ["full_generation | continuation | bug_fix | has_patch 等短标签"],
  };
}

function strictOutputInstructions(): string[] {
  return [
    "强制输出格式:",
    "- 最终答案的第一个非空字符必须是 {。",
    "- 最后一个非空字符必须是 }。",
    "- 不要输出分析过程、说明文字、Markdown、代码块或自然语言前后缀。",
    "- 不要写“以下是 JSON”。",
    "- 必须直接按“正确输出格式”输出 JSON object。",
    "正确输出格式:",
    stringifyForPrompt(taskUnderstandingOutputFormat()),
  ];
}

function uniqueShortList(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function buildRetryConstraintDraft(input: TaskUnderstandingAgentInput): ConstraintSummary {
  const prefersFullGeneration = input.originalProjectProvided === false;
  return {
    explicitConstraints: uniqueShortList(
      [
        prefersFullGeneration
          ? "任务类型: 倾向 full_generation"
          : input.patchSummary.hasPatch
            ? "任务类型: 倾向 continuation 或 bug_fix"
            : "任务类型: 倾向 full_generation",
        "原始需求: 重试阶段已省略，按首轮预处理摘要输出约束",
      ],
      12,
    ),
    contextualConstraints: uniqueShortList(
      [
        input.projectStructure.modulePaths.length > 0
          ? `模块: ${input.projectStructure.modulePaths.join(", ")}`
          : "模块: 未从工程结构中识别到 HarmonyOS 模块",
        ...input.projectStructure.implementationHints,
        input.projectStructure.representativeFiles.length > 0
          ? `代表文件: ${input.projectStructure.representativeFiles.slice(0, 8).join(", ")}`
          : "代表文件: 未提供",
      ],
      16,
    ),
    implicitConstraints: input.patchSummary.hasPatch
      ? uniqueShortList(
          [
            `修改范围: ${input.patchSummary.changedFiles.length} 个文件`,
            `影响根目录: ${input.patchSummary.affectedRoots.join(", ") || "未识别"}`,
            `侵入程度: ${input.patchSummary.intrusionLevel}`,
            `改动规模: +${input.patchSummary.addedLines}/-${input.patchSummary.deletedLines}`,
            `改动类型: ${input.patchSummary.changeTypes.join(", ") || "modified"}`,
          ],
          16,
        )
      : ["修改范围: 未提供 patch", "侵入程度: none", "改动类型: 待从生成工程对比确认"],
    classificationHints: uniqueShortList(
      [
        input.patchSummary.hasPatch ? "has_patch" : "no_patch",
        prefersFullGeneration ? "full_generation" : input.patchSummary.hasPatch ? "continuation" : "full_generation",
      ],
      8,
    ),
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

function renderRetryTaskUnderstandingPrompt(input: {
  sandboxRoot: string;
  agentInput: TaskUnderstandingAgentInput;
  retryContext: { failureReason: string; rawText: string };
}): string {
  const draft = buildRetryConstraintDraft(input.agentInput);
  return [
    "你是评分工作流中的任务理解 agent。任务理解阶段禁止读取任何代码文件，不能修改文件，不能运行命令，不能访问网络。",
    "",
    "上一次任务理解输出无效。不要继续分析原始输入，只修正最终输出格式。",
    `上一次失败原因: ${summarizeRetryFailureReason(input.retryContext.failureReason)}`,
    "输入边界（必须遵守）:",
    "- 本次重试禁止读取任何文件，禁止调用 read、glob、grep、find 或任何工具。",
    "- 本次重试不提供原始 input；不要尝试恢复或引用原始需求全文。",
    "- 只根据 constraint_draft 输出最终 JSON。",
    "",
    "任务:",
    "1. 将 constraint_draft 原样整理为合法 JSON object。",
    "2. 顶层只能包含 explicitConstraints、contextualConstraints、implicitConstraints、classificationHints。",
    "3. 四个字段都必须是中文短句数组，可以包含英文分类标签。",
    "4. 不要补充分析过程，不要输出 Markdown，不要输出工具调用意图。",
    "",
    "最终输出要求:",
    "- 只输出一个 JSON object，不要 Markdown，不要解释文字。",
    ...strictOutputInstructions(),
    "",
    "constraint_draft:",
    stringifyForPrompt(draft),
  ].join("\n");
}

function renderTaskUnderstandingPrompt(input: {
  sandboxRoot: string;
  agentInput: TaskUnderstandingAgentInput;
  retryContext?: { failureReason: string; rawText: string };
}): string {
  if (input.retryContext) {
    return renderRetryTaskUnderstandingPrompt({
      sandboxRoot: input.sandboxRoot,
      agentInput: input.agentInput,
      retryContext: input.retryContext,
    });
  }
  return [
    "你是评分工作流中的任务理解 agent。任务理解阶段禁止读取任何代码文件，不能修改文件，不能运行命令，不能访问网络。",
    "",
    `Sandbox 根目录: ${input.sandboxRoot}`,
    "输入边界（必须遵守）:",
    "- 只能基于本 prompt 中的 agent_input 完成任务理解。",
    "- 不要调用 read、glob、grep、find 或任何工具。",
    "- 不要读取 generated/、original/ 或 references/ 下的任何文件。",
    "- 不要读取 patch/effective.patch 或 metadata/metadata.json；这些信息已被预处理进 agent_input。",
    "- 如果 agent_input 信息不足，基于 promptText、projectStructure、patchSummary 给出低置信度约束，不要尝试补充读取。",
    "- 本次重试禁止读取任何文件；首轮也同样禁止读取任何文件。",
    "",
    "任务:",
    "1. 结合 agent_input 中的 promptText、工程结构和补丁摘要，提取任务约束摘要。",
    "2. explicitConstraints: 从 prompt 提取任务类型、场景、目标和明确要求。",
    "3. contextualConstraints: 从 projectStructure、implementationHints、modulePaths、representativeFiles 提取模块、分层、技术栈和实现边界。",
    "4. implicitConstraints: 从 patchSummary 提取修改范围、侵入程度、改动类型和隐含风险。",
    "5. classificationHints: 给后续任务分类使用的短标签，例如 full_generation、continuation、bug_fix、has_patch。",
    "",
    "最终输出要求:",
    "- 只输出一个 JSON object，不要 Markdown，不要解释文字。",
    "- 顶层只能包含 explicitConstraints、contextualConstraints、implicitConstraints、classificationHints。",
    "- 四个字段都必须是中文短句数组，可以包含英文分类标签。",
    ...strictOutputInstructions(),
    "",
    "agent_input:",
    stringifyForPrompt(input.agentInput),
  ].join("\n");
}

function parseTaskUnderstandingRunResult(runResult: OpencodeRunResult): OpencodeTaskUnderstandingResult {
  try {
    const parsedJson = extractFinalJsonObject(runResult.rawText);
    const summary = parseConstraintSummary(JSON.stringify(parsedJson));
    return {
      outcome: "success",
      summary,
      raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
    };
  } catch (error) {
    return {
      outcome: "protocol_error",
      raw_text: runResult.rawText,
      raw_events: runResult.rawEvents,
      failure_reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runOpencodeTaskUnderstanding(
  input: OpencodeTaskUnderstandingInput,
): Promise<OpencodeTaskUnderstandingResult> {
  const requestTag = buildOpencodeRequestTag({
    prefix: "task-understanding",
    caseId: input.agentInput.caseId,
    sandboxRoot: input.sandboxRoot,
  });

  async function runOnce(inputRequestTag: string, retryContext?: { failureReason: string; rawText: string }) {
    return input.runPrompt({
      prompt: renderTaskUnderstandingPrompt({
        sandboxRoot: input.sandboxRoot,
        agentInput: input.agentInput,
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
    await input.logger?.warn?.(`opencode task understanding request failed: ${failureReason}`);
    try {
      const retryRunResult = await runOnce(`${requestTag}-retry-1`, {
        failureReason,
        rawText: "",
      });
      return parseTaskUnderstandingRunResult(retryRunResult);
    } catch (retryError) {
      const retryFailureReason = retryError instanceof Error ? retryError.message : String(retryError);
      await input.logger?.warn?.(`opencode task understanding retry request failed: ${retryFailureReason}`);
      return {
        outcome: "request_failed",
        failure_reason: retryFailureReason,
      };
    }
  }

  const firstParseResult = parseTaskUnderstandingRunResult(runResult);
  if (firstParseResult.outcome !== "protocol_error") {
    return firstParseResult;
  }

  let retryRunResult: OpencodeRunResult;
  try {
    retryRunResult = await runOnce(`${requestTag}-retry-1`, {
      failureReason: firstParseResult.failure_reason ?? "unknown protocol error",
      rawText: firstParseResult.raw_text ?? "",
    });
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    await input.logger?.warn?.(`opencode task understanding retry request failed: ${failureReason}`);
    return {
      outcome: "request_failed",
      failure_reason: failureReason,
    };
  }

  return parseTaskUnderstandingRunResult(retryRunResult);
}
