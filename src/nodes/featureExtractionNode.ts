import { ScoreGraphState } from "../workflow/state.js";

export async function featureExtractionNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  const prompt = state.caseInput.promptText;
  return {
    featureExtraction: {
      basicFeatures: [
        prompt.includes("路由") ? "提及路由" : "未直接提及路由",
        "状态管理类型待静态扫描增强",
      ],
      structuralFeatures: ["存在 original/workspace 双工程对照输入"],
      semanticFeatures: ["命名与关键字提取已预留规则接口"],
      changeFeatures: [state.caseInput.patchPath ? "有 patch 可分析最小改动" : "无 patch，需目录对比"],
    },
  };
}
