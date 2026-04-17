import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createPendingRule, createTextRule } from "../shared/ruleFactories.js";

export const arktsForbiddenRules: RegisteredRule[] = [
  createTextRule("forbidden_pattern", "ARKTS-FORBID-001", "禁止使用 any、unknown、@ts-ignore、@ts-nocheck 或 as any 等弱类型逃逸手段。", [":\\s*(any|unknown)\\b|\\b(as\\s+any|as\\s+unknown)\\b|@ts-ignore|@ts-nocheck"]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-002", "禁止动态添加或删除对象属性、依赖 prototype 赋值或使用 in 检查成员存在。", ["\\bdelete\\s+[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\[[^\\]]+\\])|\\b[A-Za-z_$][\\w$]*\\.prototype\\s*=|\\bin\\s+['\"]?[A-Za-z_$][\\w$]*['\"]?\\s*\\)"]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-003", "禁止使用数字键、普通字符串键、索引签名、索引访问类型或未声明字段进行对象成员访问。", ["\\[['\"][^'\"]+['\"]\\]|\\[[^\\]]+\\s*:\\s*[^\\]]+\\]\\s*:\\s*[^;={]+;?|type\\s+[A-Za-z_$][\\w$<>,\\s]*=\\s*[A-Za-z_$][\\w$<>]*\\s*\\[\\s*(?:[\"'][^\"']+[\"']|[A-Za-z_$][\\w$]*)\\s*\\]"]),
  createTextRule(
    "forbidden_pattern",
    "ARKTS-FORBID-004",
    "禁止使用 intersection type、conditional type、infer、this 类型和映射/索引访问类高级类型特性。",
    [
      "type\\s+[A-Za-z_$][\\w$<>,\\s]*=\\s*[^;\\n]*&[^;\\n]*;?|\\bextends\\b[^?;\\n]+\\?[^:;\\n]+:[^;\\n]+|\\binfer\\b|(?:type\\s+[A-Za-z_$][\\w$<>,\\s]*=\\s*this\\b|:\\s*this\\b(?=\\s*(?:[,;)=\\{]|$)))|type\\s+[A-Za-z_$][\\w$<>,\\s]*=\\s*[A-Za-z_$][\\w$<>]*\\s*\\[\\s*(?:[\"'][^\"']+[\"']|[A-Za-z_$][\\w$]*)\\s*\\]",
    ],
  ),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-005", "禁止使用 function expression、class expression、嵌套函数声明、generator、独立 this、构造签名或调用签名类型。", ["^\\s*\\([^)]*\\)\\s*:\\s*[^=][^;{]*;?$|^\\s*new\\s*\\([^)]*\\)\\s*:\\s*[^;{]+;?$|=\\s*function\\b|=\\s*class\\b|function\\s*\\*|\\bfunction\\s+\\w+\\([^)]*\\)\\s*\\{[\\s\\S]*\\bfunction\\s+\\w+\\(|\\bfunction\\s+\\w+\\([^)]*\\)\\s*\\{[\\s\\S]*\\bthis\\b"]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-006", "禁止使用解构赋值、解构声明、解构参数、for..in、for 外逗号运算符和 with。", ["\\bfor\\s*\\([^)]*\\bin\\b[^)]*\\)|\\b(?:const|let|var)\\s*[\\[{][^=\\n]*=|\\bwith\\s*\\("]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-007", "禁止抛出 string、number 等非 Error 类型值，或在 catch 中依赖 any/unknown 类型注解。", ["\\bthrow\\s+(?:[\"'`]|[0-9[{]|true\\b|false\\b|null\\b|undefined\\b)|\\bcatch\\s*\\(\\s*[^):]+\\s*:\\s*(?:any|unknown)\\s*\\)"]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-008", "禁止使用 require、UMD、ambient module、模块名通配符、import assertions 或其他 ArkTS 不兼容的模块系统能力。", ["\\brequire\\s*\\(|\\bimport\\s+[A-Za-z_$][\\w$]*\\s*=\\s*|\\bdeclare\\s+module\\b|\\bexport\\s+as\\s+namespace\\b|\\bassert\\s*\\{"]),
  createPendingRule("forbidden_pattern", "ARKTS-FORBID-009", "禁止枚举混用不同值类型、使用运行时表达式初始化枚举、依赖 enum/声明合并或将命名空间作为运行时对象。"),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-010", "禁止使用 eval、__proto__、__defineGetter__、Function.apply、Function.call、new.target 或 as const 等受限能力。", ["\\beval\\s*\\(|\\b__proto__\\b|\\b__defineGetter__\\b|\\b__defineSetter__\\b|\\bFunction\\.(?:apply|call)\\b|\\bnew\\.target\\b|\\bas\\s+const\\b"]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-011", "禁止在 if、while、for 或其他控制性条件表达式中直接进行赋值。", ["\\b(?:if|while|for)\\s*\\([^)]*[^=!<>]=[^=][^)]*\\)"]),
  createTextRule("forbidden_pattern", "ARKTS-FORBID-012", "禁止在 finally 代码块中使用 return、break、continue 或抛出未处理异常。", ["\\bfinally\\s*\\{[\\s\\S]*\\b(?:return|break|continue|throw)\\b"]),
];
