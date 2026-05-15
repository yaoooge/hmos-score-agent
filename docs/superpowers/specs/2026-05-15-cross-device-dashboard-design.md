# 一多适配管理台设计

日期：2026-05-15

## 背景

当前管理台已有三个一级菜单：

- 评测任务：查看任务状态、任务列表和运行日志。
- 用例报表：查看任务趋势和分数分布。
- 结果分析：查看人工评分差异、负向结果和风险项分析。

一多适配目前由任务理解智能体在 `constraintSummary.crossDeviceAdaptation` 中识别，结果会被 `officialCodeLinterNode` 消费用于决定是否启用 `plugin:@cross-device-app-dev/recommended`。相关数据分散在：

- `caseDir/intermediate/constraint-summary.json`：一多识别结果，包含 `applicability`、`confidence`、`reasons`。
- `caseDir/outputs/result.json`：总分、任务类型、风险项、官方代码检查器摘要、官方代码检查器规则结果。
- `caseDir/intermediate/code-linter/summary.json`：官方代码检查器实际启用规则集和运行状态。
- `<HUMAN_REVIEW_EVIDENCE_ROOT>/datasets/risk_review_calibrations.jsonl`：人工风险项复核样本。
- `<LOCAL_CASE_ROOT>/remote-task-index.json`：任务状态、caseDir、任务名称和时间信息。

现有管理台聚合逻辑只读取 `outputs/result.json` 的基础评分信息，不读取一多识别产物，也没有按一多相关任务过滤规则违背和风险项。因此需要新增一个独立菜单用于分析一多相关用例的结果。

## 目标

- 新增一级菜单“一多适配”，页面结构参考现有“结果分析”的 `el-tabs` 组织方式。
- 只展示一多相关用例，即 `crossDeviceAdaptation.applicability === "involved"` 的任务。
- 页签 1 展示一多相关用例列表，支持按名称、`taskId`、`testCaseId` 搜索。
- 一多用例列表不展示识别状态列，避免用户在主列表里重复判断“是否一多”。
- 用例名称可点击跳转到评分结果；行详情可打开右侧抽屉查看一多原因、官方代码检查器状态、规则命中和风险摘要。
- 页签 2 展示一多相关用例里的规则违背结果，默认聚焦 `@cross-device-app-dev/*` 官方规则。
- 页签 3 展示一多相关用例里的风险项分析，结构与现有结果分析的风险项分析一致。
- 新增管理台专用只读接口，前端不直接扫描本地文件。
- 保持首版低风险：不改评分主流程，不改 `outputs/result.json` schema，不引入数据库。

## 非目标

- 不新增任务重跑、人工复核提交、规则配置修改等写操作。
- 不在一多用例列表中展示 `involved/not_involved/uncertain` 识别状态。
- 不展示非一多相关用例。
- 不改变任务理解智能体的识别逻辑。
- 不改变官方代码检查器的启用逻辑或评分扣分逻辑。
- 不要求历史缺失 `constraint-summary.json` 的任务被补录或回写。
- 不新增复杂图表；首版以可筛选表格和抽屉明细为主。

## 推荐方案

新增“一多适配”一级菜单和 `CrossDeviceAnalysis.vue` 页面。页面内部使用三个页签：

1. 一多用例
2. 规则违背
3. 风险项分析

后端新增 `src/dashboard/crossDeviceDataStore.ts` 和 `src/dashboard/crossDeviceAggregates.ts`，在 `createDashboardRouter()` 中挂载以下接口：

- `GET /dashboard/cross-device/cases`
- `GET /dashboard/cross-device/rule-violations`
- `GET /dashboard/cross-device/risk-review-calibrations`

所有接口共享一个“一多相关任务集合”口径：读取 registry 中的任务，定位 `caseDir/intermediate/constraint-summary.json`，仅保留 `crossDeviceAdaptation.applicability === "involved"` 的任务。后续规则违背和风险项都基于这个任务集合过滤。

