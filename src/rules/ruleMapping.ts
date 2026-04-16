export interface SupportedRuleMapping {
  ruleId: string;
  pattern: RegExp;
  summary: string;
  // 文本规则当前只面向代码文件，避免资源文件中的色值或二进制噪声造成误报。
  fileExtensions: string[];
}

const arktsExtensions = [".ets"];

export const supportedTextRules: SupportedRuleMapping[] = [
  {
    ruleId: "ARKTS-MUST-003",
    pattern: /(?<![\w"'`])#[_$A-Za-z][\w$]*/,
    summary: "检测到不支持的 #private 字段语法。",
    fileExtensions: arktsExtensions,
  },
  {
    ruleId: "ARKTS-MUST-005",
    pattern: /\bvar\b/,
    summary: "检测到被禁止的 var 声明。",
    fileExtensions: arktsExtensions,
  },
  {
    ruleId: "ARKTS-MUST-006",
    pattern: /:\s*(any|unknown)\b|\b(as\s+any|as\s+unknown)\b/,
    summary: "检测到被禁止的 any/unknown 类型用法。",
    fileExtensions: arktsExtensions,
  },
  {
    ruleId: "ARKTS-FORBIDDEN-REACT-001",
    pattern: /\bfrom\s+['"]react['"]|<div>|useState\(/,
    summary: "检测到与 ArkTS/HarmonyOS 不兼容的 React/Web 模式。",
    fileExtensions: arktsExtensions,
  },
];
