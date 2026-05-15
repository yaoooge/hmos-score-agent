# 一多适配管理台设计

Date: 2026-05-15

## Background

当前管理台已有三个一级菜单：

- 评测任务：查看任务状态、任务列表和运行日志。
- 用例报表：查看任务趋势和分数分布。
- 结果分析：查看人工评分差异、负向结果和风险项分析。

一多适配目前由任务理解 agent 在 `constraintSummary.crossDeviceAdaptation` 中识别，结果会被 `officialCodeLinterNode` 消费用于决定是否启用 `plugin:@cross-device-app-dev/recommended`。相关数据分散在：

- `caseDir/intermediate/constraint-summary.json`：一多识别结果，包含 `applicability`、`confidence`、`reasons`。
- `caseDir/outputs/result.json`：总分、任务类型、风险项、官方 linter 摘要、官方 linter 规则结果。
- `caseDir/intermediate/code-linter/summary.json`：官方 linter 实际启用规则集和运行状态。
- `<HUMAN_REVIEW_EVIDENCE_ROOT>/datasets/risk_review_calibrations.jsonl`：人工风险项复核样本。
- `<LOCAL_CASE_ROOT>/remote-task-index.json`：任务状态、caseDir、任务名称和时间信息。

现有 dashboard 聚合逻辑只读取 `outputs/result.json` 的基础评分信息，不读取一多识别产物，也没有按一多相关任务过滤规则违背和风险项。因此需要新增一个独立菜单用于分析一多相关用例的结果。

## Goals

- 新增一级菜单“一多适配”，页面结构参考现有“结果分析”的 `el-tabs` 组织方式。
- 只展示一多相关用例，即 `crossDeviceAdaptation.applicability === "involved"` 的任务。
- 页签 1 展示一多相关用例列表，支持按名称、`taskId`、`testCaseId` 搜索。
- 一多用例列表不展示识别状态列，避免用户在主列表里重复判断“是否一多”。
- 用例名称可点击跳转到评分结果；行详情可打开右侧抽屉查看一多原因、linter 状态、规则命中和风险摘要。
- 页签 2 展示一多相关用例里的规则违背结果，默认聚焦 `@cross-device-app-dev/*` 官方规则。
- 页签 3 展示一多相关用例里的风险项分析，结构与现有结果分析的风险项分析一致。
- 新增 dashboard 专用只读接口，前端不直接扫描本地文件。
- 保持首版低风险：不改评分主流程，不改 `outputs/result.json` schema，不引入数据库。

## Non-Goals

- 不新增任务重跑、人工复核提交、规则配置修改等写操作。
- 不在一多用例列表中展示 `involved/not_involved/uncertain` 识别状态。
- 不展示非一多相关用例。
- 不改变任务理解 agent 的识别逻辑。
- 不改变官方 Code Linter 的启用逻辑或评分扣分逻辑。
- 不要求历史缺失 `constraint-summary.json` 的任务被补录或回写。
- 不新增复杂图表；首版以可筛选表格和抽屉明细为主。

## Recommended Approach

新增“一多适配”一级菜单和 `CrossDeviceAnalysis.vue` 页面。页面内部使用三个页签：

1. 一多用例
2. 规则违背
3. 风险项分析

后端新增 `src/dashboard/crossDeviceDataStore.ts` 和 `src/dashboard/crossDeviceAggregates.ts`，在 `createDashboardRouter()` 中挂载以下接口：

- `GET /dashboard/cross-device/cases`
- `GET /dashboard/cross-device/rule-violations`
- `GET /dashboard/cross-device/risk-review-calibrations`

所有接口共享一个“一多相关任务集合”口径：读取 registry 中的任务，定位 `caseDir/intermediate/constraint-summary.json`，仅保留 `crossDeviceAdaptation.applicability === "involved"` 的任务。后续规则违背和风险项都基于这个任务集合过滤。

## Navigation

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

## Page Layout