## 导航

新增路由：

| 路由 | 菜单 | 组件 |
| --- | --- | --- |
| `/dashboard/#/cross-device` | 一多适配 | `CrossDeviceAnalysis.vue` |

`App.vue` 新增菜单项：

```text
评测任务
用例报表
结果分析
一多适配
```

页面标题：

```text
一多适配
用例结果、规则违背和风险项分析
```

标题栏右侧复用现有全局日期范围和刷新机制。日期范围应用于三个页签；各页签有自己的本地筛选和分页状态。

## 页面布局

```text
┌────────────────────────────────────────────────────────────────────┐
│ 一多适配                                      [日期范围] [刷新]     │
│ 用例结果、规则违背和风险项分析                                      │
├────────────────────────────────────────────────────────────────────┤
│ 页签： 一多用例  |  规则违背  |  风险项分析                         │
├────────────────────────────────────────────────────────────────────┤
│ 当前页签内容                                                         │
└────────────────────────────────────────────────────────────────────┘
```

### 页签一：一多用例

主列表只展示一多相关用例，不展示识别状态。

```text
┌────────────────────────────────────────────────────────────────────┐
│ [名称 / taskId / testCaseId 搜索]                                  │
├────────┬──────────────────────┬──────────┬──────┬────────┬────────┤
│ taskId │ 名称                  │ 类型      │ 分数 │ 状态   │ 更新时间 │
├────────┼──────────────────────┼──────────┼──────┼────────┼────────┤
│ 10231  │ 手机平板一多适配...    │ bug_fix  │ 72   │ 已完成 │ 05-15  │
│ 10244  │ 响应式首页布局...      │ full_gen │ 86   │ 已完成 │ 05-15  │
└────────┴──────────────────────┴──────────┴──────┴────────┴────────┘
```

表格列：

- `taskId`
- `testCaseId`
- `name`
- `taskType`
- `score`
- `status`
- `updatedAt`
- `crossDeviceFindingCount`
- `riskCount`
- 操作：详情

交互：

- 搜索框匹配 `taskId`、`testCaseId`、`name`。
- 点击名称跳转评分结果，复用现有负向结果分析中的 `buildScoringResultUrl(taskId)` 逻辑。
- 点击详情或行操作打开右侧抽屉。
- 分页与筛选由后端接口处理，不只过滤当前页。

详情抽屉：

