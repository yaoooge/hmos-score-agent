export interface SupportedRuleMapping {
  ruleId: string;
  pattern: RegExp;
  summary: string;
}

export const supportedTextRules: SupportedRuleMapping[] = [
  {
    ruleId: "ARKTS-MUST-003",
    pattern: /#\w+/,
    summary: "检测到不支持的 #private 字段语法。",
  },
  {
    ruleId: "ARKTS-MUST-005",
    pattern: /\bvar\b/,
    summary: "检测到被禁止的 var 声明。",
  },
  {
    ruleId: "ARKTS-MUST-006",
    pattern: /:\s*(any|unknown)\b|\b(as\s+any|as\s+unknown)\b/,
    summary: "检测到被禁止的 any/unknown 类型用法。",
  },
  {
    ruleId: "ARKTS-FORBIDDEN-REACT-001",
    pattern: /\bfrom\s+['"]react['"]|<div>|useState\(/,
    summary: "检测到与 ArkTS/HarmonyOS 不兼容的 React/Web 模式。",
  },
];
