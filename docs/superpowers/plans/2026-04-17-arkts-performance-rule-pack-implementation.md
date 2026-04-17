# ArkTS Performance Rule Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 `arkts-performance` 静态规则包，将 PDF 中明确写出的 ArkTS 高性能编程实践映射为可注册、可测试的静态规则集合。

**Architecture:** 先把规则工厂从单包写死改成显式接收 `packId`，保持现有 `arkts-language` 规则不变；再新增 `arkts-performance/{must,should,forbidden}` 三文件并在 `rulePackRegistry` 中注册。最后补齐注册测试和规则引擎测试，验证新包的 `text_pattern` 规则能命中，`pending` 规则会回落到 `未接入判定器`。

**Tech Stack:** TypeScript, Node.js test runner, existing static rule engine, existing repo-local ArkTS rule packs

---

## Planned Files

- Modify: `src/rules/packs/shared/ruleFactories.ts`
  让 `createPendingRule` 和 `createTextRule` 显式接收 `packId`，支持多规则包复用。
- Modify: `src/rules/packs/arkts-language/must.ts`
  为现有语言规则补传 `"arkts-language"`，保持原有行为。
- Modify: `src/rules/packs/arkts-language/should.ts`
  为现有语言规则补传 `"arkts-language"`，保持原有行为。
- Modify: `src/rules/packs/arkts-language/forbidden.ts`
  为现有语言规则补传 `"arkts-language"`，保持原有行为。
- Create: `src/rules/packs/arkts-performance/must.ts`
  导出空的 `arktsPerformanceMustRules`。
- Create: `src/rules/packs/arkts-performance/should.ts`
  定义 6 条性能建议规则，其中 1 条 `text_pattern`，5 条 `pending`。
- Create: `src/rules/packs/arkts-performance/forbidden.ts`
  定义 5 条可稳定识别的性能反模式规则。
- Modify: `src/rules/engine/rulePackRegistry.ts`
  注册 `arkts-performance` 包。
- Create: `tests/rule-factory.test.ts`
  锁定规则工厂按传入 `packId` 生成规则。
- Modify: `tests/rule-pack-registry.test.ts`
  校验新包注册、计数、抽样规则元数据和源文件存在性。
- Modify: `tests/rule-engine.test.ts`
  验证新包的 `text_pattern` 规则命中，`pending` 规则返回 `未接入判定器`。

### Task 1: 让规则工厂支持多规则包

**Files:**
- Create: `tests/rule-factory.test.ts`
- Modify: `src/rules/packs/shared/ruleFactories.ts`
- Modify: `src/rules/packs/arkts-language/must.ts`
- Modify: `src/rules/packs/arkts-language/should.ts`
- Modify: `src/rules/packs/arkts-language/forbidden.ts`

- [ ] **Step 1: 写失败测试，锁定规则工厂必须保留调用方传入的 `packId`**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createPendingRule, createTextRule } from "../src/rules/packs/shared/ruleFactories.js";

