# Dashboard 前端与聚合接口设计

Date: 2026-05-13

## Background

当前服务已经具备远程任务接收、异步评分、完成结果查询、规则违反统计和人工复核能力，但缺少一个可视化界面查看执行结果。已有数据主要散落在：

- `<LOCAL_CASE_ROOT>/remote-task-index.json`：远程任务状态、创建时间、更新时间、caseDir、testCaseId 和错误信息。
- `<LOCAL_CASE_ROOT>/rule-violation-stats.json`：已完成任务的静态规则违反聚合快照。
- `caseDir/outputs/result.json`：完成任务的评分结果、总分、任务类型、风险项、hard gate、报告元数据。
- `<HUMAN_REVIEW_EVIDENCE_ROOT>/datasets/human_rating_gap_analyses.jsonl`：人工评级与自动评分差异分析结果。

本设计新增同仓 Vue3 + Element Plus 前端和只读 Dashboard API。所有前端专用接口统一使用 `/dashboard/xxx` 前缀。

## Goals

- 新增可部署访问的 Dashboard 前端，使用 Vue3、Element Plus 和 ECharts。
- 提供三个一级菜单：评测任务、用例报表、结果分析。
- 评测任务展示已接收、正在执行、正在排队、已执行任务列表，包含 `taskId`、名称、分数等基础信息，不展示报告详情。
- 评测任务顶部增加概览，展示每个状态的任务个数和每个任务类型的任务个数。
- 用例报表展示每日任务个数、完成/失败趋势、平均分趋势、已完成任务分数分布区间。
- 结果分析展示人工评分差异分析和负向结果分析。
- 新增 `/dashboard/xxx` 只读后端聚合接口，避免前端直接扫描本地文件或逐个调用结果接口。
- 新增前端服务启动和构建脚本，部署后可访问 Dashboard 页面。

## Non-Goals

- 不实现报告详情页，不嵌入或跳转 `outputs/report.html`。
- 不新增任务创建、取消、重试、人工复核提交等写操作。
- 不改写 `outputs/result.json`、人工复核产物或规则统计索引。
- 不引入数据库。首版本继续基于现有文件索引和评分产物聚合。
- 不新增鉴权体系。继续沿用当前服务无额外鉴权的部署前提。
- 不做跨实例聚合。Dashboard 只展示当前服务实例可读到的本地数据。

## Recommended Approach

采用“前后端同仓 + Express 托管前端构建产物 + `/dashboard/xxx` 聚合 API”的方案。

优点：

- 复用当前服务部署模型，一个 Node 进程同时提供评分 API、Dashboard API 和前端页面。
- Dashboard API 能集中处理文件读取、坏数据容错、分页、筛选和统计，前端保持简单。
- 不需要新增数据库或单独前端服务进程，部署成本低。
- 后续若需要独立部署前端，Vite 构建产物和 `/dashboard/xxx` API 也能平滑拆分。

## Directory Layout

新增目录建议：

```text
hmos-score-agent/
  web/
    index.html
    package.json
    vite.config.ts
    tsconfig.json
    src/
      main.ts
      App.vue
      router/
      api/
      layouts/
      pages/
        TaskDashboard.vue
        CaseReports.vue
        ResultAnalysis.vue
      components/
        EChartPanel.vue
        MetricCard.vue
        TaskStatusTag.vue
      styles/
  src/
    dashboard/
      dashboardTypes.ts
      dashboardDataStore.ts
      dashboardAggregates.ts
      dashboardHandlers.ts
    api/
      app.ts
      apiDefinitions.ts
```

`web/` 是前端应用边界。`src/dashboard/` 是后端 Dashboard 聚合边界，不把聚合逻辑塞进 `src/api/app.ts`。

## Frontend Architecture

前端使用：

- Vue3 + TypeScript。
- Vite 作为开发服务器和构建工具。
- Element Plus 作为组件库。
- Vue Router 使用 hash history 管理三个菜单页面，避免浏览器直达页面时和 `/dashboard/xxx` API 路由冲突。
- ECharts 渲染报表图表。
- 原生 `fetch` 或轻量 API client，统一请求 `/dashboard/xxx`。

