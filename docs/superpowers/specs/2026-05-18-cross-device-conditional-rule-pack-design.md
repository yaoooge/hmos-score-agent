# 一多适配内置条件规则包设计

## 1. 背景

当前评分链路已经具备三类相关能力：

- 任务理解阶段在 `constraintSummary.crossDeviceAdaptation` 中识别一多适配相关性。
- 官方 Code Linter 会在一多相关任务中启用 `plugin:@cross-device-app-dev/recommended`。
- 规则引擎支持内置规则包、用例运行时规则、静态预筛和 `hmos-rule-assessment` agent 辅助判定。

新的需求是将 `/Users/guoyutong/Downloads/通用规则.md` 中的一多适配通用规则改写为 `references/rules/` 下现有 YAML 风格的 `must_rules` / `should_rules` / `forbidden_patterns` 规则包，并将它作为“内置条件规则包”接入用例评测流程。

该规则包不应常开。只有当任务理解 agent 判定当前任务与一多适配相关时，规则审计才启用该规则集。判定方式复用当前 `constraintSummary.crossDeviceAdaptation.applicability === "involved"` 的口径。

## 2. 目标

1. 新增一多适配内置规则包，规则源来自 `通用规则.md`。
2. 将源文件中的 legacy `constraints` 格式改写为现有内置规则 YAML 结构。
3. 保留源规则的核心字段，包括 `id`、`name`、`priority`、`kit`、`rules[].target`、`rules[].llm`。
4. 在代码中注册该规则包，但只在一多相关任务中启用。
5. 规则进入现有 `ruleAuditNode -> ruleAgentPromptBuilderNode -> ruleAssessmentAgentNode -> ruleMergeNode -> scoreFusionOrchestrationNode -> reportGenerationNode` 主链。
6. 一多规则作为内置通用规则展示在 `bound_rule_packs` 与 `rule_audit_results` 中，不进入 `case_rule_results`。

## 3. 非目标

- 不把一多规则作为单个 case 的 `expected_constraints.yaml` 或 `case_rule_results` 处理。
- 不让一多规则在非一多任务中产生候选、扣分或报告噪声。
- 不为本轮实现完整 ArkUI AST 语义分析器。
- 不改变任务理解 agent 的输出 schema。
- 不重构 rule agent 的输入输出协议。
- 不要求将每条一多规则都做成本地确定性判定器。

## 4. 现状

### 4.1 任务理解

`src/agent/opencodeTaskUnderstanding.ts` 与 `src/agent/taskUnderstanding.ts` 已要求任务理解输出：

```ts
crossDeviceAdaptation: {
  applicability: "involved" | "not_involved" | "uncertain";
  confidence: "high" | "medium" | "low";
  reasons: string[];
}
```

当前 involved 触发词已经覆盖：

- 多设备、多端、多屏、跨设备、跨端、一多
- 手机/平板、折叠屏、智慧屏、手表、车机
- 响应式、自适应、断点、横竖屏、窗口尺寸

本次不新增独立分类器，直接复用该字段作为一多规则包启用条件。

### 4.2 规则引擎

当前 `src/rules/engine/rulePackRegistry.ts` 常量注册：

- `arkts-language`
- `arkts-performance`

`runRuleEngine()` 通过 `listRegisteredRules(runtimeRules)` 取全量内置规则和用例运行时规则。现状没有“按任务启用部分内置规则包”的入口。

`case_constraint` evaluator 已支持：

- `targetPatterns`
- `kit`
- `targetChecks`
- `llmPrompt`
- 目标文件筛选
- kit 静态锚点预判
- 将结果稳定送入 `assistedRuleCandidates`

这些能力适合一多规则的首版接入，因为源规则大多需要结合 ArkUI 组件、断点、布局行为和代码上下文做语义判断。

### 4.3 报告

`reportGenerationNode` 当前的 `buildBoundRulePacks()` 会无条件列出所有注册内置规则包，再追加 case pack。启用条件规则包后，它应只列出本次实际启用的内置规则包。

## 5. 规则包格式

新增文件：

```text
references/rules/cross-device-adaptation.yaml
```

顶层结构沿用现有内置规则 YAML：

