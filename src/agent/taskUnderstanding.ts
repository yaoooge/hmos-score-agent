import { z } from "zod";
import type { ConstraintSummary, TaskUnderstandingAgentInput } from "../types.js";

const constraintSummarySchema = z
  .object({
    explicitConstraints: z.array(z.string().min(1)),
    contextualConstraints: z.array(z.string().min(1)),
    implicitConstraints: z.array(z.string().min(1)),
    classificationHints: z.array(z.string().min(1)),
  })
  .strict();

function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("Agent 输出不包含 JSON object。");
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

function normalizeArray(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

export function parseConstraintSummary(rawOutputText: string): ConstraintSummary {
  const parsed = constraintSummarySchema.parse(extractJsonObject(rawOutputText));
  return {
    explicitConstraints: normalizeArray(parsed.explicitConstraints, 12),
    contextualConstraints: normalizeArray(parsed.contextualConstraints, 16),
    implicitConstraints: normalizeArray(parsed.implicitConstraints, 16),
    classificationHints: normalizeArray(parsed.classificationHints, 8),
  };
}

export function buildFallbackConstraintSummary(
  input: TaskUnderstandingAgentInput,
): ConstraintSummary {
  const prompt = input.promptText.toLowerCase();
  const prefersFullGeneration = input.originalProjectProvided === false;
  const explicitConstraints = [
    prefersFullGeneration
      ? "任务类型: 倾向 full_generation"
      : prompt.includes("bug") || input.patchSummary.hasPatch
      ? "任务类型: 倾向 bug_fix 或 continuation"
      : "任务类型: 倾向 full_generation",
    `目标: ${input.promptText.slice(0, 120) || "原始 prompt 未提供明确目标"}`,
  ];

  const contextualConstraints = [
    input.projectStructure.modulePaths.length > 0
      ? `原始模块: ${input.projectStructure.modulePaths.join(", ")}`
      : "原始模块: 未从工程结构中识别到 HarmonyOS 模块",
    ...input.projectStructure.implementationHints,
  ];

  const implicitConstraints = input.patchSummary.hasPatch
    ? [
        `修改范围: ${input.patchSummary.changedFiles.length} 个文件`,
        `侵入程度: ${input.patchSummary.intrusionLevel}`,
        `改动规模: +${input.patchSummary.addedLines}/-${input.patchSummary.deletedLines}`,
        `改动类型: ${input.patchSummary.changeTypes.join(", ") || "modified"}`,
      ]
    : ["修改范围: 未提供 patch", "侵入程度: none", "改动类型: 待从生成工程对比确认"];

  const classificationHints = [
    input.patchSummary.hasPatch ? "has_patch" : "no_patch",
    prefersFullGeneration
      ? "full_generation"
      : prompt.includes("bug")
      ? "bug_fix"
      : input.patchSummary.hasPatch
        ? "continuation"
        : "full_generation",
  ];

  return {
    explicitConstraints: normalizeArray(explicitConstraints, 12),
    contextualConstraints: normalizeArray(contextualConstraints, 16),
    implicitConstraints: normalizeArray(implicitConstraints, 16),
    classificationHints: normalizeArray(classificationHints, 8),
  };
}

export function renderTaskUnderstandingPrompt(input: TaskUnderstandingAgentInput): string {
  return [
    "你是评分工作流中的任务理解节点。请从输入中提取约束摘要，只输出 JSON object。",
    "必须提取以下四组字段：",
    "explicitConstraints: 从 prompt 提取任务类型、行业、场景、目标。",
    "contextualConstraints: 从原始工程结构提取模块、分层、技术栈和实现约束。",
    "implicitConstraints: 从 patch 摘要提取修改范围、侵入程度、改动类型。",
    "classificationHints: 给后续任务分类使用的短标签，例如 full_generation、continuation、bug_fix、has_patch。",
    "所有数组元素必须是中文短句，不要输出空字符串。",
    "顶层只能包含 explicitConstraints、contextualConstraints、implicitConstraints、classificationHints。",
    "不要使用 markdown 代码块，不要输出额外解释。",
    "输入：",
    JSON.stringify(input, null, 2),
  ].join("\n");
}