布局采用运维控制台式结构：

- 顶部栏：服务名称、健康状态、刷新按钮、当前时间范围提示。
- 左侧菜单：评测任务、用例报表、结果分析。
- 主内容区：顶部筛选和概览，下面是表格或图表。

页面路由：

| 路由 | 菜单 | 组件 |
| --- | --- | --- |
| `/dashboard/#/` | 默认跳转 | `/tasks` |
| `/dashboard/#/tasks` | 评测任务 | `TaskDashboard.vue` |
| `/dashboard/#/reports` | 用例报表 | `CaseReports.vue` |
| `/dashboard/#/analysis` | 结果分析 | `ResultAnalysis.vue` |

### 评测任务页

顶部展示两组概览：

- 状态概览：已接收、正在执行、正在排队、已执行、失败。
- 类型概览：`full_generation`、`continuation`、`bug_fix`、远端原始类型、`unknown`。

状态映射：

| UI 分类 | 后端状态 |
| --- | --- |
| 已接收 | `preparing` |
| 正在执行 | `running` |
| 正在排队 | `queued` |
| 已执行 | `completed` |
| 失败 | `failed`、`timed_out` |

任务表格字段：

- `taskId`
- `testCaseId`
- `name`
- `status`
- `taskType`
- `score`
- `hardGateTriggered`
- `createdAt`
- `updatedAt`
- `error`

筛选项：

- 状态分类。
- 任务类型。
- 分数区间。
- 关键词，匹配 `taskId`、`testCaseId`、任务名称。
- 时间范围，默认最近 7 天；也支持全部。

表格不展示报告详情。完成任务可显示基础评分信息，但不提供完整报告入口。

### 用例报表页

图表全部使用 ECharts，通过 `EChartPanel` 组件统一封装：

- 初始化和销毁 ECharts 实例。
- `ResizeObserver` 或窗口 resize 自适应。
- loading、empty、error 状态。
- 标准高度和响应式宽度。

报表内容：

- 每日任务数：柱状图，展示接收任务总数。
- 每日完成/失败数：堆叠柱状图，展示 completed 与 failed/timed_out。
- 平均分趋势：折线图，仅统计有有效分数的 completed 任务。
- 分数分布：柱状图，区间固定为 `0-59`、`60-69`、`70-79`、`80-89`、`90-100`。

筛选项：

- 时间范围。
- 任务类型。
- 是否只统计 completed 任务。分数相关图表固定只统计 completed 且分数可用的任务。

### 结果分析页

使用 Element Plus Tabs：

- 人工评分差异分析。
- 负向结果分析。

人工评分差异分析表格字段：

- `taskId`
- `testCaseId`
- `caseName`
- `reviewedAt`
- `reviewer`
- `manualRating`
- `autoScore`
- `autoRating`
- `primaryConclusion`
- `confidence`
- `reasonSummary`
- `recommendedActions`

负向结果分析展示：

- 失败任务列表：`failed`、`timed_out`，展示错误信息。
- 低分任务列表：默认 `score < 70`。
- hard gate 触发任务列表。
- 风险项聚合：按 `risk.level` 聚合 high/medium/low 数量，列出高风险任务。
- 规则违反 Top 列表：复用 `rule-violation-stats.json` 的规则聚合结果。

负向结果定义：

- 执行失败或超时。
- 完成但无有效 `result.json`。
- 完成且总分 `< 70`。
- `overall_conclusion.hard_gate_triggered === true`。
- 存在 high 风险项。
- 存在静态规则违反。

## Dashboard API

所有接口统一挂在 `/dashboard` 前缀，只读，不产生评分副作用。

### GET /dashboard/summary

用途：提供评测任务页顶部概览。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `from` | ISO datetime | 可选，按任务创建时间过滤。 |
| `to` | ISO datetime | 可选，按任务创建时间过滤。 |

响应：