```yaml
name: HarmonyOS 一多适配通用规则包
version: v1.0.0
summary: 基于一多适配通用规则整理的内部条件规则包，仅在任务理解判定涉及一多适配时启用。
rule_pack_meta:
  pack_id: cross-device-adaptation
  source_name: HarmonyOS-Cross-Device-Adaptation-General-Rules
  source_version: general-rules-2026-05-15
must_rules:
  - id: RSP-MUST-01
    rule: 横向断点划分范围必须符合系统推荐值。检查工程中自定义断点系统...
    detector_kind: case_constraint
    detector_config:
      targetPatterns:
        - "**/*.ets"
      kit:
        - "ArkUI: GridRow / WidthBreakpoint"
      targetChecks:
        - target: "**/*.ets"
          astSignals: []
          llmPrompt: "检查工程中自定义断点系统或 WidthBreakpointType 工具类..."
      llmPrompt: "检查工程中自定义断点系统或 WidthBreakpointType 工具类..."
    fallback_policy: agent_assisted
should_rules: []
forbidden_patterns: []
```

字段映射如下：

| 源字段 | 目标字段 | 说明 |
| --- | --- | --- |
| `id` | `id` / `rule_id` | 保留原 ID，例如 `RSP-MUST-01`、`CMP-SHOULD-01`。 |
| `name` | `rule` 前缀、`rule_name` | 内置运行时结构需要保留名称，辅助 agent 与报告摘要使用。 |
| `priority: P0` | `must_rules` / `rule_source: must_rule` | P0 作为 must rule，可参与硬门槛。 |
| `priority: P1` | `should_rules` / `rule_source: should_rule` | P1 作为 should rule，按规则扣分影响评分。 |
| `kit` | `detector_config.kit` | 保留 ArkUI 组件和 API 锚点，供静态预筛和 agent 使用。 |
| `rules[].target` | `detector_config.targetPatterns` 与 `targetChecks[].target` | 支持多 target。 |
| `rules[].llm` | `detector_config.llmPrompt` 与 `targetChecks[].llmPrompt` | 多 target 时按 target 拼接，同时保留逐 target 原文。 |
| 源注释分组 | 不落 schema | 分组只用于人工审阅，可体现在文件顺序中。 |

首版不主动制造 `forbidden_patterns`。源规则虽然部分语义包含“不得/禁止”，但整体仍是 P0/P1 验收规则，不是简单可正则匹配的禁止模式。除非实现时明确抽出稳定文本判定器，否则 `forbidden_patterns` 保持空数组。

## 6. TypeScript 规则注册

新增目录：

```text
src/rules/packs/cross-device-adaptation/
  must.ts
  should.ts
  forbidden.ts
```

新增共享 factory，或扩展现有 `src/rules/packs/shared/ruleFactories.ts`：

```ts
export function createAgentAssistedTargetRule(input: {
  packId: string;
  ruleSource: "must_rule" | "should_rule";
  ruleId: string;
  ruleName: string;
  summary: string;
  priority: "P0" | "P1";
  kit?: string[];
  targetChecks: Array<{
    target: string;
    llmPrompt: string;
    astSignals?: Array<Record<string, string>>;
  }>;
}): RegisteredRule
```

生成的 `RegisteredRule`：

- `pack_id: "cross-device-adaptation"`
- `rule_source` 根据 P0/P1 映射
- `summary` 使用 `name` 与 `llm` 的精简组合
- `detector_kind: "case_constraint"`
- `detector_config.targetPatterns`
- `detector_config.kit`
- `detector_config.targetChecks`
- `detector_config.llmPrompt`
- `fallback_policy: "agent_assisted"`
- `rule_name` 保留源 `name`
- `priority` 保留源 `priority`
- `is_case_rule` 不设置或为 `false`

虽然复用 `case_constraint` evaluator，但这些规则不是 case rule。`ruleEngine` 和 `ruleAssistance` 当前已经通过 `runtimeRule?.is_case_rule` 区分 case 专属逻辑；一多规则应保持内置规则语义。

## 7. 条件启用设计

### 7.1 规则包选择函数

新增规则包选择函数，例如：

```ts
export const defaultEnabledRulePackIds = ["arkts-language", "arkts-performance"] as const;

export function resolveEnabledRulePackIds(input: {
  crossDeviceAdaptation?: CrossDeviceAdaptationUnderstanding;
}): string[] {
  const packIds = [...defaultEnabledRulePackIds];
  if (input.crossDeviceAdaptation?.applicability === "involved") {
    packIds.push("cross-device-adaptation");
  }
  return packIds;
}
```

选择口径：

- `involved`：启用一多规则包
- `not_involved`：不启用
- `uncertain`：不启用，避免低置信度任务引入无关扣分
- 缺失字段：不启用，并保持现有兼容行为

### 7.2 Registry API

扩展 `rulePackRegistry`：

```ts
export function getRegisteredRulePacks(options?: {
  enabledPackIds?: string[];
}): RegisteredRulePack[]

export function listRegisteredRules(input?: {
  enabledPackIds?: string[];
  runtimeRules?: RegisteredRule[];
}): RegisteredRule[]
```

