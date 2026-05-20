# 确定性规则与风险枚举 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不引入冗余技术栈的前提下，稳定评分链路：Code Linter 作为确定性结论只在规则合并阶段进入评分，内置规则 YAML 向用例规则结构靠拢，agent 判定规则具备明确触发条件，rubric 风险项从 YAML 枚举中选择。

**Architecture:** 沿用现有 LangGraph 工作流和 `src/rules/**`、`src/scoring/**`、`web/src/pages/scoreConsistencyAnalysis.ts` 边界，不新增数据库、独立规则服务或第二套评分引擎。规则事实仍由 `ruleAuditNode`、`officialCodeLinterNode`、`ruleMergeNode` 汇合；rubric agent 只负责 rubric 评分和从风险枚举中选择风险，不再自由扩张风险名称。

**Tech Stack:** TypeScript、Node 内置 test runner、`js-yaml`、现有规则包导出器、现有评分融合与一致性分析模块。

---

## 约束边界

- Code Linter 的 findings、summary、conclusion 不进入 `ruleAgentPromptBuilderNode`，也不进入 rule assessment agent prompt。
- Code Linter 的结论完整保留到 `ruleMergeNode`，由 merge 阶段追加到 deterministic rule results。
- 不大量扩张字段。只新增必要的 `decision_triggers` 和风险稳定 key 字段。
- 内置系统规则 YAML 结构向用例规则靠拢：保留 `rule_name`、`priority`、`targetPatterns`、`targetChecks`、`kit`、`decisionTriggers`、`fallback_policy`。
- 需要 agent 判定的规则允许配置 `满足` / `不满足` / `不涉及` / `待复核` 的触发条件。
- 风险项通过 YAML 枚举维护，区分低/中/高风险；rubric agent 从枚举选择，不允许无序创造新风险名称。

## 文件职责

- `src/rules/engine/ruleTypes.ts`
  - 增加最小规则触发条件类型：`RuleDecisionTrigger`、`RuleDecisionTriggers`。
  - 给 `RegisteredRule` 增加可选 `decision_triggers`。

- `src/rules/packs/shared/ruleFactories.ts`
  - 让 `createAgentAssistedTargetRule` 接受 `decisionTriggers`。
  - 不改变既有 `detector_config` 和 `fallback_policy` 语义。

- `src/rules/engine/rulePackYamlExporter.ts`
  - 导出内置规则时补充 case-rule-like 字段。
  - YAML 使用 `decisionTriggers`，TypeScript 运行时使用 `decision_triggers`。

- `src/rules/evaluators/caseConstraintEvaluator.ts`
  - 在已有静态预判基础上解释简单触发条件。
  - 能确定时直接输出 `满足`、`不满足`、`不涉及`；不能确定时维持 agent fallback。

- `src/rules/packs/cross-device-adaptation/ruleData.ts`
  - 为当前稳定性问题最明显的跨设备规则补充首批触发条件。

- `src/nodes/ruleAgentPromptBuilderNode.ts`
  - 不应消费 Code Linter 内容。若当前已经满足，只补回归测试。

- `src/nodes/ruleMergeNode.ts`
  - 继续负责 deterministic static results + Code Linter results + assisted results 合并。

- `references/risks/risk-taxonomy.yaml`
  - 新增风险枚举，包含 `code`、`level`、`title`、`description`、`matchHints`。

- `src/scoring/riskTaxonomy.ts`
  - 加载并校验风险枚举 YAML。
  - 提供风险归一化函数。

- `src/types.ts`
  - 给 `RiskItem` 最小扩展：`risk_code`、`risk_category`、`source_rule_id`。
  - 给 `LoadedRubricSnapshot` 增加可选 `risk_taxonomy` 摘要。

- `src/nodes/rubricScoringPromptBuilderNode.ts`
  - 在 rubric prompt 中传入风险枚举，并要求 agent 从中选择。

- `src/agent/opencodeRubricScoring.ts`
  - 接收 rubric agent 输出的可选 `risk_code`、`risk_category`、`source_rule_id`。

- `src/scoring/scoreFusion.ts`
  - 规则生成风险使用稳定 `RULE_VIOLATION:<rule_id>`。
  - rubric 风险按 taxonomy 归一化。

- `web/src/pages/scoreConsistencyAnalysis.ts`
  - 风险 key 优先使用 `risk_code`，再使用 `source_rule_id`，最后回退到当前 `level|title`。
  - 新增分数稳定性、硬门槛稳定性、finding 稳定性拆分指标，同时保留现有 `consistencyPercentage`。

---

### Task 1: 增加规则触发条件元数据

**Files:**
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify: `src/rules/packs/shared/ruleFactories.ts`
- Test: `tests/rule-factory.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/rule-factory.test.ts` 增加：

```ts
test("agent assisted target rules preserve decision triggers", () => {
  const rule = createAgentAssistedTargetRule({
    packId: "cross-device-adaptation",
    ruleSource: "must_rule",
    ruleId: "RSP-MUST-02",
    ruleName: "布局条件分支必须使用断点枚举值而非硬编码宽度",
    summary: "布局条件分支必须使用断点枚举值而非硬编码宽度。",
    priority: "P0",
    targetChecks: [
      {
        target: "**/*.ets",
        llmPrompt: "检查硬编码断点。",
        astSignals: [],
      },
    ],
    decisionTriggers: {
      pass: [{ type: "all_patterns_absent", patterns: ["\\b(width|vp)\\s*[<>]=?\\s*(600|840)\\b"] }],
      fail: [{ type: "any_pattern_present", patterns: ["\\b(width|vp)\\s*[<>]=?\\s*(600|840)\\b"] }],
      not_applicable: [{ type: "no_target_files" }],
      review: [{ type: "otherwise" }],
    },
  });

  assert.deepEqual(rule.decision_triggers, {
    pass: [{ type: "all_patterns_absent", patterns: ["\\b(width|vp)\\s*[<>]=?\\s*(600|840)\\b"] }],
    fail: [{ type: "any_pattern_present", patterns: ["\\b(width|vp)\\s*[<>]=?\\s*(600|840)\\b"] }],
    not_applicable: [{ type: "no_target_files" }],
    review: [{ type: "otherwise" }],
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/rule-factory.test.ts`

