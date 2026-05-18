export interface RulePackYamlMetadata {
  name: string;
  version: string;
  summary: string;
  source_name: string;
  source_version: string;
}

export const rulePackYamlMetadataByPackId: Record<string, RulePackYamlMetadata> = {
  "arkts-language": {
    name: "ArkTS TypeScript 适配与编程规范融合规则包",
    version: "v1.0.0",
    summary:
      "基于《从TypeScript到ArkTS的适配规则》与《ArkTS编程规范》融合提炼的内部规则包，按 must / should / forbidden 分类，用于 HarmonyOS NEXT 生成代码评分与审查。",
    source_name: "Huawei-ArkTS-TypeScript-Adaptation-Guide-and-Programming-Guide",
    source_version: "merged-html-and-v1-rules-2026-04-08",
  },
  "arkts-performance": {
    name: "ArkTS 高性能编程实践规则包",
    version: "v1.0.0",
    summary:
      "基于 ArkTS 高性能编程实践规则整理的内部规则包，按 should / forbidden 分类，用于识别 HarmonyOS NEXT 生成代码中的常见性能风险。",
    source_name: "Huawei-ArkTS-High-Performance-Programming-Practices",
    source_version: "performance-rules-2026-04-17",
  },
  "cross-device-adaptation": {
    name: "HarmonyOS 一多适配通用规则包",
    version: "v1.0.0",
    summary:
      "基于一多适配通用规则整理的内部条件规则包，仅在任务理解判定涉及一多适配时启用。",
    source_name: "HarmonyOS-Cross-Device-Adaptation-General-Rules",
    source_version: "general-rules-2026-05-15",
  },
};