```text
┌──────────────────────── 用例详情 #10231 ────────────────────────┐
│ 基本信息：名称 / taskType / score / 状态 / testCaseId / 更新时间  │
│                                                                  │
│ 一多原因                                                         │
│ - 需求明确要求手机和平板布局适配                                  │
│                                                                  │
│ 官方代码检查器                                                    │
│ 状态：success                                                     │
│ 一多规则集：已启用                                                 │
│ 命中数：15                                                        │
│                                                                  │
│ 高频违背规则                                                     │
│ @cross-device-app-dev/font-size             12 处命中            │
│ @cross-device-app-dev/one-multi-breakpoint  3 处命中             │
│                                                                  │
│ 风险摘要                                                         │
│ high: 1 / medium: 2 / low: 0                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 页签二：规则违背

展示一多相关用例中的规则违背聚合。默认只统计 `source_rule_set === "plugin:@cross-device-app-dev/recommended"` 或 rule id 以 `@cross-device-app-dev/` 开头的官方规则。

```text
┌────────────────────────────────────────────────────────────────────┐
│ [规则关键词搜索] [包含其他规则]                                     │
├────────────────────────────────────┬────────┬────────────┬─────────┤
│ 规则                                │ 次数   │ 影响用例数  │ 最近命中 │
├────────────────────────────────────┼────────┼────────────┼─────────┤
│ @cross-device-app-dev/font-size     │ 24     │ 18         │ 05-15   │
│ @cross-device-app-dev/size-unit     │ 17     │ 14         │ 05-14   │
│ @cross-device-app-dev/breakpoint... │ 9      │ 7          │ 05-13   │
└────────────────────────────────────┴────────┴────────────┴─────────┘
```

表格列：

- `ruleId`
- `ruleSummary`
- `sourceRuleSet`
- `severity`
- `violationCount`
- `affectedTaskCount`
- `affectedTaskIds`
- `lastViolatedAt`

交互：

- 规则关键词搜索匹配 `ruleId`、`ruleSummary`。
- 默认只展示一多官方规则。
- `包含其他规则` 打开后，展示一多相关用例中所有 `rule_audit_results` 或官方代码检查器规则违背，用于观察 ArkTS、性能、安全等规则是否也集中影响一多任务。
- 点击影响用例数可在抽屉中展示相关任务列表，名称可跳转评分结果。

数据口径：

- 官方一多规则违背优先读取 `outputs/result.json.official_linter_results`。
- 若需要包含其他规则，读取 `outputs/result.json.rule_audit_results` 中 `result === "不满足"` 的规则。
- 只统计页签一的一多相关任务集合。
- 官方代码检查器只输出命中结果，不输出显式“满足”。首版只展示违背聚合，不在该页签展示规则符合个数。

### 页签三：风险项分析

复用现有结果分析的风险项表格结构，但后端先按一多相关任务过滤。

```text
┌────────────────────────────────────────────────────────────────────┐
│ [名称 / taskId 搜索] [人工同意 v] [风险等级 v]                       │
├────────┬──────────┬──────────────────┬────────┬──────────┬────────┤
│ taskId │ testCase │ 名称              │ 等级   │ 风险标题  │ 人工同意 │
├────────┼──────────┼──────────────────┼────────┼──────────┼────────┤
│ 10231  │ 8831     │ 手机平板适配...   │ high   │ 布局风险  │ 不同意   │
└────────┴──────────┴──────────────────┴────────┴──────────┴────────┘
```

表格列与现有风险项分析保持一致：

- `taskId`
- `testCaseId`
- `caseName`
- `resultRisk.level`
- `resultRisk.title`
- `humanReview.agreeWithResultLevel` 或 `humanReview.agree`
- `humanReview.correctedLevel`
- `humanReview.reason` 或 `humanReview.comment`

筛选：

- `keyword`：匹配 `taskId`、`testCaseId`、`caseName`。
- `agreement`：`agreed`、`disagreed`。
- `riskLevel`：`high`、`medium`、`low`。

数据口径：

- 读取 `<HUMAN_REVIEW_EVIDENCE_ROOT>/datasets/risk_review_calibrations.jsonl`。
- 只保留 `taskId` 属于一多相关任务集合的记录。
- 缺少 `caseName` 时，用任务索引中的名称补齐。

## 后端接口

### `GET /dashboard/cross-device/cases`

查询参数：

- `page`：正整数，默认 `1`
- `pageSize`：正整数，默认 `20`，最大 `100`
- `keyword`：可选字符串
- `from`：可选 ISO 时间戳
- `to`：可选 ISO 时间戳
- `taskType`：可选字符串
- `scoreMin`：可选数字
- `scoreMax`：可选数字
- `sortBy`：可选值为 `updatedAt`、`score`、`taskId`，默认 `updatedAt`
- `sortOrder`：可选值为 `asc`、`desc`，默认 `desc`

响应：

```ts
type CrossDeviceCaseListResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  items: CrossDeviceCaseItem[];
};