Expected: FAIL，原因是 `createAgentAssistedTargetRule` 还不接受 `decisionTriggers`。

- [ ] **Step 3: 增加类型**

在 `src/rules/engine/ruleTypes.ts` 增加：

```ts
export type RuleDecisionTrigger =
  | { type: "any_pattern_present"; patterns: string[] }
  | { type: "all_patterns_absent"; patterns: string[] }
  | { type: "all_patterns_present"; patterns: string[] }
  | { type: "no_target_files" }
  | { type: "otherwise" };

export interface RuleDecisionTriggers {
  pass?: RuleDecisionTrigger[];
  fail?: RuleDecisionTrigger[];
  not_applicable?: RuleDecisionTrigger[];
  review?: RuleDecisionTrigger[];
}
```

并给 `RegisteredRule` 增加：

```ts
decision_triggers?: RuleDecisionTriggers;
```

- [ ] **Step 4: 工厂透传触发条件**

在 `src/rules/packs/shared/ruleFactories.ts` 中：

```ts
import type { RegisteredRule, RuleDecisionTriggers, RuleSource } from "../../engine/ruleTypes.js";
```

给 `createAgentAssistedTargetRule` 入参增加：

```ts
decisionTriggers?: RuleDecisionTriggers;
```

返回对象中增加：

```ts
...(input.decisionTriggers ? { decision_triggers: input.decisionTriggers } : {}),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --import tsx --test tests/rule-factory.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/rules/engine/ruleTypes.ts src/rules/packs/shared/ruleFactories.ts tests/rule-factory.test.ts
git commit -m "feat: add rule decision trigger metadata"
```

---

### Task 2: 将内置规则 YAML 导出为接近用例规则的结构

**Files:**
- Modify: `src/rules/engine/rulePackYamlExporter.ts`
- Test: `tests/rule-pack-yaml-export.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/rule-pack-yaml-export.test.ts` 增加：

```ts
test("rule pack yaml export includes case-rule-like metadata when present", () => {
  const docs = buildRulePackYamlDocuments([
    {
      packId: "cross-device-adaptation",
      displayName: "一多适配",
      rules: [
        {
          pack_id: "cross-device-adaptation",
          rule_id: "RSP-MUST-02",
          rule_name: "布局条件分支必须使用断点枚举值而非硬编码宽度",
          priority: "P0",
          rule_source: "must_rule",
          summary: "布局条件分支必须使用断点枚举值而非硬编码宽度。",
          detector_kind: "case_constraint",
          detector_config: {
            targetPatterns: ["**/*.ets"],
            kit: ["ArkUI: WidthBreakpoint"],
            targetChecks: [
              {
                target: "**/*.ets",
                astSignals: [],
                llmPrompt: "检查硬编码断点。",
              },
            ],
          },
          decision_triggers: {
            fail: [{ type: "any_pattern_present", patterns: ["\\b(width|vp)\\s*[<>]=?\\s*(600|840)\\b"] }],
            review: [{ type: "otherwise" }],
          },
          fallback_policy: "agent_assisted",
        },
      ],
    },
  ]);

  const rule = docs[0]?.document.must_rules[0] as Record<string, unknown>;
  assert.equal(rule.rule_name, "布局条件分支必须使用断点枚举值而非硬编码宽度");
  assert.equal(rule.priority, "P0");
  assert.deepEqual(rule.kit, ["ArkUI: WidthBreakpoint"]);
  assert.deepEqual(rule.targetChecks, [
    {
      target: "**/*.ets",
      astSignals: [],
      llmPrompt: "检查硬编码断点。",
    },
  ]);
  assert.deepEqual(rule.decisionTriggers, {
    fail: [{ type: "any_pattern_present", patterns: ["\\b(width|vp)\\s*[<>]=?\\s*(600|840)\\b"] }],
    review: [{ type: "otherwise" }],
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/rule-pack-yaml-export.test.ts`

Expected: FAIL，当前 exporter 未导出这些字段。

- [ ] **Step 3: 扩展 YAML rule 类型**

在 `src/rules/engine/rulePackYamlExporter.ts` 中给 `RulePackYamlRule` 增加：

```ts
rule_name?: string;
priority?: RegisteredRule["priority"];
kit?: string[];
targetChecks?: unknown;
decisionTriggers?: RegisteredRule["decision_triggers"];
```

- [ ] **Step 4: 修改 `toYamlRule`**

使用当前 `detector_config` 提取可选字段：

```ts
const kit = Array.isArray(rule.detector_config.kit) ? rule.detector_config.kit : undefined;
const targetChecks = Array.isArray(rule.detector_config.targetChecks)
  ? rule.detector_config.targetChecks
  : undefined;
```

返回：

```ts
return {
  id: rule.rule_id,
  rule: rule.summary,
  ...(rule.rule_name ? { rule_name: rule.rule_name } : {}),
  ...(rule.priority ? { priority: rule.priority } : {}),
  detector_kind: rule.detector_kind,
  detector_config: rule.detector_config,
  ...(kit ? { kit } : {}),
  ...(targetChecks ? { targetChecks } : {}),
  ...(rule.decision_triggers ? { decisionTriggers: rule.decision_triggers } : {}),
  fallback_policy: rule.fallback_policy,
};
```

- [ ] **Step 5: 运行测试**

Run: `node --import tsx --test tests/rule-pack-yaml-export.test.ts`

Expected: PASS。

- [ ] **Step 6: 重新导出规则 YAML**

Run: `npm run rulepack:export`

Expected: PASS，`references/rules/*.yaml` 出现新增元数据。