```json
{
  "success": true,
  "generatedAt": "2026-05-13T10:00:00.000Z",
  "statusCounts": {
    "received": 3,
    "running": 1,
    "queued": 2,
    "completed": 20,
    "failed": 1
  },
  "taskTypeCounts": [
    { "taskType": "full_generation", "count": 12 },
    { "taskType": "continuation", "count": 8 },
    { "taskType": "bug_fix", "count": 4 },
    { "taskType": "unknown", "count": 3 }
  ],
  "scoreSummary": {
    "completedWithScore": 20,
    "averageScore": 82.4,
    "minScore": 45,
    "maxScore": 98
  }
}
```

### GET /dashboard/tasks

用途：分页查询任务列表。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | 可选，`received`、`running`、`queued`、`completed`、`failed`。 |
| `taskType` | string | 可选，按任务类型过滤。 |
| `keyword` | string | 可选，匹配 taskId、testCaseId、名称。 |
| `scoreMin` | number | 可选。 |
| `scoreMax` | number | 可选。 |
| `from` | ISO datetime | 可选，按创建时间过滤。 |
| `to` | ISO datetime | 可选，按创建时间过滤。 |
| `page` | number | 默认 1。 |
| `pageSize` | number | 默认 20，最大 100。 |
| `sortBy` | string | 默认 `updatedAt`。允许 `createdAt`、`updatedAt`、`score`、`taskId`。 |
| `sortOrder` | string | 默认 `desc`，允许 `asc`、`desc`。 |

响应：

```json
{
  "success": true,
  "page": 1,
  "pageSize": 20,
  "total": 42,
  "items": [
    {
      "taskId": 88,
      "testCaseId": 188,
      "name": "电视台云服务新增全屏播放",
      "status": "completed",
      "statusCategory": "completed",
      "taskType": "bug_fix",
      "score": 88,
      "hardGateTriggered": false,
      "createdAt": "2026-05-13T08:30:00.000Z",
      "updatedAt": "2026-05-13T08:42:00.000Z",
      "resultAvailable": true
    }
  ]
}
```

### GET /dashboard/tasks/status-counts

用途：只取状态计数，供前端局部刷新。返回结构与 `/dashboard/summary.statusCounts` 一致。

### GET /dashboard/reports/daily

用途：每日任务趋势。

查询参数：

- `from`
- `to`
- `taskType`

响应：

```json
{
  "success": true,
  "items": [
    {
      "date": "2026-05-13",
      "received": 10,
      "completed": 8,
      "failed": 1,
      "queued": 1,
      "averageScore": 84.5
    }
  ]
}
```

### GET /dashboard/reports/score-distribution

用途：已完成任务分数区间统计。

查询参数：

- `from`
- `to`
- `taskType`

响应：

```json
{
  "success": true,
  "buckets": [
    { "label": "0-59", "min": 0, "max": 59, "count": 2 },
    { "label": "60-69", "min": 60, "max": 69, "count": 4 },
    { "label": "70-79", "min": 70, "max": 79, "count": 8 },
    { "label": "80-89", "min": 80, "max": 89, "count": 12 },
    { "label": "90-100", "min": 90, "max": 100, "count": 6 }
  ]
}
```

### GET /dashboard/analysis/human-rating-gaps

用途：查询人工评分差异分析结果。

查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `from` | ISO datetime | 可选，按 reviewedAt 过滤。 |
| `to` | ISO datetime | 可选，按 reviewedAt 过滤。 |
| `manualRating` | string | 可选，`L1` 到 `L6`。 |
| `primaryConclusion` | string | 可选。 |
| `page` | number | 默认 1。 |
| `pageSize` | number | 默认 20，最大 100。 |

响应：

```json
{
  "success": true,
  "page": 1,
  "pageSize": 20,
  "total": 3,
  "skippedRows": 0,
  "items": [
    {
      "taskId": 88,
      "testCaseId": 188,
      "caseName": "电视台云服务新增全屏播放",
      "reviewedAt": "2026-05-13T09:00:00.000Z",
      "reviewer": "alice",
      "manualRating": "L1",
      "manualBasis": "无法编译运行。",
      "autoScore": 92,
      "autoRating": "L5",
      "primaryConclusion": "scoring_system_needs_improvement",
      "confidence": "medium",
      "reasonSummary": "自动评分漏判编译失败。",
      "humanNeedsImprovement": false,
      "scoringNeedsImprovement": true,
      "recommendedActions": ["补充构建失败 hard gate。"]
    }
  ]
}
```