test("rule factories preserve the provided pack id", () => {
  const pending = createPendingRule(
    "arkts-performance",
    "should_rule",
    "ARKTS-PERF-SHOULD-001",
    "不变变量推荐使用 const 声明。",
  );
  const text = createTextRule(
    "arkts-performance",
    "forbidden_pattern",
    "ARKTS-PERF-FORBID-001",
    "禁止使用可选参数。",
    ["\\?:\\s*number"],
  );

  assert.equal(pending.pack_id, "arkts-performance");
  assert.equal(text.pack_id, "arkts-performance");
  assert.equal(text.detector_kind, "text_pattern");
  assert.deepEqual(text.detector_config, {
    fileExtensions: [".ets"],
    patterns: ["\\?:\\s*number"],
  });
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- tests/rule-factory.test.ts`
Expected: FAIL，提示 `createPendingRule` / `createTextRule` 参数数量不匹配，或 `pack_id` 仍为 `"arkts-language"`

- [ ] **Step 3: 修改规则工厂签名，并把现有 `arkts-language` 调用补传 `packId`**

```ts
// src/rules/packs/shared/ruleFactories.ts
import type { RegisteredRule, RuleSource } from "../../engine/ruleTypes.js";

const defaultFileExtensions = [".ets"];

export function createPendingRule(
  packId: string,
  rule_source: RuleSource,
  rule_id: string,
  summary: string,
): RegisteredRule {
  return {
    pack_id: packId,
    rule_id,
    rule_source,
    summary,
    detector_kind: "not_implemented",
    detector_config: {},
    fallback_policy: "agent_assisted",
  };
}

export function createTextRule(
  packId: string,
  rule_source: RuleSource,
  rule_id: string,
  summary: string,
  patterns: string[],
): RegisteredRule {
  return {
    pack_id: packId,
    rule_id,
    rule_source,
    summary,
    detector_kind: "text_pattern",
    detector_config: {
      fileExtensions: defaultFileExtensions,
      patterns,
    },
    fallback_policy: "agent_assisted",
  };
}
```

```ts
// src/rules/packs/arkts-language/must.ts
createTextRule("arkts-language", "must_rule", "ARKTS-MUST-001", "对象属性名必须是合法标识符，禁止依赖数字键或普通字符串键的动态属性访问。", [
  "\\[['\"][^'\"]+['\"]\\]|\\[\\s*\\d+\\s*\\]",
]);
createPendingRule("arkts-language", "must_rule", "ARKTS-MUST-004", "类型、枚举、接口和命名空间名称必须唯一，且不得与变量或函数等标识符冲突。");
```

```ts
// src/rules/packs/arkts-language/should.ts
createPendingRule("arkts-language", "should_rule", "ARKTS-SHOULD-002", "仅在确有跨语言调用需要时使用 ESObject，且优先限制在局部变量场景。");
createTextRule("arkts-language", "should_rule", "ARKTS-SHOULD-009", "使用空格缩进，禁止使用 tab。", ["\\t"]);
```

```ts
// src/rules/packs/arkts-language/forbidden.ts
createTextRule("arkts-language", "forbidden_pattern", "ARKTS-FORBID-001", "禁止使用 any、unknown、@ts-ignore、@ts-nocheck 或 as any 等弱类型逃逸手段。", [
  ":\\s*(any|unknown)\\b|\\b(as\\s+any|as\\s+unknown)\\b|@ts-ignore|@ts-nocheck",
]);
createPendingRule("arkts-language", "forbidden_pattern", "ARKTS-FORBID-009", "禁止枚举混用不同值类型、使用运行时表达式初始化枚举、依赖 enum/声明合并或将命名空间作为运行时对象。");
```

实现要求：
- `must.ts`、`should.ts`、`forbidden.ts` 中每一个 `createTextRule` 与 `createPendingRule` 调用都补上第一个参数 `"arkts-language"`
- 除工厂签名和 `packId` 以外，不修改现有 ArkTS 语言规则的 `rule_id`、`summary`、`patterns`

- [ ] **Step 4: 运行测试，确认工厂行为和现有语言包没有被破坏**

Run: `npm test -- tests/rule-factory.test.ts tests/rule-pack-registry.test.ts`
Expected: PASS，且 `arkts-language` 相关断言仍通过

- [ ] **Step 5: 提交工厂改造**

```bash
git add tests/rule-factory.test.ts src/rules/packs/shared/ruleFactories.ts src/rules/packs/arkts-language/must.ts src/rules/packs/arkts-language/should.ts src/rules/packs/arkts-language/forbidden.ts
git commit -m "refactor: make rule factories pack-aware"
```

### Task 2: 新增 `arkts-performance` 规则文件并注册规则包

**Files:**
- Create: `src/rules/packs/arkts-performance/must.ts`
- Create: `src/rules/packs/arkts-performance/should.ts`
- Create: `src/rules/packs/arkts-performance/forbidden.ts`
- Modify: `src/rules/engine/rulePackRegistry.ts`
- Modify: `tests/rule-pack-registry.test.ts`

- [ ] **Step 1: 写失败测试，锁定新规则包的注册信息和总数**

```ts
test("arkts-performance pack registers PDF-derived performance rules", () => {
  const packs = getRegisteredRulePacks();
  const performancePack = packs.find((item) => item.packId === "arkts-performance");

  assert.ok(performancePack);
  assert.equal(performancePack.displayName, "ArkTS 高性能编程实践");
  assert.equal(performancePack.rules.length, 11);
  assert.equal(performancePack.rules.filter((item) => item.rule_source === "must_rule").length, 0);
  assert.equal(performancePack.rules.filter((item) => item.rule_source === "should_rule").length, 6);
  assert.equal(performancePack.rules.filter((item) => item.rule_source === "forbidden_pattern").length, 5);

  const rules = listRegisteredRules();
  assert.equal(rules.length, 74);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- tests/rule-pack-registry.test.ts`
Expected: FAIL，提示 `arkts-performance` 包尚未注册或规则总数仍为 `63`

- [ ] **Step 3: 创建新规则文件并在注册表中接入**

```ts
// src/rules/packs/arkts-performance/must.ts
import type { RegisteredRule } from "../../engine/ruleTypes.js";

export const arktsPerformanceMustRules: RegisteredRule[] = [];
```

```ts
// src/rules/packs/arkts-performance/should.ts
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
```

```ts
// src/rules/packs/arkts-performance/forbidden.ts
import type { RegisteredRule } from "../../engine/ruleTypes.js";
import { createTextRule } from "../shared/ruleFactories.js";

export const arktsPerformanceForbiddenRules: RegisteredRule[] = [
  createTextRule("arkts-performance", "forbidden_pattern", "ARKTS-PERF-FORBID-001", "禁止使用可选参数 ? 作为性能敏感函数参数形式。", [
    "\\bfunction\\s+[A-Za-z_$][\\w$]*\\s*\\([^)]*\\?:[^)]*\\)",
    "\\([^)]*\\?:[^)]*\\)\\s*=>",
  ]),
  createTextRule("arkts-performance", "forbidden_pattern", "ARKTS-PERF-FORBID-002", "禁止使用联合类型数组。", [
    "\\([^\\)]*\\|[^\\)]*\\)\\s*\\[\\]",
    "\\bArray\\s*<[^>]*\\|[^>]*>",
  ]),
  createTextRule("arkts-performance", "forbidden_pattern", "ARKTS-PERF-FORBID-003", "禁止在数值数组字面量中混用整型和浮点型。", [
    "\\[[^\\]\\n]*\\b\\d+\\.\\d+\\b[^\\]\\n]*\\b\\d+\\b[^\\]\\n]*\\]",
    "\\[[^\\]\\n]*\\b\\d+\\b[^\\]\\n]*\\b\\d+\\.\\d+\\b[^\\]\\n]*\\]",
  ]),
  createTextRule("arkts-performance", "forbidden_pattern", "ARKTS-PERF-FORBID-004", "禁止通过超大容量初始化或大跨度下标写入制造稀疏/退化数组。", [
    "\\bnew\\s+Array\\s*\\(\\s*(?:102[5-9]|10[3-9]\\d|1[1-9]\\d\\d|[2-9]\\d{3,})\\s*\\)",
    "\\b[A-Za-z_$][\\w$]*\\s*\\[\\s*(?:102[4-9]|10[3-9]\\d|1[1-9]\\d\\d|[2-9]\\d{3,})\\s*\\]\\s*=",
  ]),
  createTextRule("arkts-performance", "forbidden_pattern", "ARKTS-PERF-FORBID-005", "禁止在循环等热点路径中直接抛出异常。", [
    "\\b(?:for|while)\\s*\\([^)]*\\)\\s*\\{[\\s\\S]{0,400}?\\bthrow\\s+new\\s+Error\\b",
  ]),
];
```

```ts
// src/rules/engine/rulePackRegistry.ts
import type { RegisteredRule, RegisteredRulePack } from "./ruleTypes.js";
import { arktsForbiddenRules } from "../packs/arkts-language/forbidden.js";
import { arktsMustRules } from "../packs/arkts-language/must.js";
import { arktsShouldRules } from "../packs/arkts-language/should.js";
import { arktsPerformanceForbiddenRules } from "../packs/arkts-performance/forbidden.js";
import { arktsPerformanceMustRules } from "../packs/arkts-performance/must.js";
import { arktsPerformanceShouldRules } from "../packs/arkts-performance/should.js";

const registeredRulePacks: RegisteredRulePack[] = [
  {
    packId: "arkts-language",
    displayName: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
    rules: [...arktsMustRules, ...arktsShouldRules, ...arktsForbiddenRules],
  },
  {
    packId: "arkts-performance",
    displayName: "ArkTS 高性能编程实践",
    rules: [...arktsPerformanceMustRules, ...arktsPerformanceShouldRules, ...arktsPerformanceForbiddenRules],
  },
];
```

```ts
// tests/rule-pack-registry.test.ts
test("registered rules carry performance-pack summaries and detector configs", () => {
  const rules = listRegisteredRules();
  const perfShould002 = rules.find((item) => item.rule_id === "ARKTS-PERF-SHOULD-002");
  const perfForbid003 = rules.find((item) => item.rule_id === "ARKTS-PERF-FORBID-003");
  const perfShould001 = rules.find((item) => item.rule_id === "ARKTS-PERF-SHOULD-001");

  assert.ok(perfShould002);
  assert.equal(perfShould002.pack_id, "arkts-performance");
  assert.equal(perfShould002.detector_kind, "text_pattern");
  assert.match(perfShould002.summary, /整型与浮点型混用/);
  assert.deepEqual(perfShould002.detector_config.fileExtensions, [".ets"]);

  assert.ok(perfForbid003);
  assert.equal(perfForbid003.pack_id, "arkts-performance");
  assert.equal(perfForbid003.detector_kind, "text_pattern");
  assert.match(perfForbid003.summary, /混用整型和浮点型/);

  assert.ok(perfShould001);
  assert.equal(perfShould001.detector_kind, "not_implemented");
});
```

实现要求：
- `arkts-performance` 规则编号固定为 `ARKTS-PERF-SHOULD-001` 到 `ARKTS-PERF-SHOULD-006`、`ARKTS-PERF-FORBID-001` 到 `ARKTS-PERF-FORBID-005`
- `must.ts` 中不创建任何规则
- `rulePackRegistry` 中 `arkts-language` 必须继续排在前面，保持已有规则顺序稳定

- [ ] **Step 4: 运行测试，确认新包注册正确**

Run: `npm test -- tests/rule-pack-registry.test.ts`
Expected: PASS，且总规则数变为 `74`

- [ ] **Step 5: 提交新规则包与注册改动**

```bash
git add src/rules/packs/arkts-performance/must.ts src/rules/packs/arkts-performance/should.ts src/rules/packs/arkts-performance/forbidden.ts src/rules/engine/rulePackRegistry.ts tests/rule-pack-registry.test.ts
git commit -m "feat: add arkts performance rule pack"
```

### Task 3: 为性能规则补齐规则引擎覆盖

**Files:**
- Modify: `tests/rule-engine.test.ts`

- [ ] **Step 1: 写失败测试，锁定新规则包的命中结果与 pending 状态**

```ts
test("runRuleEngine evaluates arkts-performance rules and keeps pending rules explicit", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": `
function add(left?: number, right?: number): number {
  return (left ?? 0) + (right ?? 0);
}

let arrUnion: (number | string)[] = [1, 'hello'];
let arrNum: number[] = [1, 1.1, 2];
let sparse: number[] = [];
sparse[9999] = 0;

function sum(num: number): number {
  for (let t = 1; t < 100; t++) {
    throw new Error('Invalid numbers.');
  }
  return num;
}

let intNum = 1;
intNum = 1.1;
`,
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-FORBID-001" && item.result === "不满足"),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-FORBID-002" && item.result === "不满足"),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-FORBID-003" && item.result === "不满足"),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-FORBID-004" && item.result === "不满足"),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-FORBID-005" && item.result === "不满足"),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-SHOULD-002" && item.result === "不满足"),
    true,
  );
  assert.equal(
    result.staticRuleAuditResults.some((item) => item.rule_id === "ARKTS-PERF-SHOULD-001" && item.result === "未接入判定器"),
    true,
  );
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- tests/rule-engine.test.ts`
Expected: FAIL，提示找不到 `ARKTS-PERF-*` 规则或命中结果不满足断言

- [ ] **Step 3: 把测试插入现有引擎测试集，并保留 `.ets` 文件边界**

```ts
// tests/rule-engine.test.ts
test("runRuleEngine evaluates arkts-performance rules and keeps pending rules explicit", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": `
function add(left?: number, right?: number): number {
  return (left ?? 0) + (right ?? 0);
}
let arrUnion: (number | string)[] = [1, 'hello'];
let arrNum: number[] = [1, 1.1, 2];
let sparse: number[] = [];
sparse[9999] = 0;
function sum(num: number): number {
  for (let t = 1; t < 100; t++) {
    throw new Error('Invalid numbers.');
  }
  return num;
}
let intNum = 1;
intNum = 1.1;
`,
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-PERF-FORBID-001",
    "ARKTS-PERF-FORBID-002",
    "ARKTS-PERF-FORBID-003",
    "ARKTS-PERF-FORBID-004",
    "ARKTS-PERF-FORBID-005",
    "ARKTS-PERF-SHOULD-002",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some((item) => item.rule_id === ruleId && item.result === "不满足"),
      true,
      ruleId,
    );
  }

  for (const ruleId of [
    "ARKTS-PERF-SHOULD-001",
    "ARKTS-PERF-SHOULD-003",
    "ARKTS-PERF-SHOULD-004",
    "ARKTS-PERF-SHOULD-005",
    "ARKTS-PERF-SHOULD-006",
  ]) {
    assert.equal(
      result.staticRuleAuditResults.some((item) => item.rule_id === ruleId && item.result === "未接入判定器"),
      true,
      ruleId,
    );
  }
});
```

实现要求：
- 不改动 `runRuleEngine` 逻辑，只通过新增规则包和测试验证现有引擎已能覆盖新包
- 新测试只使用 `.ets` 文件，避免把问题混入扫描范围控制逻辑

- [ ] **Step 4: 运行测试，确认规则引擎已覆盖新包**

Run: `npm test -- tests/rule-engine.test.ts tests/rule-pack-registry.test.ts tests/rule-factory.test.ts`
Expected: PASS

- [ ] **Step 5: 提交测试覆盖**

```bash
git add tests/rule-engine.test.ts tests/rule-pack-registry.test.ts tests/rule-factory.test.ts
git commit -m "test: cover arkts performance rules"
```

### Task 4: 运行回归验证并完成收尾

**Files:**
- Modify: `tests/rule-engine.test.ts`（仅当回归失败需要修正断言时）
- Modify: `tests/rule-pack-registry.test.ts`（仅当回归失败需要修正断言时）

- [ ] **Step 1: 运行完整测试集，验证没有破坏现有规则引擎行为**

Run: `npm test`
Expected: PASS，所有 `tests/*.test.ts` 通过

- [ ] **Step 2: 如果完整测试失败，只做最小修正**

允许修改：
- `tests/rule-engine.test.ts`
- `tests/rule-pack-registry.test.ts`

禁止修改：
- `src/rules/ruleEngine.ts`
- `src/rules/evidenceCollector.ts`
- 任何与本次规则包无关的工作流节点文件

最小修正示例：

```ts
assert.equal(
  result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-PERF-FORBID-004" && item.result === "不满足"),
  true,
);
```

如果失败原因是阈值模式需要微调，只允许改动 `src/rules/packs/arkts-performance/forbidden.ts` 中对应正则，不要扩大规则范围。

- [ ] **Step 3: 重新运行完整测试，确认回归安全**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: 提交最终验证结果**

```bash
git add src/rules/packs/arkts-performance/forbidden.ts tests/rule-engine.test.ts tests/rule-pack-registry.test.ts
git commit -m "chore: verify arkts performance pack rollout"
```