- [ ] **Step 7: 提交**

```bash
git add src/rules/engine/rulePackYamlExporter.ts tests/rule-pack-yaml-export.test.ts references/rules
git commit -m "feat: export case-like rule metadata"
```

---

### Task 3: 在 case constraint evaluator 中执行触发条件

**Files:**
- Modify: `src/rules/evaluators/caseConstraintEvaluator.ts`
- Test: `tests/case-constraint-evaluator.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/case-constraint-evaluator.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { runCaseConstraintRule } from "../src/rules/evaluators/caseConstraintEvaluator.js";
import type { RegisteredRule } from "../src/rules/engine/ruleTypes.js";

function ruleWithTriggers(pattern: string): RegisteredRule {
  return {
    pack_id: "cross-device-adaptation",
    rule_id: "RSP-MUST-02",
    rule_source: "must_rule",
    summary: "布局条件分支必须使用断点枚举值而非硬编码宽度。",
    detector_kind: "case_constraint",
    detector_config: {
      targetPatterns: ["**/*.ets"],
      targetChecks: [{ target: "**/*.ets", astSignals: [], llmPrompt: "检查硬编码断点。" }],
    },
    decision_triggers: {
      fail: [{ type: "any_pattern_present", patterns: [pattern] }],
      pass: [{ type: "all_patterns_absent", patterns: [pattern] }],
      not_applicable: [{ type: "no_target_files" }],
      review: [{ type: "otherwise" }],
    },
    fallback_policy: "agent_assisted",
  };
}

test("case constraint evaluator returns violation from fail trigger", () => {
  const result = runCaseConstraintRule(ruleWithTriggers("\\bwidth\\s*<\\s*600\\b"), {
    workspaceFiles: [
      {
        relativePath: "features/home/src/main/ets/pages/Index.ets",
        content: "if (width < 600) { this.compact = true }",
      },
    ],
    originalFiles: [],
    changedFiles: ["features/home/src/main/ets/pages/Index.ets"],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: ["features/home/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  assert.equal(result.result, "不满足");
});

test("case constraint evaluator returns pass from pass trigger", () => {
  const result = runCaseConstraintRule(ruleWithTriggers("\\bwidth\\s*<\\s*600\\b"), {
    workspaceFiles: [
      {
        relativePath: "features/home/src/main/ets/pages/Index.ets",
        content: "if (this.breakpoint === WidthBreakpoint.WIDTH_SM) { this.compact = true }",
      },
    ],
    originalFiles: [],
    changedFiles: ["features/home/src/main/ets/pages/Index.ets"],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 1,
      changedFiles: ["features/home/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  });

  assert.equal(result.result, "满足");
});

test("case constraint evaluator returns not applicable when no target files match", () => {
  const result = runCaseConstraintRule(ruleWithTriggers("\\bwidth\\s*<\\s*600\\b"), {
    workspaceFiles: [{ relativePath: "README.md", content: "no ets files" }],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不涉及");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/case-constraint-evaluator.test.ts`

Expected: FAIL，因为当前 evaluator 总是返回 `未接入判定器`。

- [ ] **Step 3: 增加触发条件解释函数**

在 `src/rules/evaluators/caseConstraintEvaluator.ts` 增加：

```ts
function compileTriggerPatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, "m"));
}

function candidateContent(candidateFiles: CollectedEvidence["workspaceFiles"]): string {
  return candidateFiles.map((file) => getPatchScopedContent(file)).join("\n");
}

function triggerMatches(
  trigger: NonNullable<RegisteredRule["decision_triggers"]>[keyof NonNullable<RegisteredRule["decision_triggers"]>][number],
  candidateFiles: CollectedEvidence["workspaceFiles"],
): boolean {
  if (trigger.type === "no_target_files") {
    return candidateFiles.length === 0;
  }
  if (trigger.type === "otherwise") {
    return true;
  }
  const content = candidateContent(candidateFiles);
  const patterns = "patterns" in trigger ? compileTriggerPatterns(trigger.patterns) : [];
  if (trigger.type === "any_pattern_present") {
    return patterns.some((pattern) => pattern.test(content));
  }
  if (trigger.type === "all_patterns_present") {
    return patterns.every((pattern) => pattern.test(content));
  }
  if (trigger.type === "all_patterns_absent") {
    return patterns.every((pattern) => !pattern.test(content));
  }
  return false;
}

function matchTriggerGroup(
  triggers: RegisteredRule["decision_triggers"] | undefined,
  group: "fail" | "pass" | "not_applicable" | "review",
  candidateFiles: CollectedEvidence["workspaceFiles"],
): boolean {
  return (triggers?.[group] ?? []).some((trigger) => triggerMatches(trigger, candidateFiles));
}
```

- [ ] **Step 4: 在 `runCaseConstraintRule` 中使用触发条件**

在 `staticPrecheck` 构建之后加入：

```ts
const triggers = rule.decision_triggers;
if (triggers) {
  if (matchTriggerGroup(triggers, "not_applicable", candidateFiles)) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "不涉及",
      conclusion: `${rule.rule_id} 未找到规则适用目标文件。`,
      matchedFiles: [],
      preliminaryData: { static_precheck: staticPrecheck },
    };
  }
  if (matchTriggerGroup(triggers, "fail", candidateFiles)) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "不满足",
      conclusion: `${rule.rule_id} 命中不满足触发条件：${rule.summary}`,
      matchedFiles: staticPrecheck.matched_files ?? candidateFiles.map((file) => file.relativePath),
      preliminaryData: { static_precheck: staticPrecheck },
    };
  }
  if (matchTriggerGroup(triggers, "pass", candidateFiles)) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "满足",
      conclusion: `${rule.rule_id} 命中满足触发条件：${rule.summary}`,
      matchedFiles: staticPrecheck.matched_files ?? [],
      preliminaryData: { static_precheck: staticPrecheck },
    };
  }
}
```

保留原有 `未接入判定器` fallback。