### GET /dashboard/analysis/negative-results

用途：查询负向结果分析。

查询参数：

- `from`
- `to`
- `taskType`
- `scoreThreshold`，默认 70。

响应：

```json
{
  "success": true,
  "summary": {
    "failedTaskCount": 1,
    "lowScoreTaskCount": 4,
    "hardGateTaskCount": 2,
    "highRiskTaskCount": 3,
    "violatedRuleCount": 5
  },
  "failedTasks": [],
  "lowScoreTasks": [],
  "hardGateTasks": [],
  "riskLevelCounts": [
    { "level": "high", "count": 3 },
    { "level": "medium", "count": 8 },
    { "level": "low", "count": 12 }
  ],
  "topRuleViolations": [
    {
      "pack_id": "arkts-language",
      "rule_id": "ARKTS-LANG-001",
      "rule_summary": "禁止使用 ArkTS 不支持的语法。",
      "violationCount": 3,
      "affectedTaskIds": [88, 89, 90]
    }
  ]
}
```

## Backend Data Flow

Dashboard 聚合流程：

1. `dashboardDataStore` 通过 `RemoteTaskRegistry.list()` 读取所有任务记录。
2. 对任务记录批量补充完成结果摘要：
   - 读取 `caseDir/outputs/result.json`。
   - 提取 `basic_info.task_type`、`basic_info.case_name` 或其他名称字段、`overall_conclusion.total_score`、`hard_gate_triggered`、`risks`。
   - 单个结果读取失败时只标记该任务，不让整个接口失败。
3. 从 `ruleViolationStatsStore.listRuns()` 获取规则违反聚合基础数据。
4. 从 `human_rating_gap_analyses.jsonl` 读取人工评分差异分析，按行解析。
5. `dashboardAggregates` 负责纯函数聚合：状态计数、类型计数、日报、分数分布、负向结果。
6. `dashboardHandlers` 负责 Express handler、查询参数校验、分页、排序和错误响应。

为支持任务列表和未完成任务类型概览，`RemoteTaskRegistry` 需要扩展记录字段并新增只读方法。

新增记录字段：

```ts
type RemoteTaskRecord = {
  taskId: number;
  status: RemoteTaskRecordStatus;
  createdAt: number;
  updatedAt: number;
  caseDir?: string;
  token?: string;
  testCaseId?: number;
  testCaseName?: string;
  testCaseType?: string;
  error?: string;
};
```

`createRunRemoteTaskHandler()` 在任务进入 `preparing` 和接受成功后写入 `testCaseName`、`testCaseType`。历史记录没有这些字段时，Dashboard 使用下文定义的名称和类型回退规则。

新增只读方法：

```ts
list(): Promise<RemoteTaskRecord[]>;
```

该方法按 `taskId` 或 `createdAt` 稳定排序返回记录，不改变现有 `get()` 和 `upsert()` 行为。

## Error Handling

后端：

- 查询参数非法返回 `400`，说明具体字段。
- 索引文件不存在时返回空集合，不视为错误。
- 单个任务 `result.json` 缺失、非法 JSON 或字段缺失时，该任务返回 `resultAvailable: false`、`score: null`、`resultError`。
- JSONL 某一行解析失败时跳过，并在响应中返回 `skippedRows`。
- 未预期文件系统错误返回 `500`，日志记录实际错误，响应使用稳定 message。

前端：

- 所有页面提供 loading 状态。
- 空数据展示 Element Plus empty。
- API 失败展示 `ElMessage` 和页面内错误提示。
- 图表数据为空时不渲染空坐标轴，展示空状态。
- 表格分页请求失败时保留上一页数据，并提示刷新失败。

## Deployment and Scripts

根 `package.json` 增加脚本：

