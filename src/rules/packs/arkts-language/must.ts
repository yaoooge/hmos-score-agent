import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createPendingRule, createTextRule } from "../shared/ruleFactories.js";

export const arktsMustRules: RegisteredRule[] = [
  createPendingRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-001",
    "类型、枚举、接口和命名空间名称必须唯一，且不得与变量或函数等标识符冲突。",
  ),
  createTextRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-002",
    "一个类中只允许存在一个 static 初始化块。",
    ["\\bstatic\\s*\\{[\\s\\S]*\\bstatic\\s*\\{"],
  ),
  createPendingRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-003",
    "对无法可靠推断元素类型的数组字面量必须补充显式类型。",
  ),
  createPendingRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-004",
    "implements 只能作用于 interface，extends 必须遵循类继承类、接口继承接口。",
  ),
  createPendingRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-005",
    "限制多态运算符语义，一元运算和 instanceof 需满足 ArkTS 类型约束。",
  ),
  createTextRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-006",
    "只允许抛出 Error 或其派生类实例，catch 参数不得标注 any 或 unknown。",
    [
      "\\bthrow\\s+(?:[\"'`]|[0-9[{]|true\\b|false\\b|null\\b|undefined\\b)|\\bcatch\\s*\\(\\s*[^):]+\\s*:\\s*(?:any|unknown)\\s*\\)",
    ],
  ),
  createPendingRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-007",
    "展开运算符仅允许用于数组、Array 子类和 TypedArray，且仅在受支持场景中使用。",
  ),
  createTextRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-008",
    "多个变量定义和赋值语句不允许写在一行。",
    [
      "\\b(?:let|const|var)\\s+[A-Za-z_$][\\w$]*(?:\\s*:[^=,;\\n]+)?(?:\\s*=\\s*[^,();\\n]+)?,\\s*[A-Za-z_$][\\w$]*(?:\\s*[:=]|[,;])|(?<![!<>=])=(?![=>])[^;\\n]*;[^\\n;]*[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\[[^\\]]+\\])?\\s*(?<![!<>=])=(?![=>])",
    ],
  ),
  createTextRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-009",
    "判断 Number.NaN 时必须使用 Number.isNaN()。",
    ["[!=]==?\\s*(?:Number\\.)?NaN\\b|\\b(?:Number\\.)?NaN\\s*[!=]==?"],
  ),
  createPendingRule(
    "arkts-language",
    "must_rule",
    "ARKTS-MUST-010",
    "对明显仅用于映射、过滤、查找、归约的数组遍历，优先使用 Array 方法。",
  ),
];
