# 一致性分析详情下载与报告展示设计

## 背景

一致性分析任务会基于同一份远端任务 JSON 连续执行 10 次评分。当前详情页可以查看运行对比、规则不满足报表和风险项报表，但单次“原始结果”只展示 JSON 文本，任务级结果也缺少一键导出能力。

## 目标

1. 在一致性分析任务详情页提供任务级下载按钮。
2. 下载内容包含 10 条运行的原始评分结果 JSON，以及本次一致性任务的分析结果。
3. 将运行表格里的“原始结果”展示优化为渲染后的评分报告，复用评分任务列表中的报告展示逻辑和样式。
4. 重新运行一致性任务时，以数组形式保留每轮运行完成后的分析结果，支持图表比较多轮运行后的稳定性变化。
5. 当前运行对比表格去掉“主要结论”列，减少横向拥挤。

## 方案选择

采用详情页顶栏下载 + 行内查看报告方案。

任务详情顶栏增加“下载 10 条 JSON”按钮，和“刷新状态”“重新运行”并列。运行对比表保留现有结构，但移除“主要结论”列，操作列的“原始结果”改为“查看报告”。点击单次运行时打开报告抽屉，渲染内容与评分任务列表的用例报告一致。

这个方案改动范围最小：下载是任务级动作，放在详情顶栏；单次运行报告仍从运行行进入，符合现有表格操作路径。

## 数据结构

下载文件使用一个 JSON 对象承载任务元信息、分析结果和运行结果：

```json
{
  "task": {
    "id": "C-001",
    "originalTaskId": 1306,
    "caseId": 188,
    "caseName": "用例名称",
    "createdAt": "2026-05-20T00:00:00.000Z",
    "status": "completed",
    "serviceBaseUrl": "http://..."
  },
  "analysis": {
    "summary": {},
    "ruleReport": [],
    "riskReport": []
  },
  "analysisHistory": [
    {
      "round": 1,
      "capturedAt": "2026-05-20T00:10:00.000Z",
      "summary": {},
      "ruleReport": [],
      "riskReport": []
    }
  ],
  "runs": [
    {
      "runIndex": 0,
      "taskId": 13060101,
      "status": "completed",
      "summary": {},
      "resultData": {}
    }
  ]
}
```

其中：

- `analysis.summary` 使用当前 `analyzeConsistency` 的结果。
- `analysis.ruleReport` 使用当前规则不满足报表。
- `analysis.riskReport` 使用当前风险项报表。
- `analysisHistory` 是每轮运行完成后的分析快照数组，用于跨轮对比。
- `runs[].summary` 使用当前运行摘要，便于快速排查。
- `runs[].resultData` 是远端 `/score/remote-tasks/:taskId/result` 返回的原始 `resultData`。

如果某次运行未完成或结果不可用，下载仍保留该运行条目，并写入 `error`，避免因为单条失败导致整个导出不可用。

一致性任务持久化记录增加 `analysisHistory` 字段，类型为数组。每个元素包含：

- `round`：从 1 开始递增的运行轮次。
- `capturedAt`：该轮所有 10 次运行进入终态时的时间。
- `summary`：该轮 `analyzeConsistency` 的结果。
- `ruleReport`：该轮规则不满足报表。
- `riskReport`：该轮风险项报表。
- `runs`：该轮 10 次运行的摘要快照，不包含完整 `resultData`，避免本地持久化记录膨胀。

兼容旧数据：没有 `analysisHistory` 的历史任务加载时使用空数组；当任务已有完成结果且用户再次刷新到终态时，可补写当前轮快照。

重新运行时不覆盖历史轮次：

- 点击“重新运行”前，如果当前运行已形成终态但尚未写入历史，先记录一条当前轮快照。
- 新一轮运行重置当前 `runs`，继续复用现有派生 taskId 规则。
- 新一轮 10 次运行全部进入终态后追加新的 `analysisHistory` 条目。
- 若用户在运行中多次刷新，只有从“未完成”变为“本轮终态”时追加一次，避免重复快照。

## UI 行为

详情页头部按钮：

- “下载 10 条 JSON”：点击后加载当前任务所有运行的结果，并带上当前分析结果与历史分析结果，生成本地 JSON 文件并触发浏览器下载。
- 加载期间按钮显示 loading。
- 文件名格式为 `consistency-<taskId>-results.json`，例如 `consistency-C-001-results.json`。

历史图表：

- 在详情页指标卡片下方增加一行图表区，复用 `EChartPanel`。
- 图表展示每轮运行后的 `consistencyPercentage`、`averageScore`、`scoreStandardDeviation`、`averageRuleUnsatisfactionRatio`、`averageRiskCount`。
- 横轴为 `第 1 轮`、`第 2 轮` 等，tooltip 中展示捕获时间和完成/失败次数。
- 当历史少于 2 轮时显示空态或单点图，避免误导为趋势。

运行对比表：

- 去掉 `主要结论` 列。
- 操作列按钮文案从“原始结果”改为“查看报告”。
- 点击后优先使用页面缓存的 `resultData`；缓存缺失时请求远端结果。
- 成功后用 `buildCaseReportViewModel` 生成报告视图模型，并复用评分任务列表里的报告渲染组件。
- 失败时在抽屉内展示错误提示。

## 组件拆分

将评分任务列表中当前内联的用例报告抽屉内容提取为可复用组件：

- `web/src/components/CaseReportDrawer.vue`
- 输入：`modelValue`、`title`、`loading`、`error`、`report`
- 输出：`update:modelValue`、`refresh`

`TaskDashboard.vue` 和 `ConsistencyAnalysis.vue` 都使用该组件。报告格式化函数和样式随组件迁移，避免两处复制维护。

## 错误处理

- 下载时逐条请求运行结果，单条失败记录到对应 `runs[].error`，并继续处理其他运行。
- 如果所有运行都没有可下载的 `resultData`，仍下载包含分析结果和错误信息的 JSON，同时通过消息提示用户结果不完整。
- 查看报告失败时保留抽屉打开状态，展示错误提示。
- 历史快照追加失败时不阻断刷新或重新运行，但通过消息提示保存失败；下一次刷新可根据当前终态补写缺失快照。

## 测试

新增或调整前端单元级测试，覆盖：

- 构造一致性任务导出 JSON 时包含分析结果、规则报表、风险报表和每条运行结果。
- 构造一致性任务导出 JSON 时包含 `analysisHistory`。
- 单条运行结果请求失败时导出仍包含该运行错误，并保留其他成功结果。
- 重新运行前后会追加历史快照，并且重复刷新不会重复追加同一轮快照。
- 历史图表数据由 `analysisHistory` 派生，比例类指标按百分比展示。
- 运行对比表不再渲染“主要结论”列。
- 报告视图模型继续由 `buildCaseReportViewModel` 生成，保证与评分任务列表渲染路径一致。

构建验证：

- 运行 `npm --prefix web run build`。
