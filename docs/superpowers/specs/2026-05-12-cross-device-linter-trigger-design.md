# 多设备适配触发官方 Code Linter 规则集设计

## 1. 背景

当前主评分 workflow 已接入任务理解和官方 Code Linter：

```text
remoteTaskPreparationNode
-> taskUnderstandingNode
-> inputClassificationNode
-> ruleAuditNode
-> officialCodeLinterNode
-> ruleMergeNode
-> scoreFusionOrchestrationNode
-> reportGenerationNode
```

`taskUnderstandingNode` 调用 `hmos-understanding`，输出 `ConstraintSummary`：

```ts
{
  explicitConstraints: string[];
  contextualConstraints: string[];
  implicitConstraints: string[];
  classificationHints: string[];
}
```

`officialCodeLinterNode` 当前通过 `officialCodeLinterRecommendedRuleSets` 固定启用 4 个推荐规则集：

```text
plugin:@typescript-eslint/recommended
plugin:@security/recommended
plugin:@performance/recommended
plugin:@hw-stylistic/recommended
```

历史设计中特意没有默认接入 `plugin:@cross-device-app-dev/recommended`。原因是多端适配规则只在任务涉及多设备、多屏、多形态布局时有明确评价价值；默认全量开启可能扩大 finding 面，降低评分口径稳定性。

本次功能要求在任务理解阶段让 agent 明确输出当前用例是否涉及“多设备适配”。如果涉及，则在官方 Code Linter 校验时额外启用 `plugin:@cross-device-app-dev/recommended`。

## 2. 目标

1. 任务理解阶段必须产出结构化的多设备适配判定结果。
2. 官方 Code Linter 根据该判定动态追加 `plugin:@cross-device-app-dev/recommended`。
3. 规则集选择过程可追踪、可复现，进入中间产物和报告摘要。
4. 不改变官方 Code Linter 的运行时降级策略、临时工作区策略和变更文件过滤策略。
5. 不让 agent 在 Code Linter 阶段重新判断多设备适配；Code Linter 只消费任务理解阶段已经落入状态的结构化结论。

## 3. 非目标

- 不默认启用 `plugin:@cross-device-app-dev/recommended`。
- 不接入 `plugin:@previewer/recommended`。
- 不新增多设备适配专用 agent。
- 不让 Code Linter 直接读取 prompt 或业务文件来重新推断任务意图。
- 不把未变更文件中的 cross-device finding 暴露到业务产物。
- 不要求 Code Linter 不可用时评分任务失败。

## 4. 判定口径

新增任务理解字段用于表达多设备适配是否适用：

```ts
export type CrossDeviceAdaptationApplicability = "involved" | "not_involved" | "uncertain";

export interface CrossDeviceAdaptationUnderstanding {
  applicability: CrossDeviceAdaptationApplicability;
  confidence: ConfidenceLevel;
  reasons: string[];
}
```

含义：

| 字段值 | 含义 | Code Linter 行为 |
| --- | --- | --- |
| `involved` | prompt、用例名称、工程结构摘要或 patch 摘要明确指向多设备、多屏、多端、多形态适配 | 追加 `plugin:@cross-device-app-dev/recommended` |
| `not_involved` | 当前任务只涉及普通业务、逻辑修复、单页面功能或无设备形态相关诉求 | 不追加 |
| `uncertain` | 输入信息不足，无法稳定判断是否涉及多设备适配 | 不追加，并在 summary 中记录判定不确定 |

首版只在 `applicability === "involved"` 时追加规则集。`uncertain` 不触发，避免因为模型猜测扩大官方 linter 覆盖面。

推荐判定信号：

- 直接关键词：多设备、多端、多屏、多窗口、跨设备、手机/平板/折叠屏/智慧屏/手表/车机等组合表达。
- 布局适配诉求：响应式布局、自适应、断点、横竖屏、窗口尺寸变化、不同设备形态展示。
- HarmonyOS 跨设备能力诉求：分布式能力、跨端协同、设备类型差异化能力入口。
- 用例场景要求同一功能在多个设备形态下可用或展示不同 UI。

反例：

- “设备当前位置”“设备信息”“设备权限”只表示单设备能力或 API，不自动视为多设备适配。
- 普通 ArkTS 适配、TypeScript 到 ArkTS 适配不是本字段的多设备适配。
- 单纯提到 HarmonyOS、ArkUI、页面布局但没有设备形态差异，不自动触发。

## 5. 状态与数据模型

扩展 `ConstraintSummary`：

```ts
export interface ConstraintSummary {
  explicitConstraints: string[];
  contextualConstraints: string[];
  implicitConstraints: string[];
  classificationHints: string[];
  crossDeviceAdaptation: CrossDeviceAdaptationUnderstanding;
}
```