- [ ] **Step 5: 运行测试**

Run: `node --import tsx --test tests/case-constraint-evaluator.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/rules/evaluators/caseConstraintEvaluator.ts tests/case-constraint-evaluator.test.ts
git commit -m "feat: evaluate case rule decision triggers"
```

---

### Task 4: 为首批内置跨设备规则补充触发条件

**Files:**
- Modify: `src/rules/packs/cross-device-adaptation/ruleData.ts`
- Modify: `src/rules/packs/cross-device-adaptation/must.ts`
- Test: `tests/rule-pack-registry.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/rule-pack-registry.test.ts` 增加：

```ts
test("cross-device must rules expose decision triggers for deterministic precheck", () => {
  const rules = listRegisteredRules({ enabledPackIds: ["cross-device-adaptation"] });
  const rspMust02 = rules.find((rule) => rule.rule_id === "RSP-MUST-02");
  assert.ok(rspMust02?.decision_triggers?.fail?.length, "RSP-MUST-02 should define fail triggers");
  assert.ok(rspMust02?.decision_triggers?.pass?.length, "RSP-MUST-02 should define pass triggers");

  const rspMust03 = rules.find((rule) => rule.rule_id === "RSP-MUST-03");
  assert.ok(rspMust03?.decision_triggers?.fail?.length, "RSP-MUST-03 should define fail triggers");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/rule-pack-registry.test.ts`

Expected: FAIL。

- [ ] **Step 3: 给 rule data 类型增加 `decisionTriggers`**

在 `src/rules/packs/cross-device-adaptation/ruleData.ts` 对规则数据类型增加：

```ts
decisionTriggers?: {
  pass?: Array<{ type: "all_patterns_absent" | "all_patterns_present" | "any_pattern_present"; patterns: string[] }>;
  fail?: Array<{ type: "all_patterns_absent" | "all_patterns_present" | "any_pattern_present"; patterns: string[] }>;
  not_applicable?: Array<{ type: "no_target_files" }>;
  review?: Array<{ type: "otherwise" }>;
};
```

- [ ] **Step 4: 给 `RSP-MUST-02` 增加触发条件**

```ts
decisionTriggers: {
  fail: [
    {
      type: "any_pattern_present",
      patterns: [
        "\\b(?:width|screenWidth|windowWidth|vp)\\s*[<>]=?\\s*(?:320|600|840|1440)\\b",
        "\\b(?:320|600|840|1440)\\s*[<>]=?\\s*(?:width|screenWidth|windowWidth|vp)\\b",
      ],
    },
  ],
  pass: [
    {
      type: "all_patterns_absent",
      patterns: [
        "\\b(?:width|screenWidth|windowWidth|vp)\\s*[<>]=?\\s*(?:320|600|840|1440)\\b",
        "\\b(?:320|600|840|1440)\\s*[<>]=?\\s*(?:width|screenWidth|windowWidth|vp)\\b",
      ],
    },
  ],
  not_applicable: [{ type: "no_target_files" }],
  review: [{ type: "otherwise" }],
}
```

- [ ] **Step 5: 给 `RSP-MUST-03` 增加触发条件**

```ts
decisionTriggers: {
  fail: [
    {
      type: "all_patterns_absent",
      patterns: ["\\b(?:XL|xl|WIDTH_XL)\\b"],
    },
  ],
  review: [{ type: "otherwise" }],
}
```

- [ ] **Step 6: 在 must rule factory 调用中透传**

在 `src/rules/packs/cross-device-adaptation/must.ts` 的 `createAgentAssistedTargetRule` 入参中增加：

```ts
decisionTriggers: rule.decisionTriggers,
```

- [ ] **Step 7: 运行测试**

Run: `node --import tsx --test tests/rule-pack-registry.test.ts tests/case-constraint-evaluator.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/rules/packs/cross-device-adaptation/ruleData.ts src/rules/packs/cross-device-adaptation/must.ts tests/rule-pack-registry.test.ts
git commit -m "feat: add deterministic triggers for cross-device rules"
```

---

### Task 5: 锁定 Code Linter 与 rule agent 的边界

**Files:**
- Test: `tests/rule-agent-linter-boundary.test.ts`
- Test: `tests/rule-merge-node.test.ts`
- Modify only if failing: `src/nodes/ruleAgentPromptBuilderNode.ts`
- Modify only if failing: `src/nodes/ruleMergeNode.ts`

- [ ] **Step 1: 写 rule agent prompt 边界测试**

创建 `tests/rule-agent-linter-boundary.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ruleAgentPromptBuilderNode } from "../src/nodes/ruleAgentPromptBuilderNode.js";

test("rule agent prompt builder does not include official linter results", async () => {
  const output = await ruleAgentPromptBuilderNode(
    {
      caseInput: {
        caseId: "case-1",
        promptText: "test",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/generated",
      },
      caseDir: "/tmp/case",
      effectivePatchPath: "/tmp/case/patch/effective.patch",
      taskType: "continuation",
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: [],
        crossDeviceAdaptation: { applicability: "not_involved", confidence: "high", reasons: [] },
      },
      rubricSnapshot: {
        task_type: "continuation",
        evaluation_mode: "auto",
        scenario: "",
        scoring_method: "",
        scoring_note: "",
        common_risks: [],
        report_emphasis: [],
        dimension_summaries: [],
        hard_gates: [],
        review_rule_summary: [],
      },
      assistedRuleCandidates: [],
      officialLinterRuleResults: [
        {
          rule_id: "OFFICIAL-LINTER:@performance/no-use-any-import",
          rule_source: "should_rule",
          result: "不满足",
          conclusion: "官方 Code Linter 命中。",
        },
      ],
    } as never,
    { logger: { info: async () => undefined } },
  );

  const text = JSON.stringify(output);
  assert.doesNotMatch(text, /OFFICIAL-LINTER/);
  assert.doesNotMatch(text, /官方 Code Linter/);
});
```

