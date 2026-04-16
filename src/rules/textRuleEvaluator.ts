import { RuleAuditResult } from "../types.js";
import { CollectedEvidence } from "./evidenceCollector.js";
import { supportedTextRules } from "./ruleMapping.js";

// 评估结果在 `RuleAuditResult` 上补充了“是否已支持”和命中文件，便于后续生成 violation。
export interface EvaluatedRule extends RuleAuditResult {
  supported: boolean;
  matchedFiles: string[];
}

export function evaluateTextRule(
  ruleId: string,
  ruleSource: RuleAuditResult["rule_source"],
  evidence: CollectedEvidence,
): EvaluatedRule {
  const mapping = supportedTextRules.find((item) => item.ruleId === ruleId);
  if (!mapping) {
    // 未支持的规则明确回传“不涉及”，避免假装已经自动判断。
    return {
      rule_id: ruleId,
      rule_source: ruleSource,
      result: "不涉及",
      conclusion: "当前版本未接入对应判定器。",
      supported: false,
      matchedFiles: [],
    };
  }

  const matchedFiles = evidence.workspaceFiles
    .filter((file) => mapping.pattern.test(file.content))
    .map((file) => file.relativePath);

  return {
    rule_id: ruleId,
    rule_source: ruleSource,
    result: matchedFiles.length > 0 ? "不满足" : "满足",
    conclusion: matchedFiles.length > 0 ? `${mapping.summary} 检测到规则命中，文件：${matchedFiles.join(", ")}` : "未发现该规则的命中证据。",
    supported: true,
    matchedFiles,
  };
}