该字段属于任务理解结果，不单独新增 `ScoreState` 顶层字段。原因：

1. 现有后续节点已经通过 `state.constraintSummary` 消费任务理解结果。
2. 多设备适配是任务约束的一部分，放在 `ConstraintSummary` 内能保持边界清晰。
3. 中间产物 `intermediate/constraint-summary.json` 会自然保留该判定，便于回放。

默认兼容策略：

- 新版 parser 要求 agent 首轮输出包含 `crossDeviceAdaptation`。
- fallback 和 retry draft 必须生成该字段，不能省略。
- 如果历史产物或测试构造缺少该字段，运行时不做静默兼容；测试和 mock 需要显式更新，保证契约收紧后不会被旧格式掩盖。

## 6. 任务理解输出契约

`hmos-understanding` 的 prompt 和 skill 契约需要新增字段要求：

```json
{
  "explicitConstraints": ["目标: 适配手机和平板双端展示"],
  "contextualConstraints": ["模块: entry", "技术栈: ArkTS/ETS 页面与组件实现"],
  "implicitConstraints": ["修改范围: 涉及页面布局和资源引用"],
  "classificationHints": ["full_generation", "multi_device_adaptation"],
  "crossDeviceAdaptation": {
    "applicability": "involved",
    "confidence": "high",
    "reasons": ["需求明确要求手机和平板布局适配"]
  }
}
```

输出约束：

- 顶层只能包含 `explicitConstraints`、`contextualConstraints`、`implicitConstraints`、`classificationHints`、`crossDeviceAdaptation`。
- `crossDeviceAdaptation.reasons` 最多 5 条，每条为中文短句。
- `confidence` 使用既有 `ConfidenceLevel`：`high`、`medium`、`low`。
- 如果判定为 `not_involved`，`reasons` 至少包含一条说明，例如“需求未出现多设备、多屏或设备形态适配要求”。
- 如果判定为 `uncertain`，`confidence` 必须为 `low`，`reasons` 至少说明缺少哪类证据。

retry prompt 不重新分析原始输入，只根据 `constraint_draft` 修正格式。`buildRetryConstraintDraft` 需要把首轮 fallback 中的多设备判定一起写入 draft。

## 7. 规则集选择设计

把当前固定常量拆成基础规则集和条件规则集：

```ts
export const officialCodeLinterBaseRecommendedRuleSets = [
  "plugin:@typescript-eslint/recommended",
  "plugin:@security/recommended",
  "plugin:@performance/recommended",
  "plugin:@hw-stylistic/recommended",
] as const;

export const officialCodeLinterCrossDeviceRecommendedRuleSet =
  "plugin:@cross-device-app-dev/recommended" as const;

export function resolveOfficialCodeLinterRecommendedRuleSets(input: {
  crossDeviceAdaptation?: CrossDeviceAdaptationUnderstanding;
}): string[] {
  const ruleSets = [...officialCodeLinterBaseRecommendedRuleSets];
  if (input.crossDeviceAdaptation?.applicability === "involved") {
    ruleSets.push(officialCodeLinterCrossDeviceRecommendedRuleSet);
  }
  return ruleSets;
}
```

`buildOfficialCodeLinterConfig` 改为接收可选规则集：

```ts
export function buildOfficialCodeLinterConfig(input?: {
  ruleSets?: string[];
}): OfficialCodeLinterConfig {
  return {
    files: ["**/*.ets", "**/*.ts", "**/*.js", "**/*.json", "**/*.json5"],
    ignore: [
      "node_modules/**/*",
      "oh_modules/**/*",
      "build/**/*",
      ".preview/**/*",
      "src/ohosTest/**/*",
      "src/test/**/*",
      "hvigorfile.ts",
      "hvigorfile.js",
      "BuildProfile.ets",
    ],
    ruleSet: input?.ruleSets ?? resolveOfficialCodeLinterRecommendedRuleSets({}),
  };
}
```

`prepareOfficialCodeLinterWorkspace` 当前负责写入 `code-linter.json5`，需要接受 `ruleSets` 参数并传给 config writer。`officialCodeLinterNode` 在准备 workspace 前从 `state.constraintSummary.crossDeviceAdaptation` 解析生效规则集。

## 8. 官方 Linter 节点流程

新流程：

```text
officialCodeLinterNode
-> read state.constraintSummary.crossDeviceAdaptation
-> resolveOfficialCodeLinterRecommendedRuleSets({ crossDeviceAdaptation })
-> prepareOfficialCodeLinterWorkspace({ generatedProjectPath, caseDir, ruleSets })
-> write intermediate/code-linter/code-linter.json5
-> run codelinter
-> parse findings
-> filter by changed files and changed line numbers
-> map effective findings to RuleAuditResult
-> write summary/findings/stdout/stderr/exit-code artifacts
```