```text
┌────────────────────────────────────────────────────────────────────┐
│ 一多适配                                      [日期范围] [刷新]     │
│ 用例结果、规则违背和风险项分析                                      │
├────────────────────────────────────────────────────────────────────┤
│ Tabs:  一多用例  |  规则违背  |  风险项分析                         │
├────────────────────────────────────────────────────────────────────┤
│ 当前页签内容                                                         │
└────────────────────────────────────────────────────────────────────┘
```

### Tab 1: 一多用例

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
│ 官方 Linter                                                      │
│ status: success                                                  │
│ cross-device rule set: enabled                                   │
│ finding count: 15                                                │
│                                                                  │
│ Top 违背规则                                                     │
│ @cross-device-app-dev/font-size             12 findings          │
│ @cross-device-app-dev/one-multi-breakpoint  3 findings           │
│                                                                  │
│ 风险摘要                                                         │
│ high: 1 / medium: 2 / low: 0                                     │
└──────────────────────────────────────────────────────────────────┘
```

### Tab 2: 规则违背

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
- `包含其他规则` 打开后，展示一多相关用例中所有 `rule_audit_results` 或官方 linter 规则违背，用于观察 ArkTS、性能、安全等规则是否也集中影响一多任务。
- 点击影响用例数可在抽屉中展示相关任务列表，名称可跳转评分结果。

数据口径：

- 官方一多规则违背优先读取 `outputs/result.json.official_linter_results`。
- 若需要包含其他规则，读取 `outputs/result.json.rule_audit_results` 中 `result === "不满足"` 的规则。
- 只统计 Tab 1 的一多相关任务集合。
- 官方 linter 只输出 finding，不输出显式“满足”。首版只展示违背聚合，不在该页签展示规则符合个数。

### Tab 3: 风险项分析

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

## Backend API

### `GET /dashboard/cross-device/cases`

Query:

- `page`: positive integer, default `1`
- `pageSize`: positive integer, default `20`, max `100`
- `keyword`: optional string
- `from`: optional ISO timestamp
- `to`: optional ISO timestamp
- `taskType`: optional string
- `scoreMin`: optional number
- `scoreMax`: optional number
- `sortBy`: `updatedAt`、`score`、`taskId`, default `updatedAt`
- `sortOrder`: `asc`、`desc`, default `desc`

Response:

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

Query:

- `page`: positive integer, default `1`
- `pageSize`: positive integer, default `50`, max `200`
- `keyword`: optional string
- `from`: optional ISO timestamp
- `to`: optional ISO timestamp
- `includeOtherRules`: optional boolean-like string, `true` enables non-cross-device rules

Response:

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

Query:

- `page`: positive integer, default `1`
- `pageSize`: positive integer, default `20`, max `100`
- `keyword`: optional string
- `agreement`: optional `agreed | disagreed`
- `riskLevel`: optional `high | medium | low`
- `from`: optional ISO timestamp
- `to`: optional ISO timestamp

Response keeps the same item shape as `/dashboard/analysis/risk-review-calibrations`, with the dataset filtered to one-to-many related tasks.

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

## Data Model

Add dashboard-only types in `src/dashboard/dashboardTypes.ts` or a new `src/dashboard/crossDeviceTypes.ts`:

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

The type deliberately only represents `applicability: "involved"` because non-involved tasks are outside this page's scope.

## Historical Data Handling

Tasks without `caseDir` or without `intermediate/constraint-summary.json` are not included in the one-to-many page. This keeps the page semantically clean: it only shows tasks that the current workflow explicitly identified as one-to-many related.

If a completed task has `official_linter_summary.configuredRuleSets` containing `plugin:@cross-device-app-dev/recommended` but is missing `constraint-summary.json`, it is still excluded in the first version. This avoids silently mixing inferred historical data with explicit agent decisions. A later enhancement can add an opt-in "包含历史推断数据" switch.

Malformed JSON files are skipped for the affected task or dataset row. API responses should remain successful and include counts from valid records only.

## Frontend Architecture

Add:

- `web/src/pages/CrossDeviceAnalysis.vue`
- Cross-device API types and fetchers in `web/src/api/dashboard.ts`
- Route entry in `web/src/router/index.ts`
- Menu item and title/subtitle handling in `web/src/App.vue`

`CrossDeviceAnalysis.vue` keeps separate state for each tab:

- cases: `casePage`、`casePageSize`、`caseFilters`
- rule violations: `rulePage`、`rulePageSize`、`ruleFilters`
- risk reviews: `riskPage`、`riskPageSize`、`riskFilters`

Initial mount can load all three tabs for consistency with current `ResultAnalysis.vue`, or load the active tab first and lazily load others. The recommended first version is lazy loading by active tab to reduce file scanning cost on large local case roots.

## Backend Architecture

Add `src/dashboard/crossDeviceDataStore.ts`:

- `listCrossDeviceRelatedTasks(registry)`:
  - reads registry records
  - reads `outputs/result.json`
  - reads `intermediate/constraint-summary.json`
  - returns only tasks where `crossDeviceAdaptation.applicability === "involved"`
- `readCrossDeviceRuleViolations(tasks, options)`:
  - extracts official cross-device rule findings from `official_linter_results`
  - optionally includes other violated rules from `rule_audit_results`
- `readCrossDeviceRiskReviewDataset(root, relatedTaskNameIndex, relatedTaskIds)`:
  - reads `risk_review_calibrations.jsonl`
  - filters rows by related `taskId`

Add `src/dashboard/crossDeviceAggregates.ts`:

- `filterCrossDeviceCases`
- `sortCrossDeviceCases`
- `buildCrossDeviceRuleViolationStats`
- `filterCrossDeviceRiskReviewCalibrations`

Keep route handlers in `dashboardHandlers.ts` small. They should parse query params, call the cross-device store/aggregate helpers, paginate, and return JSON.

## Error Handling

- Invalid `page` or `pageSize`: return `400`.
- Invalid `sortBy` or `sortOrder`: return `400`.
- Invalid `agreement`: return `400`.
- Invalid `riskLevel`: return `400`.
- Missing files for individual tasks: skip unavailable detail and keep the API response successful.
- Unexpected file system or parsing errors outside per-task optional artifacts: return `500` with a concise message.

## Testing

Backend tests in `tests/dashboard-api.test.ts`:

- One-to-many case API returns only tasks with `crossDeviceAdaptation.applicability === "involved"`.
- Case API supports keyword search by name, `taskId`, and `testCaseId`.
- Case API supports score range and date range filters.
- Rule violation API aggregates only one-to-many related tasks.
- Rule violation API defaults to cross-device official rules.
- Rule violation API includes non-cross-device rules only when `includeOtherRules=true`.
- Risk review API filters risk review rows to one-to-many related task ids.
- Risk review API supports keyword, agreement, and risk level filters.
- Invalid query values return `400`.

Frontend verification:

- `npm --prefix web run build`
- Manual check that `/dashboard/#/cross-device` renders the three tabs.
- Manual check that title bar refresh reloads the active tab.
- Manual check that clicking a case name navigates to the scoring result URL.
- Manual check that the details drawer opens and displays reasons, linter status, rules, and risk summary.

Targeted backend verification:

```bash
node --import tsx --test tests/dashboard-api.test.ts
```

## Acceptance Criteria

- The sidebar has a new “一多适配” menu item.
- The new page uses three tabs: “一多用例”, “规则违背”, “风险项分析”.
- “一多用例” only lists tasks with explicit `crossDeviceAdaptation.applicability === "involved"`.
- “一多用例” does not show an applicability or recognition-status column.
- Case name click opens the existing scoring result URL.
- Case details drawer shows one-to-many reasons, official linter status, top violated rules, and risk summary.
- “规则违背” aggregates violated rules only from one-to-many related tasks.
- “规则违背” defaults to cross-device official rules and can optionally include other violated rules.
- “风险项分析” shows the same risk review fields as the existing result analysis page, filtered to one-to-many related tasks.
- All filters and pagination are backed by API responses across the full dataset.
- Existing dashboard routes and result analysis behavior remain unchanged.