兼容策略：

- 未传 `enabledPackIds` 时返回默认启用内置包，避免测试与工具调用意外包含条件包。
- 显式传入时只返回指定内置包。
- `runtimeRules` 始终追加，用于用例规则。

如果为了减少改动，也可以保留旧签名并新增 `listRulesForEnabledPacks()`；但最终应让 `runRuleEngine()` 明确收到启用 pack ids。

### 7.3 ruleAuditNode

`ruleAuditNode` 从状态读取：

```ts
const enabledRulePackIds = resolveEnabledRulePackIds({
  crossDeviceAdaptation: state.constraintSummary?.crossDeviceAdaptation,
});
```

然后调用：

```ts
runRuleEngine({
  referenceRoot,
  caseInput,
  taskType,
  runtimeRules: state.caseRuleDefinitions,
  enabledRulePackIds,
});
```

`runRuleEngine()` 返回值新增：

```ts
enabledRulePacks: Array<{
  pack_id: string;
  display_name: string;
}>;
```

并写入 graph state，例如 `enabledRulePacks`。如果不想新增状态字段，也可以在报告节点重新计算；但新增状态字段更利于调试与产物一致性。

### 7.4 Workflow state

在 `ScoreState` 增加：

```ts
enabledRulePacks: Annotation<Array<{ pack_id: string; display_name: string }>>();
```

可选落盘：

```text
intermediate/enabled-rule-packs.json
```

该文件便于远端恢复、问题排查和后续 dashboard 统计。

## 8. Agent 辅助判定

一多规则首版以 agent 辅助判定为主：

1. `case_constraint` evaluator 根据 `targetPatterns` 找目标文件。
2. 通过 `kit` 做组件/API 静态锚点预判。
3. 不在本地直接输出最终满足/不满足。
4. 结果进入 `assistedRuleCandidates`。
5. `hmos-rule-assessment` 根据候选规则、patch、证据文件和 `llm_prompt` 输出最终判定。

候选中应包含：

- `rule_id`
- `rule_name`
- `priority`
- `kit`
- `target_checks`
- `llm_prompt`
- `static_precheck`
- `rule_source`

需要注意现有 `ruleAssistance` 中有 case rule 专属后处理逻辑，例如 `candidate.is_case_rule`。一多规则不应触发这类 case-only 逻辑。

## 9. 评分与硬门槛

一多规则作为内置规则进入现有规则融合链路：

- `must_rule` 不满足：按现有 must rule 策略影响评分，并可触发硬门槛。
- `should_rule` 不满足：按现有 should rule 策略扣分或进入人工复核。
- `uncertain`：由 rule merge 回退为 `待人工复核`。
- `not_applicable`：最终为 `不涉及`。

如果现有硬门槛逻辑只识别 ArkTS 或 case rule，需要补充为“任意启用内置 pack 的 `must_rule` 不满足都可进入硬门槛判断”，并确保非一多任务不会因该 pack 未启用而受影响。

## 10. 报告与统计

### 10.1 `bound_rule_packs`

`reportGenerationNode.buildBoundRulePacks()` 改为只展示本次实际启用的内置规则包：

- 非一多任务：
  - `arkts-language`
  - `arkts-performance`
- 一多任务：
  - `arkts-language`
  - `arkts-performance`
  - `cross-device-adaptation`
- 用例规则 pack 仍按现有逻辑追加。

### 10.2 `rule_audit_results`

一多规则最终结果进入通用 `rule_audit_results`。报告可通过 `rule_id` 前缀和 `bound_rule_packs` 识别来源。

### 10.3 `case_rule_results`

一多规则不进入 `case_rule_results`。该字段仍只承载 `expected_constraints.yaml` 派生的 case rule。

### 10.4 规则违反统计

规则违反统计当前消费 `result.json` 中的 `bound_rule_packs`、`rule_audit_results` 与 `rule_violations`。一多规则进入通用字段后，统计链路无需新增独立数据源。

## 11. YAML 导出

`rulePackYamlMetadataByPackId` 增加：

```ts
"cross-device-adaptation": {
  name: "HarmonyOS 一多适配通用规则包",
  version: "v1.0.0",
  summary: "基于一多适配通用规则整理的内部条件规则包，仅在任务理解判定涉及一多适配时启用。",
  source_name: "HarmonyOS-Cross-Device-Adaptation-General-Rules",
  source_version: "general-rules-2026-05-15",
}
```

`npm run rulepack:export` 应生成或更新：

```text
references/rules/cross-device-adaptation.yaml
```

由于该 pack 是条件启用，但仍是内置规则包，YAML 导出工具应包含它，便于规则审阅和版本管理。