- [ ] **Step 2: 运行边界测试**

Run: `node --import tsx --test tests/rule-agent-linter-boundary.test.ts`

Expected: PASS。若失败，从 prompt payload 构建路径移除 linter 字段。

- [ ] **Step 3: 写 merge 阶段测试**

创建 `tests/rule-merge-node.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ruleMergeNode } from "../src/nodes/ruleMergeNode.js";

test("rule merge appends official linter results to deterministic results", async () => {
  const result = await ruleMergeNode(
    {
      deterministicRuleResults: [
        {
          rule_id: "REQ-MUST-01",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "缺少预加载 API。",
        },
      ],
      officialLinterRuleResults: [
        {
          rule_id: "OFFICIAL-LINTER:@performance/no-use-any-import",
          rule_source: "should_rule",
          result: "不满足",
          conclusion: "官方 Code Linter 命中通配符导入。",
        },
      ],
      assistedRuleCandidates: [],
    } as never,
    { logger: { info: async () => undefined } },
  );

  assert.deepEqual(
    result.mergedRuleAuditResults?.map((rule) => rule.rule_id),
    ["REQ-MUST-01", "OFFICIAL-LINTER:@performance/no-use-any-import"],
  );
});
```

- [ ] **Step 4: 运行 merge 测试**

Run: `node --import tsx --test tests/rule-merge-node.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add tests/rule-agent-linter-boundary.test.ts tests/rule-merge-node.test.ts src/nodes/ruleAgentPromptBuilderNode.ts src/nodes/ruleMergeNode.ts
git commit -m "test: lock official linter merge boundary"
```

如果两个 source 文件没有改动，从 `git add` 中去掉。

---

### Task 6: 新增风险枚举 YAML 与加载器

**Files:**
- Create: `references/risks/risk-taxonomy.yaml`
- Create: `src/scoring/riskTaxonomy.ts`
- Modify: `src/types.ts`
- Test: `tests/risk-taxonomy.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/risk-taxonomy.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { loadRiskTaxonomy, normalizeRiskItem } from "../src/scoring/riskTaxonomy.js";

test("risk taxonomy loads stable low medium high entries", async () => {
  const taxonomy = await loadRiskTaxonomy(path.join(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "PRELOAD_API_MISSING"));
  assert.ok(taxonomy.entries.some((entry) => entry.level === "low"));
  assert.ok(taxonomy.entries.some((entry) => entry.level === "medium"));
  assert.ok(taxonomy.entries.some((entry) => entry.level === "high"));
});

test("normalizeRiskItem uses taxonomy title and level for known risk code", async () => {
  const taxonomy = await loadRiskTaxonomy(path.join(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  const risk = normalizeRiskItem(
    {
      id: 1,
      level: "low",
      title: "随便生成的 API 风险标题",
      description: "缺少 cloudResPrefetch。",
      evidence: "EntryAbility.ets",
      risk_code: "PRELOAD_API_MISSING",
    },
    taxonomy,
  );

  assert.equal(risk.risk_code, "PRELOAD_API_MISSING");
  assert.equal(risk.level, "high");
  assert.equal(risk.title, "缺失核心预加载 API 调用");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts`

Expected: FAIL。

- [ ] **Step 3: 创建风险枚举 YAML**

创建 `references/risks/risk-taxonomy.yaml`：

```yaml
version: v1
entries:
  - code: PRELOAD_API_MISSING
    level: high
    title: 缺失核心预加载 API 调用
    description: 未按任务约束使用预加载核心 API，可能导致核心功能路径偏离要求。
    matchHints:
      - cloudResPrefetch
      - 预加载 API
      - 核心需求API
  - code: PRELOAD_FALLBACK_INCOMPLETE
    level: medium
    title: 预加载失败兜底逻辑不完整
    description: 预加载失败后没有清晰、可靠的业务兜底路径。
    matchHints:
      - 兜底
      - 降级
      - 预加载失败
  - code: EXCEPTION_CONTROL_FLOW
    level: medium
    title: 异常控制流反模式
    description: 使用异常作为常规流程控制，影响可读性和稳定性。
    matchHints:
      - throw Error
      - 异常控制流
      - 异常用于流程控制
  - code: COMMENT_REMOVAL_READABILITY
    level: low
    title: 注释移除影响代码可读性
    description: 删除原有说明性注释，降低后续维护和 review 的上下文可读性。
    matchHints:
      - 注释删除
      - 注释移除
      - 可读性
  - code: MISSING_DEFAULT_CASE
    level: low
    title: switch 语句缺少 default 分支
    description: switch 分支缺少默认处理，可能降低代码健壮性。
    matchHints:
      - switch
      - default
```

- [ ] **Step 4: 实现 taxonomy loader**

创建 `src/scoring/riskTaxonomy.ts`：

```ts
import fs from "node:fs/promises";
import yaml from "js-yaml";
import type { RiskItem } from "../types.js";

export type RiskTaxonomyLevel = "low" | "medium" | "high";

export interface RiskTaxonomyEntry {
  code: string;
  level: RiskTaxonomyLevel;
  title: string;
  description: string;
  matchHints: string[];
}

export interface RiskTaxonomy {
  version: string;
  entries: RiskTaxonomyEntry[];
}

function isLevel(value: unknown): value is RiskTaxonomyLevel {
  return value === "low" || value === "medium" || value === "high";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function loadRiskTaxonomy(filePath: string): Promise<RiskTaxonomy> {
  const parsed = yaml.load(await fs.readFile(filePath, "utf-8")) as Record<string, unknown>;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return {
    version: typeof parsed.version === "string" ? parsed.version : "v1",
    entries: entries.flatMap((item): RiskTaxonomyEntry[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return [];
      }
      const record = item as Record<string, unknown>;
      if (
        typeof record.code !== "string" ||
        !isLevel(record.level) ||
        typeof record.title !== "string" ||
        typeof record.description !== "string"
      ) {
        return [];
      }
      return [
        {
          code: record.code,
          level: record.level,
          title: record.title,
          description: record.description,
          matchHints: readStringArray(record.matchHints),
        },
      ];
    }),
  };
}

export function findRiskTaxonomyEntry(
  taxonomy: RiskTaxonomy,
  code: string | undefined,
): RiskTaxonomyEntry | undefined {
  return code ? taxonomy.entries.find((entry) => entry.code === code) : undefined;
}

export function normalizeRiskItem(risk: RiskItem, taxonomy: RiskTaxonomy): RiskItem {
  const entry = findRiskTaxonomyEntry(taxonomy, risk.risk_code);
  if (!entry) {
    return risk;
  }
  return {
    ...risk,
    risk_code: entry.code,
    risk_category: entry.level,
    level: entry.level,
    title: entry.title,
    description: risk.description || entry.description,
  };
}
```