`OfficialLinterSummary.configuredRuleSets` 必须使用实际传入 Code Linter 的规则集，而不是默认常量。这样报告和 `summary.json` 能直接说明本次是否启用了 cross-device 规则集。

降级状态也要保留实际计划使用的规则集：

- `not_enabled`
- `not_installed`
- `failed`
- `timeout`
- `invalid_output`

即使未实际执行 CLI，`summary.configuredRuleSets` 也表示本次配置解析结果，便于定位“为什么这次本应或不应启用 cross-device 规则集”。

## 9. Finding 映射与评分

`mapOfficialCodeLinterFindings` 的路径归一化、去重、变更文件过滤无需改变。新增规则集产生的 finding 必须继续遵守已有约束：

- 有 patch 且有 changed files 时，只保留命中变更文件和变更行的 finding。
- 未变更文件 finding 不进入 `officialLinterFindings`。
- 未变更文件 finding 不进入 `officialLinterRuleResults`、`mergedRuleAuditResults`、`result.json` 或报告。
- stdout/stderr 落盘前继续通过 sanitizer，只展示命令级摘要和有效 finding 数。

规则来源映射增加：

```text
@cross-device-app-dev/* -> should_rule
```

评分 profile 必须和现有官方推荐规则集保持同一口径：按推荐规则集展开后的具体 rule id 逐条映射到 rubric 评分项，不能只用 prefix 兜底。

```text
OFFICIAL-LINTER:@cross-device-app-dev/<concrete-rule-1> -> 平台规范符合度 / HarmonyOS工程实践符合度，medium，ratio 0.1
OFFICIAL-LINTER:@cross-device-app-dev/<concrete-rule-2> -> 布局与交互适配相关 rubric item，medium，ratio 0.1
...
```

实现要求：

- 从当前接入的官方 Code Linter 版本中取得 `plugin:@cross-device-app-dev/recommended` 展开的完整 rule id 清单，并把清单固化到 `officialLinterRuleProfiles.ts` 或同等 profile 数据源。
- 每个 cross-device rule id 都必须显式声明 `metricNames`、`severity`、`ratio`，映射到现有 rubric item；同一 rule 可以映射多个 rubric item，但不能缺省。
- `findOfficialLinterRuleProfile` 继续只按精确 rule id 查找。首版不新增 prefix profile，也不允许 `<unknown-rule>` 静默参与扣分。
- 如果运行时出现未登记的 `@cross-device-app-dev/*` finding，应保留为 `RuleAuditResult` 和报告 evidence，但不参与 rule impact 扣分，并在 diagnostics 中标记 profile missing，推动补齐逐条映射。

扣分边界：

- 默认不触发 hard gate。
- 单个评分子项累计扣分上限沿用官方 linter 现有上限策略，不超过该子项基础分的 30%。
- 如果某条 cross-device 规则被证明是严重平台适配风险，再在该具体 rule profile 中单独提高 severity 或绑定 hard gate。

## 10. 报告与产物

已有 `official_linter_summary` 和 HTML 官方 Linter 区域应展示实际生效规则集。新增字段不需要单独扩展报告 schema，只要 `configuredRuleSets` 包含条件规则集即可。

需要确认以下产物：

```text
intermediate/constraint-summary.json
  crossDeviceAdaptation

intermediate/code-linter/code-linter.json5
  ruleSet 包含或不包含 plugin:@cross-device-app-dev/recommended

intermediate/code-linter/summary.json
  configuredRuleSets 与 code-linter.json5 一致

outputs/result.json
  official_linter_summary.configuredRuleSets 与 summary.json 一致

outputs/report.html
  官方 Linter 区域展示实际 configuredRuleSets
```

## 11. 兼容恢复流程

`runPreparedScoreWorkflow` 会从已预处理状态恢复执行，并跳过 `taskUnderstandingNode`。因此 prepared state 必须包含新版 `constraintSummary.crossDeviceAdaptation`。

兼容策略：

- 新的 prepared state schema 必须要求该字段。
- 如果外部调用方传入旧 prepared state，`officialCodeLinterNode` 视为 `not_involved`，不追加 cross-device 规则集，并在 `summary.diagnostics` 追加“cross-device applicability missing; treated as not_involved”。
- 正常从头执行的 workflow 不允许缺字段，因为任务理解 parser 会校验。

## 12. 测试策略

### 12.1 任务理解 parser

新增测试：