```json
{
  "scripts": {
    "dev:dashboard": "npm --prefix web run dev",
    "build:dashboard": "npm --prefix web run build",
    "preview:dashboard": "npm --prefix web run preview",
    "build:all": "npm run build && npm run build:dashboard"
  }
}
```

`web/package.json` 增加前端脚本：

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview --host 0.0.0.0"
  }
}
```

前端依赖要求：

- 运行依赖：Vue 3、Vue Router 4、Element Plus 2、ECharts 5 或其兼容后续版本。
- 开发依赖：Vite、`@vitejs/plugin-vue`、TypeScript、`vue-tsc`，版本在实施时按当前稳定兼容版本解析。

Express 生产托管：

- `npm run build:dashboard` 输出 `web/dist`。
- `createApp()` 中注册 `/dashboard` 静态资源托管。
- `/dashboard/xxx` API 路由必须优先于静态资源托管注册。
- 访问地址：`http://<host>:<PORT>/dashboard/`。

开发模式：

- 后端：`npm run dev:api`。
- 前端：`npm run dev:dashboard`。
- Vite dev server 代理 `/dashboard/summary` 等 API 到 `http://localhost:3000`。

部署脚本需要更新构建阶段：

```bash
npm --prefix "${APP_DIR}" ci
npm --prefix "${APP_DIR}/web" ci
npm --prefix "${APP_DIR}" run build
npm --prefix "${APP_DIR}" run build:dashboard
systemctl restart hmos-score-agent.service
```

部署完成后，通过同一个后端服务访问：

```text
http://<server-host>:3000/dashboard/
```

## Testing

后端测试：

- `RemoteTaskRegistry.list()` 能读取并稳定排序所有任务。
- `/dashboard/summary` 返回正确状态计数和类型计数。
- `/dashboard/tasks` 支持分页、状态筛选、任务类型筛选、关键词、分数区间和排序。
- `/dashboard/reports/daily` 正确按日期聚合任务数、完成数、失败数和平均分。
- `/dashboard/reports/score-distribution` 正确落入固定分数区间。
- `/dashboard/analysis/human-rating-gaps` 正确读取 JSONL、分页、过滤，并统计坏行。
- `/dashboard/analysis/negative-results` 正确识别失败、低分、hard gate、高风险和规则违反。
- 单个 `result.json` 缺失或坏 JSON 不导致接口整体失败。

前端验证：

- `npm run build:dashboard` 通过。
- API client 格式化和查询参数拼接可用。
- `EChartPanel` 在空数据、loading 和正常数据下渲染状态正确。
- 任务表格在窄屏下不发生文字重叠，关键列可横向滚动。

端到端手工验收：

1. 启动 `npm run dev:api`。
2. 启动 `npm run dev:dashboard`。
3. 打开 Vite 输出的本地地址，确认三个菜单可访问。
4. 构建 `npm run build:all`。
5. 启动 `npm start`。
6. 访问 `http://localhost:3000/dashboard/`，确认页面和 `/dashboard/xxx` API 均可用。

## Implementation Notes

- Dashboard API 使用现有 CORS 中间件即可。
- `/dashboard/` 静态页面和 `/dashboard/xxx` API 前缀重合时，路由注册顺序必须明确：API handler 先注册，静态资源后注册。前端使用 hash history，不需要 Express history fallback。
- 时间过滤统一使用任务 `createdAt`，人工评分差异使用 `reviewedAt`。
- `createdAt`、`updatedAt` 当前是毫秒时间戳，API 输出统一转换为 ISO 字符串。
- 任务名称优先级：`result.json.basic_info.case_name`、`remoteTaskRecord.testCaseName`、`Task <taskId>`。
- 任务类型优先级：`result.json.basic_info.task_type`、`remoteTaskRecord.testCaseType`、`unknown`。

## Open Decisions Resolved

- 布局采用运维控制台式布局。
- 前端使用 Vue3 + Element Plus。
- 报表图表使用 ECharts。
- 所有前端接口统一使用 `/dashboard/xxx`。
- 需要前端启动脚本，并支持部署后通过 `/dashboard/` 访问。