type CrossDeviceCaseItem = {
  taskId: number;
  testCaseId?: number;
  name: string;
  status: string;
  statusCategory: "received" | "queued" | "running" | "completed" | "failed";
  taskType: string;
  score: number | null;
  hardGateTriggered: boolean | null;
  createdAt: string;
  updatedAt: string;
  resultAvailable: boolean;
  reasons: string[];
  officialLinterRunStatus?: string;
  crossDeviceRuleSetApplied: boolean;
  crossDeviceFindingCount: number;
  riskCount: number;
  topRuleViolations: Array<{
    ruleId: string;
    sourceRuleSet: string;
    findingCount: number;
  }>;
  riskLevelCounts: Array<{ level: string; count: number }>;
};
```

### `GET /dashboard/cross-device/rule-violations`

查询参数：

- `page`：正整数，默认 `1`
- `pageSize`：正整数，默认 `50`，最大 `200`
- `keyword`：可选字符串
- `from`：可选 ISO 时间戳
- `to`：可选 ISO 时间戳
- `includeOtherRules`：可选布尔字符串，传 `true` 时包含非一多规则

响应：

```ts
type CrossDeviceRuleViolationsResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  summary: {
    relatedCaseCount: number;
    violatedRuleCount: number;
    totalViolationEvents: number;
  };
  items: Array<{
    ruleId: string;
    ruleSummary?: string;
    sourceRuleSet?: string;
    severity?: string;
    violationCount: number;
    affectedTaskCount: number;
    affectedTaskIds: number[];
    lastViolatedAt: string;
  }>;
};
```

### `GET /dashboard/cross-device/risk-review-calibrations`

查询参数：

- `page`：正整数，默认 `1`
- `pageSize`：正整数，默认 `20`，最大 `100`
- `keyword`：可选字符串
- `agreement`：可选值为 `agreed | disagreed`
- `riskLevel`：可选值为 `high | medium | low`
- `from`：可选 ISO 时间戳
- `to`：可选 ISO 时间戳

响应条目结构与 `/dashboard/analysis/risk-review-calibrations` 保持一致，但数据集会先过滤到一多相关任务。

```ts
type CrossDeviceRiskReviewCalibrationsResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  skippedRows: number;
  items: RiskReviewCalibrationDashboardItem[];
};
```

## 数据模型

在 `src/dashboard/dashboardTypes.ts` 或新的 `src/dashboard/crossDeviceTypes.ts` 中新增管理台专用类型：

```ts
type CrossDeviceRelatedTask = {
  taskId: number;
  testCaseId?: number;
  caseDir: string;
  name: string;
  taskType: string;
  status: string;
  statusCategory: DashboardStatusCategory;
  score: number | null;
  hardGateTriggered: boolean | null;
  createdAt: string;
  updatedAt: string;
  resultJson?: Record<string, unknown>;
  constraintSummary: {
    crossDeviceAdaptation: {
      applicability: "involved";
      confidence: "high" | "medium" | "low";
      reasons: string[];
    };
  };
};
```

该类型只表达 `applicability: "involved"` 的任务，因为非一多任务不属于这个页面的展示范围。

## 历史数据处理

没有 `caseDir` 或缺少 `intermediate/constraint-summary.json` 的任务不进入一多适配页面。这样可以保持页面口径清晰：这里只展示当前工作流明确识别为一多相关的任务。

如果某个已完成任务的 `official_linter_summary.configuredRuleSets` 包含 `plugin:@cross-device-app-dev/recommended`，但缺少 `constraint-summary.json`，首版仍然排除该任务。这样可以避免把历史推断数据和智能体明确识别结果静默混在一起。后续可以再增加“包含历史推断数据”开关。

格式不合法的 JSON 文件只跳过对应任务或数据集行。接口响应仍保持成功，只统计有效记录。

## 前端结构

新增：

- `web/src/pages/CrossDeviceAnalysis.vue`
- 在 `web/src/api/dashboard.ts` 中新增一多适配接口类型和请求函数
- 在 `web/src/router/index.ts` 中新增路由
- 在 `web/src/App.vue` 中新增菜单项、标题和副标题处理

`CrossDeviceAnalysis.vue` 为每个页签维护独立状态：

- 一多用例：`casePage`、`casePageSize`、`caseFilters`
- 规则违背：`rulePage`、`rulePageSize`、`ruleFilters`
- 风险项分析：`riskPage`、`riskPageSize`、`riskFilters`

页面初次挂载时可以像当前 `ResultAnalysis.vue` 一样加载三个页签，也可以先加载当前页签并在切换时再加载其他页签。首版推荐按当前页签懒加载，减少本地 case 根目录较大时的文件扫描成本。

## 后端结构

新增 `src/dashboard/crossDeviceDataStore.ts`：

- `listCrossDeviceRelatedTasks(registry)`:
  - 读取 registry 任务记录
  - 读取 `outputs/result.json`
  - 读取 `intermediate/constraint-summary.json`
  - 只返回 `crossDeviceAdaptation.applicability === "involved"` 的任务
- `readCrossDeviceRuleViolations(tasks, options)`:
  - 从 `official_linter_results` 提取官方一多规则命中
  - 按参数从 `rule_audit_results` 补充其他违背规则
- `readCrossDeviceRiskReviewDataset(root, relatedTaskNameIndex, relatedTaskIds)`:
  - 读取 `risk_review_calibrations.jsonl`
  - 按一多相关 `taskId` 过滤数据行

新增 `src/dashboard/crossDeviceAggregates.ts`：

- `filterCrossDeviceCases`
- `sortCrossDeviceCases`
- `buildCrossDeviceRuleViolationStats`
- `filterCrossDeviceRiskReviewCalibrations`

保持 `dashboardHandlers.ts` 中的路由处理函数简短。路由只负责解析查询参数、调用一多适配数据读取和聚合辅助函数、分页并返回 JSON。

## 错误处理

- `page` 或 `pageSize` 不合法：返回 `400`。
- `sortBy` 或 `sortOrder` 不合法：返回 `400`。
- `agreement` 不合法：返回 `400`。
- `riskLevel` 不合法：返回 `400`。
- 单个任务缺少可选文件：跳过缺失明细，接口响应仍保持成功。
- 非单任务可选产物范围内的意外文件系统或解析错误：返回 `500` 和简短错误信息。

## 测试

后端测试放在 `tests/dashboard-api.test.ts`：

- 一多用例接口只返回 `crossDeviceAdaptation.applicability === "involved"` 的任务。
- 一多用例接口支持按名称、`taskId`、`testCaseId` 关键词搜索。
- 一多用例接口支持分数区间和日期范围筛选。
- 规则违背接口只聚合一多相关任务。
- 规则违背接口默认只展示一多官方规则。
- 规则违背接口只有在 `includeOtherRules=true` 时才包含非一多规则。
- 风险项复核接口只保留一多相关 `taskId` 的风险项记录。
- 风险项复核接口支持关键词、人工同意状态和风险等级筛选。
- 查询参数不合法时返回 `400`。

前端验证：

- `npm --prefix web run build`
- 手动确认 `/dashboard/#/cross-device` 能渲染三个页签。
- 手动确认标题栏刷新按钮会重新加载当前页签。
- 手动确认点击用例名称会跳转到评分结果地址。
- 手动确认详情抽屉能展示一多原因、官方代码检查器状态、规则结果和风险摘要。

后端定向验证：

```bash
node --import tsx --test tests/dashboard-api.test.ts
```

## 验收标准

- 侧边栏新增“一多适配”菜单项。
- 新页面包含三个页签：“一多用例”、“规则违背”、“风险项分析”。
- “一多用例”只列出明确满足 `crossDeviceAdaptation.applicability === "involved"` 的任务。
- “一多用例”不展示适用性或识别状态列。
- 点击用例名称会打开现有评分结果地址。
- 用例详情抽屉展示一多原因、官方代码检查器状态、高频违背规则和风险摘要。
- “规则违背”只聚合一多相关任务中的违背规则。
- “规则违背”默认展示一多官方规则，并可选择包含其他违背规则。
- “风险项分析”展示与现有结果分析页一致的风险项字段，并过滤到一多相关任务。
- 所有筛选和分页都由后端接口基于完整数据集处理。
- 现有管理台路由和结果分析行为保持不变。