## 12. 测试策略

### 12.1 规则包 YAML

新增或扩展 `tests/rule-pack-yaml-export.test.ts`：

- 导出结果包含 `cross-device-adaptation`。
- YAML 顶层 key 仍为既有结构。
- P0 源规则进入 `must_rules`。
- P1 源规则进入 `should_rules`。
- `detector_config` 保留 `targetPatterns`、`kit`、`targetChecks`、`llmPrompt`。
- `forbidden_patterns` 为数组，首版可为空。

### 12.2 规则包选择

新增规则包选择测试：

- `applicability: involved` 时返回 `cross-device-adaptation`。
- `not_involved` 时不返回。
- `uncertain` 时不返回。
- 缺失 `constraintSummary` 时不返回。

### 12.3 ruleAuditNode / ruleEngine

新增测试覆盖：

- 一多任务启用 pack 后，`staticRuleAuditResults` 包含一多规则 ID。
- 非一多任务不包含一多规则 ID。
- 一多规则进入 `assistedRuleCandidates`。
- 一多候选包含 `kit`、`target_checks`、`llm_prompt`。
- 一多规则不被标记为 `is_case_rule`。

### 12.4 报告

扩展 `tests/score-agent.test.ts` 或 `reportGenerationNode` 相关测试：

- 一多任务 `bound_rule_packs` 包含 `cross-device-adaptation`。
- 非一多任务 `bound_rule_packs` 不包含该 pack。
- `case_rule_results` 不包含一多规则。

### 12.5 任务理解

现有 parser 与 opencode task understanding 测试已经覆盖一多关键词。补充或确认以下输入维持 involved：

- 一多适配
- 响应式布局
- 断点
- 折叠屏
- 窗口尺寸变化

## 13. 风险与缓解

### 13.1 候选量过大

`通用规则.md` 中规则数量较多，且多数首版都需要 agent 判定。一多任务可能显著增加 rule agent 输入规模。

缓解：

- 只在 involved 时启用。
- 复用 `targetPatterns` 和 `kit` 静态预判，后续可按 `static_precheck.signal_status` 做候选排序或裁剪。
- 如果输入过大，再引入每类规则上限或优先级分批。

### 13.2 误触发一多规则

任务理解误判 involved 会引入无关规则。

缓解：

- `uncertain` 不启用。
- 继续保持“普通 HarmonyOS、ArkUI 页面布局不自动触发”的 prompt 约束。
- 报告中展示 `constraintSummary.crossDeviceAdaptation.reasons` 便于排查。

### 13.3 复用 `case_constraint` 命名带来语义混淆

一多内置规则复用 `case_constraint` evaluator，但不是 case rule。

缓解：

- 类型上不设置 `is_case_rule`。
- 报告上只进入 `rule_audit_results`。
- 可在后续将 detector 名称重命名为更中性的 `targeted_agent_assisted`，本轮不做大重构。

### 13.4 YAML 与 TS 定义漂移

规则需要同时存在 TS 注册和 YAML 导出文件，手工维护可能漂移。

缓解：

- 以 TS 注册为执行事实源。
- `npm run rulepack:export` 生成 YAML。
- 测试校验导出文件与注册规则数量、字段结构一致。

## 14. 实施边界

预计改动：

- `src/rules/packs/cross-device-adaptation/*`
- `src/rules/packs/shared/ruleFactories.ts`
- `src/rules/engine/rulePackRegistry.ts`
- `src/rules/engine/rulePackYamlMetadata.ts`
- `src/rules/ruleEngine.ts`
- `src/nodes/ruleAuditNode.ts`
- `src/workflow/state.ts`
- `src/nodes/reportGenerationNode.ts`
- `references/rules/cross-device-adaptation.yaml`
- `.opencode/skills/hmos-rule-assessment/SKILL.md` 或 prompt 文档按需补充一多规则说明
- 相关 tests

不改动：

- `ConstraintSummary` schema
- `hmos-understanding` 输出字段
- `case_rule_results` 语义
- `expected_constraints.yaml` loader 语义

## 15. 验收标准

1. `npm run rulepack:export` 能生成 `references/rules/cross-device-adaptation.yaml`。
2. 一多相关任务的 `rule_audit_results` 中出现一多规则，非一多任务不出现。
3. 一多相关任务的 `bound_rule_packs` 包含 `cross-device-adaptation`，非一多任务不包含。
4. 一多规则候选进入 `hmos-rule-assessment`，并携带 `kit`、`target_checks`、`llm_prompt`。
5. 一多规则不进入 `case_rule_results`。
6. 已有 ArkTS 规则包和用例规则流程保持兼容。