- agent 输出 `crossDeviceAdaptation.involved` 时解析成功。
- 缺少 `crossDeviceAdaptation` 时 protocol error。
- `applicability` 非枚举值时报错。
- `uncertain` 但 `confidence !== "low"` 时拒绝。
- `reasons` 为空时拒绝。

### 12.2 prompt contract

更新 `opencode-task-understanding.test.ts`：

- 首轮 prompt 明确要求判断是否涉及多设备适配。
- retry prompt 的 `constraint_draft` 包含 `crossDeviceAdaptation`。
- mock 输出全部包含新字段。

### 12.3 任务理解节点

更新 `task-understanding-node.test.ts`：

- `constraint-summary.json` 持久化新字段。
- 多设备 prompt 的 mock 返回 `involved`，节点结果保留该字段。

### 12.4 Code Linter 配置

更新 `official-code-linter-config.test.ts`：

- 基础规则集仍然只有 4 个。
- `not_involved` 不包含 `plugin:@cross-device-app-dev/recommended`。
- `uncertain` 不包含 `plugin:@cross-device-app-dev/recommended`。
- `involved` 包含 `plugin:@cross-device-app-dev/recommended`，且顺序为基础 4 个后追加。
- `serializeOfficialCodeLinterConfig` 输出包含新增规则集。

### 12.5 Code Linter 节点

更新 `official-code-linter-node.test.ts`：

- 当 `state.constraintSummary.crossDeviceAdaptation.applicability === "involved"`，workspace 下 `code-linter.json5` 包含 cross-device 规则集。
- `officialLinterSummary.configuredRuleSets` 与 config 文件一致。
- 当字段缺失的 prepared state 进入节点，不追加规则集，诊断说明按 `not_involved` 处理。

### 12.6 评分 profile

更新 `official-linter-rule-profiles.test.ts`：

- expected recommended rule id 清单加入 `plugin:@cross-device-app-dev/recommended` 展开的所有具体 rule id。
- 每个 `@cross-device-app-dev/<concrete-rule>` 都有显式 profile，且 `metricNames` 指向现有 rubric item。
- `OFFICIAL-LINTER:@cross-device-app-dev/<unknown-rule>` 不命中 profile，不产生 rule impact 扣分。
- 其他已有精确 rule id 行为不变。

## 13. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| agent 误判多设备适配 | 额外启用规则集，可能产生不相关 finding | 只有 `involved` 触发；`uncertain` 不触发；prompt 中给出反例 |
| 旧 mock 或历史 prepared state 缺字段 | 测试或恢复流程失败 | 从头执行严格校验；prepared state 缺字段在 linter 节点降级为 not_involved |
| cross-device 官方 rule id 不稳定 | 具体 profile 需要随官方版本维护 | 固化当前官方版本的 recommended 展开清单；未知 rule 只展示 evidence 和 diagnostics，不静默扣分 |
| finding 命中历史文件 | 影响非本次改动评分 | 沿用现有 changed-file 和 changed-line 过滤 |
| summary 与实际 config 不一致 | 排查困难 | ruleSets 在 node 内解析一次，并同时传给 config writer 与 summary |

## 14. 推荐实施顺序

1. 扩展类型和 parser schema，先让任务理解输出契约变严格。
2. 更新 prompt、retry draft 和 fallback，保证 agent 正常输出新字段。
3. 拆分官方 Code Linter 规则集解析函数，新增 cross-device 条件规则集。
4. 将 ruleSets 参数贯穿 config writer、workspace preparer 和 official linter node。
5. 增加 `@cross-device-app-dev/*` 的 rule source，并为 cross-device recommended 展开的每条具体 rule id 增加 scoring profile。
6. 更新报告/结果相关测试，确认 `configuredRuleSets` 反映实际配置。
7. 运行针对性测试和全量测试。

## 15. 验收标准

- 多设备适配用例的 `constraint-summary.json` 包含：

```json
{
  "crossDeviceAdaptation": {
    "applicability": "involved",
    "confidence": "high",
    "reasons": ["需求明确要求手机和平板布局适配"]
  }
}
```

- 多设备适配用例的 `intermediate/code-linter/code-linter.json5` 包含：

```text
plugin:@cross-device-app-dev/recommended
```

- 非多设备适配用例不包含该规则集。
- `summary.json`、`result.json` 和 HTML 报告展示的 configured rule sets 与 `code-linter.json5` 一致。
- Code Linter 不可用、失败或超时时，流程仍按现有降级策略完成。
- 所有官方 linter finding 仍只对本次变更范围生效。
- `plugin:@cross-device-app-dev/recommended` 展开的每条已知 rule id 都有逐条 rubric profile 映射；未知 cross-device rule 不扣分但会进入 diagnostics。