- [ ] **Step 5: 扩展 `RiskItem` 类型**

在 `src/types.ts` 的 `RiskItem` 增加：

```ts
risk_code?: string;
risk_category?: "low" | "medium" | "high";
source_rule_id?: string;
```

- [ ] **Step 6: 运行测试**

Run: `node --import tsx --test tests/risk-taxonomy.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add references/risks/risk-taxonomy.yaml src/scoring/riskTaxonomy.ts src/types.ts tests/risk-taxonomy.test.ts
git commit -m "feat: add yaml risk taxonomy"
```

---

### Task 7: 让 rubric agent 从风险枚举中选择风险

**Files:**
- Modify: `src/types.ts`
- Modify: `src/agent/ruleAssistance.ts` 或实际构建 `rubricSnapshot` 的文件
- Modify: `src/nodes/rubricScoringPromptBuilderNode.ts`
- Modify: `src/agent/opencodeRubricScoring.ts`
- Test: `tests/rubric-risk-taxonomy-prompt.test.ts`

- [ ] **Step 1: 写失败 prompt 测试**

创建 `tests/rubric-risk-taxonomy-prompt.test.ts`：

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildRubricScoringPrompt } from "../src/nodes/rubricScoringPromptBuilderNode.js";

test("rubric scoring prompt asks agent to choose risk_code from taxonomy", () => {
  const prompt = buildRubricScoringPrompt({
    case_context: {
      case_id: "case-1",
      case_root: "/tmp/case",
      task_type: "continuation",
      original_prompt_summary: "新增预加载",
      original_project_path: "/tmp/original",
      generated_project_path: "/tmp/generated",
    },
    task_understanding: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: [],
      crossDeviceAdaptation: { applicability: "not_involved", confidence: "high", reasons: [] },
    },
    rubric_summary: {
      task_type: "continuation",
      evaluation_mode: "auto",
      scenario: "",
      scoring_method: "",
      scoring_note: "",
      common_risks: [],
      report_emphasis: [],
      dimension_summaries: [],
      hard_gates: [],
      review_rule_summary: [],
      risk_taxonomy: [
        {
          code: "PRELOAD_API_MISSING",
          level: "high",
          title: "缺失核心预加载 API 调用",
          description: "未按任务约束使用预加载核心 API。",
        },
      ],
    } as never,
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
    },
  });

  assert.match(prompt, /risk_code/);
  assert.match(prompt, /PRELOAD_API_MISSING/);
  assert.match(prompt, /不要创造新的风险名称/);
});
```

如果 `buildRubricScoringPrompt` 当前未导出，先导出纯函数，不改变行为。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/rubric-risk-taxonomy-prompt.test.ts`

Expected: FAIL。

- [ ] **Step 3: 给 `LoadedRubricSnapshot` 增加 taxonomy 摘要**

在 `src/types.ts` 增加：

```ts
risk_taxonomy?: Array<{
  code: string;
  level: "low" | "medium" | "high";
  title: string;
  description: string;
}>;
```

- [ ] **Step 4: 在 rubric snapshot 构建处加载风险枚举**

定位当前实际构建 `rubricSnapshot` 的文件。若仍是 `src/agent/ruleAssistance.ts` 的 `buildRubricSnapshot`，则在调用方加载 `references/risks/risk-taxonomy.yaml` 后传入；不要把 taxonomy 加到 rule agent bootstrap payload。

只传给 rubric scoring payload：

```ts
risk_taxonomy: taxonomy.entries.map((entry) => ({
  code: entry.code,
  level: entry.level,
  title: entry.title,
  description: entry.description,
})),
```

- [ ] **Step 5: 修改 rubric prompt 文案**

在 `src/nodes/rubricScoringPromptBuilderNode.ts` 中加入明确约束：

```ts
"risks 必须优先从 risk_taxonomy 中选择 risk_code、level 和 title；不要创造新的风险名称。只有确实无法匹配时，risk_code 可省略，但 title 仍应简洁稳定。",
```

同时把 taxonomy 列表输出到 prompt。

- [ ] **Step 6: 扩展 rubric agent 风险 schema**

在 `src/agent/opencodeRubricScoring.ts` 中，风险 schema 增加可选字段：

```ts
risk_code: z.string().min(1).optional(),
risk_category: z.enum(["low", "medium", "high"]).optional(),
source_rule_id: z.string().min(1).optional(),
```

保留原有 `level`、`title`、`description`、`evidence`。

- [ ] **Step 7: 运行测试**

Run: `node --import tsx --test tests/rubric-risk-taxonomy-prompt.test.ts tests/opencode-config.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/types.ts src/agent/ruleAssistance.ts src/nodes/rubricPreparationNode.ts src/nodes/rubricScoringPromptBuilderNode.ts src/agent/opencodeRubricScoring.ts tests/rubric-risk-taxonomy-prompt.test.ts
git commit -m "feat: constrain rubric risks with taxonomy"
```

只提交实际改动过的文件。

---

### Task 8: 在评分融合阶段归一化风险

