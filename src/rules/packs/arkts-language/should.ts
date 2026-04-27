import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createPendingRule, createTextRule } from "../shared/ruleFactories.js";

export const arktsShouldRules: RegisteredRule[] = [
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-001",
    "应避免依赖全局作用域或 globalThis 传递状态。",
    ["\\bglobalThis\\b"],
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-002",
    "仅在确有跨语言调用需要时使用 ESObject，且优先限制在局部变量场景。",
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-003",
    "不应将 class 当作普通对象值使用。",
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-004",
    "标识符命名应清晰表达意图，避免单字母、非标准缩写和中文拼音。",
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-005",
    "类名、枚举名、命名空间名采用 UpperCamelCase 风格。",
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-006",
    "变量名、方法名、参数名采用 lowerCamelCase 风格。",
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-007",
    "常量名、枚举值名使用全大写并以下划线分隔。",
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-008",
    "布尔变量或方法使用 is/has/can/should 等前缀，避免否定式命名。",
  ),
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-009",
    "使用空格缩进，禁止使用 tab。",
    ["\\t"],
  ),
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-010",
    "条件语句和循环语句建议使用大括号。",
    ["^\\s*(?:if|for|while)\\s*\\((?:[^()]|\\([^()]*\\))*\\)\\s*(?!\\{)\\S"],
  ),
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-011",
    "switch 语句中的 case 和 default 需按层级缩进。",
    [
      "(^[ \\t]*)switch\\b[^\\n]*\\{\\r?\\n\\1(?:case|default)\\b",
      "(^[ \\t]*)(?:case\\b[^\\n]*|default)\\s*:[ \\t]*\\r?\\n\\1\\S",
    ],
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-012",
    "空格应突出关键字和重要信息，避免不必要空格和多个连续空格。",
  ),
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-013",
    "建议字符串统一使用单引号。",
    ['"[^"\\n]*"'],
  ),
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-014",
    "大括号应与控制语句或声明语句位于同一行。",
    [
      "\\b(?:if|for|while|switch|else|catch|class|interface|enum|struct|function)\\b[^\\n{]*\\n\\s*\\{",
    ],
  ),
  createPendingRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-015",
    "建议为class的类属性添加明确的可访问修饰符。",
  ),
  createTextRule(
    "arkts-language",
    "should_rule",
    "ARKTS-SHOULD-016",
    "不建议省略浮点数小数点前后的 0。",
    ["(?<![\\w.])\\.\\d+\\b|\\b\\d+\\.(?!\\d)"],
  ),
];
