import fs from "node:fs/promises";
import { ScoreGraphState } from "../workflow/state.js";

export async function taskUnderstandingNode(state: ScoreGraphState): Promise<Partial<ScoreGraphState>> {
  const prompt = state.caseInput.promptText;
  const patchText = state.caseInput.patchPath
    ? await fs.readFile(state.caseInput.patchPath, "utf-8").catch(() => "")
    : "";

  const explicitConstraints = [
    prompt.includes("bug") ? "可能是缺陷修复任务" : "可能是功能开发任务",
    prompt.includes("餐厅") ? "场景可能为餐饮" : "行业场景待确认",
  ];
  const contextualConstraints = ["需遵循原工程目录结构", "需保持 ArkTS/HarmonyOS 风格一致性"];
  const implicitConstraints = [
    patchText ? `存在 patch，长度 ${patchText.length}` : "缺少 patch，后续以目录差异为主",
  ];
  const classificationHints = [
    patchText ? "更偏 continuation 或 bug_fix" : "更偏 full_generation",
  ];

  return {
    constraintSummary: { explicitConstraints, contextualConstraints, implicitConstraints, classificationHints },
  };
}