**Files:**
- Modify: `src/scoring/scoreFusion.ts`
- Modify if needed: `src/nodes/scoreFusionOrchestrationNode.ts`
- Test: `tests/scoring.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/scoring.test.ts` 使用现有 helper 或新增本地 helper 调用 `fuseRubricScoreWithRules`，添加：

```ts
test("score fusion assigns stable risk code to rule violations", async () => {
  const result = await computeScoreBreakdownFixture({
    ruleAuditResults: [
      {
        rule_id: "REQ-MUST-01",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "未使用 cloudResPrefetch。",
      },
    ],
  });

  const ruleRisk = result.risks.find((risk) => risk.source_rule_id === "REQ-MUST-01");
  assert.equal(ruleRisk?.risk_code, "RULE_VIOLATION:REQ-MUST-01");
});

test("score fusion normalizes rubric risks by taxonomy code", async () => {
  const result = await computeScoreBreakdownFixture({
    rubricScoringResult: {
      summary: { overall_assessment: "有风险", overall_confidence: "high" },
      item_scores: [],
      hard_gate_candidates: [],
      strengths: [],
      main_issues: [],
      risks: [
        {
          id: 1,
          level: "low",
          title: "核心需求API使用偏差",
          description: "未使用 cloudResPrefetch。",
          evidence: "EntryAbility.ets",
          risk_code: "PRELOAD_API_MISSING",
        },
      ],
    },
  });

  const risk = result.risks.find((item) => item.risk_code === "PRELOAD_API_MISSING");
  assert.equal(risk?.level, "high");
  assert.equal(risk?.title, "缺失核心预加载 API 调用");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/scoring.test.ts`

Expected: FAIL。

- [ ] **Step 3: 给 score fusion 增加 taxonomy 输入**

在 `src/scoring/scoreFusion.ts`：

```ts
import type { RiskTaxonomy } from "./riskTaxonomy.js";
import { normalizeRiskItem } from "./riskTaxonomy.js";
```

给 `FuseRubricScoreWithRulesInput` 增加：

```ts
riskTaxonomy?: RiskTaxonomy;
```

- [ ] **Step 4: 归一化 rubric 风险**

将 rubric risks 初始化改为：

```ts
const risks: RiskItem[] = (input.rubricScoringResult?.risks ?? []).map((risk, index) => {
  const withId = { ...risk, id: index + 1 };
  return input.riskTaxonomy ? normalizeRiskItem(withId, input.riskTaxonomy) : withId;
});
```

- [ ] **Step 5: 给规则风险加稳定 key 字段**

在 rule-generated risk push 中增加：

```ts
risk_code: `RULE_VIOLATION:${rule.rule_id}`,
source_rule_id: rule.rule_id,
```

- [ ] **Step 6: 在 orchestration node 传入 taxonomy**

在 `src/nodes/scoreFusionOrchestrationNode.ts` 加载 `references/risks/risk-taxonomy.yaml`，传给 `fuseRubricScoreWithRules`。

- [ ] **Step 7: 运行测试**

Run: `node --import tsx --test tests/scoring.test.ts tests/risk-taxonomy.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/scoring/scoreFusion.ts src/nodes/scoreFusionOrchestrationNode.ts tests/scoring.test.ts
git commit -m "feat: normalize risks during score fusion"
```

---

### Task 9: 拆分一致性指标并使用稳定风险 key

**Files:**
- Modify: `web/src/pages/scoreConsistencyAnalysis.ts`
- Test: `tests/score-consistency-analysis.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/score-consistency-analysis.test.ts` 增加：

```ts
test("extractConsistencyRunSummary uses risk_code as stable risk key", () => {
  const summary = extractConsistencyRunSummary(0, 130600101, {
    overall_conclusion: { total_score: 69, hard_gate_triggered: true },
    rule_audit_results: [],
    risks: [
      {
        id: 1,
        level: "high",
        title: "核心需求API使用偏差",
        risk_code: "PRELOAD_API_MISSING",
        evidence: "EntryAbility.ets",
      },
    ],
  });

  assert.equal(summary.risks[0]?.key, "risk_code|PRELOAD_API_MISSING");
});

test("analyzeConsistency exposes score gate and finding stability separately", () => {
  const analysis = analyzeConsistency([
    completedRun(0, { totalScore: 69, hardGateTriggered: true }),
    completedRun(1, {
      totalScore: 69,
      hardGateTriggered: true,
      risks: [
        {
          key: "risk_code|PRELOAD_API_MISSING",
          level: "high",
          title: "缺失核心预加载 API 调用",
        },
      ],
    }),
    completedRun(2, {
      totalScore: 69,
      hardGateTriggered: true,
      risks: [
        {
          key: "risk_code|PRELOAD_API_MISSING",
          level: "high",
          title: "缺失核心预加载 API 调用",
        },
      ],
    }),
  ]);

  assert.equal(analysis.scoreStability?.standardDeviation, 0);
  assert.equal(analysis.gateStability?.hardGateConsistencyPercentage, 100);
  assert.equal(typeof analysis.findingStability?.averageRuleJaccard, "number");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts`

Expected: FAIL。

- [ ] **Step 3: 扩展 summary 类型**

在 `ConsistencyAnalysisSummary` 增加：

```ts
scoreStability?: {
  average: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
};
gateStability?: {
  majorityHardGateTriggered: boolean | undefined;
  hardGateConsistencyPercentage: number | null;
};
findingStability?: {
  averageRuleJaccard: number | null;
  averageRiskJaccard: number | null;
};
```

- [ ] **Step 4: 修改风险 key 生成优先级**

在 `extractConsistencyRunSummary` 中：

```ts
const riskCode = optionalString(row.risk_code);
const sourceRuleId = optionalString(row.source_rule_id);
const key = riskCode
  ? `risk_code|${riskCode}`
  : sourceRuleId
    ? `source_rule|${sourceRuleId}`
    : `${normalizeText(level).toLowerCase()}|${normalizeText(identityText)}`;
```

