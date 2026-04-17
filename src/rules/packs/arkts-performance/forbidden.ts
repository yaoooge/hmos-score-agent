import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createTextRule } from "../shared/ruleFactories.js";

export const arktsPerformanceForbiddenRules: RegisteredRule[] = [
  createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-001",
    "禁止使用可选参数 ? 作为性能敏感函数参数形式。",
    ["\\bfunction\\s+[A-Za-z_$][\\w$]*\\s*\\([^)]*\\?:[^)]*\\)", "\\([^)]*\\?:[^)]*\\)\\s*=>"],
  ),
  createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-002",
    "禁止使用联合类型数组。",
    ["\\([^\\)]*\\|[^\\)]*\\)\\s*\\[\\]", "\\bArray\\s*<[^>]*\\|[^>]*>"],
  ),
  createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-003",
    "禁止在数值数组字面量中混用整型和浮点型。",
    [
      "\\[[^\\]\\n]*\\b\\d+\\.\\d+\\b[^\\]\\n]*\\b\\d+\\b[^\\]\\n]*\\]",
      "\\[[^\\]\\n]*\\b\\d+\\b[^\\]\\n]*\\b\\d+\\.\\d+\\b[^\\]\\n]*\\]",
    ],
  ),
  createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-004",
    "禁止通过超大容量初始化或大跨度下标写入制造稀疏/退化数组。",
    [
      "\\bnew\\s+Array\\s*\\(\\s*(?:102[5-9]|10[3-9]\\d|1[1-9]\\d\\d|[2-9]\\d{3,})\\s*\\)",
      "\\b[A-Za-z_$][\\w$]*\\s*\\[\\s*(?:102[4-9]|10[3-9]\\d|1[1-9]\\d\\d|[2-9]\\d{3,})\\s*\\]\\s*=",
    ],
  ),
  createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-005",
    "禁止在循环等热点路径中直接抛出异常。",
    ["\\b(?:for|while)\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,400}?\\bthrow\\s+new\\s+Error\\b"],
  ),
];
