import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createPendingRule, createTextRule } from "../shared/ruleFactories.js";

export const arktsPerformanceShouldRules: RegisteredRule[] = [
  createPendingRule("arkts-performance", "should_rule", "ARKTS-PERF-SHOULD-001", "不变变量推荐使用 const 声明。"),
  createTextRule("arkts-performance", "should_rule", "ARKTS-PERF-SHOULD-002", "number 类型变量初始化后应避免整型与浮点型混用。", [
    "\\blet\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\d+\\s*;[\\s\\S]{0,200}?\\b\\1\\s*=\\s*\\d+\\.\\d+\\b",
    "\\blet\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\d+\\.\\d+\\s*;[\\s\\S]{0,200}?\\b\\1\\s*=\\s*\\d+\\b",
  ]),
  createPendingRule("arkts-performance", "should_rule", "ARKTS-PERF-SHOULD-003", "数值计算应避免溢出到 INT32 范围外。"),
  createPendingRule("arkts-performance", "should_rule", "ARKTS-PERF-SHOULD-004", "循环中应提取不变量，减少重复属性访问次数。"),
  createPendingRule("arkts-performance", "should_rule", "ARKTS-PERF-SHOULD-005", "性能敏感场景中建议通过参数传递替代闭包捕获函数外变量。"),
  createPendingRule("arkts-performance", "should_rule", "ARKTS-PERF-SHOULD-006", "涉及纯数值计算时推荐使用 TypedArray。"),
];