返回 risk summary 时保留可选 `risk_code`、`source_rule_id`。

- [ ] **Step 5: 计算拆分稳定性指标**

在 `analyzeConsistency` 中增加：

```ts
const averageRuleJaccard =
  signatures.length > 0
    ? roundNumber(
        signatures.reduce(
          (sum, signature) => sum + jaccardSimilarity(signature.unsatisfiedRuleKeys, majorityRules),
          0,
        ) / signatures.length,
        4,
      )
    : null;
const averageRiskJaccard =
  signatures.length > 0
    ? roundNumber(
        signatures.reduce(
          (sum, signature) => sum + jaccardSimilarity(signature.riskKeys, majorityRisks),
          0,
        ) / signatures.length,
        4,
      )
    : null;
const hardGateConsistencyPercentage =
  majorityHardGate === undefined
    ? null
    : percentage(
        signatures.filter((signature) => signature.hardGateTriggered === majorityHardGate).length,
        signatures.length,
      );
```

返回对象中增加：

```ts
scoreStability: {
  average: averageScore,
  median: medianScore === null ? null : roundNumber(medianScore),
  min: scores.length ? Math.min(...scores) : null,
  max: scores.length ? Math.max(...scores) : null,
  standardDeviation: scoreStandardDeviation,
},
gateStability: {
  majorityHardGateTriggered: majorityHardGate,
  hardGateConsistencyPercentage,
},
findingStability: {
  averageRuleJaccard,
  averageRiskJaccard,
},
```

- [ ] **Step 6: 优化 conclusion 文案**

保留现有 `consistencyPercentage`，额外补一句：

```ts
const splitMetricText =
  scoreStandardDeviation !== null && scoreStandardDeviation <= 1 && consistencyPercentage !== null && consistencyPercentage < 70
    ? "总分稳定，但规则或风险集合存在波动。"
    : "";
```

把 `splitMetricText` 拼入 conclusion。

- [ ] **Step 7: 运行测试**

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts`

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add web/src/pages/scoreConsistencyAnalysis.ts tests/score-consistency-analysis.test.ts
git commit -m "feat: split score consistency metrics"
```

---

### Task 10: 最终验证

**Files:**
- 不主动修改文件。若验证暴露问题，只修对应问题。

- [ ] **Step 1: 运行完整测试**

Run: `npm test`

Expected: PASS。

- [ ] **Step 2: 运行 TypeScript build**

Run: `npm run build`

Expected: PASS。

- [ ] **Step 3: 运行前端 build**

Run: `npm run build:dashboard`

Expected: PASS。

- [ ] **Step 4: 重新导出规则 YAML 并检查 diff**

Run: `npm run rulepack:export`

Expected: PASS。diff 只应包含计划内的规则元数据变化。

- [ ] **Step 5: 手工检查关键边界**

Run:

```bash
rg -n "OFFICIAL-LINTER|officialLinter" src/nodes/ruleAgentPromptBuilderNode.ts src/agent/ruleAssistance.ts
rg -n "risk_taxonomy|risk_code" src/nodes/rubricScoringPromptBuilderNode.ts src/agent/opencodeRubricScoring.ts src/scoring
rg -n "decisionTriggers|decision_triggers" src/rules references/rules
```

Expected:

- rule agent prompt 构建路径中没有 Code Linter 结论。
- 风险枚举只进入 rubric scoring prompt 和 scoring normalization。
- 触发条件只出现在规则元数据、YAML 导出和 case constraint evaluator。

- [ ] **Step 6: 如有验证修复则提交**

如果修了问题：

```bash
git add src/rules/engine/ruleTypes.ts src/rules/packs/shared/ruleFactories.ts src/rules/engine/rulePackYamlExporter.ts src/rules/evaluators/caseConstraintEvaluator.ts src/rules/packs/cross-device-adaptation/ruleData.ts src/rules/packs/cross-device-adaptation/must.ts src/types.ts src/scoring/riskTaxonomy.ts src/scoring/scoreFusion.ts src/nodes/scoreFusionOrchestrationNode.ts src/nodes/rubricScoringPromptBuilderNode.ts src/agent/opencodeRubricScoring.ts web/src/pages/scoreConsistencyAnalysis.ts tests/rule-factory.test.ts tests/rule-pack-yaml-export.test.ts tests/case-constraint-evaluator.test.ts tests/rule-pack-registry.test.ts tests/rule-agent-linter-boundary.test.ts tests/rule-merge-node.test.ts tests/risk-taxonomy.test.ts tests/rubric-risk-taxonomy-prompt.test.ts tests/scoring.test.ts tests/score-consistency-analysis.test.ts references/rules references/risks/risk-taxonomy.yaml
git commit -m "fix: stabilize deterministic scoring integration"
```

如果没有修复，不创建空提交。

---

## 自检

需求覆盖：

- Code Linter 不进入 rule agent prompt，只在 merge 阶段进入评分：Task 5 和 Task 10。
- 内置规则 YAML 向用例规则结构靠拢：Task 1、Task 2、Task 4。
- 需要 agent 判定的规则增加明确触发条件：Task 1、Task 3、Task 4。
- 风险归一化写成 YAML，区分低中高，并让 rubric agent 选择：Task 6、Task 7。
- 风险稳定 key 和一致性指标拆分：Task 8、Task 9。
- 未引入新的规则服务、数据库或第二套评分流程。

占位符检查：

- 没有 `TBD`、`TODO`、`implement later`。
- 每个任务都包含明确文件、测试命令、期望结果和提交点。

类型一致性：

- TypeScript 运行时字段为 `decision_triggers`。
- YAML 导出字段为 `decisionTriggers`。
- 风险新增字段限制为 `risk_code`、`risk_category`、`source_rule_id`。
- 现有 `consistencyPercentage`、`risks`、`rule_audit_results` 兼容保留。
