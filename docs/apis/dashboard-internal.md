# Dashboard 内部查询接口

本页记录 `/dashboard/*` 路由，供 `web/` 前端维护和 AI 编码查询使用。这些接口不作为远端平台对外契约提供，变更时优先以 `src/dashboard/dashboardHandlers.ts` 和 `web/src/api/dashboard.ts` 为准。

## 范围

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/dashboard/summary` | 汇总任务状态、任务类型和分数概览。 |
| `GET` | `/dashboard/tasks` | 分页查询任务列表。 |
| `GET` | `/dashboard/tasks/status-counts` | 查询任务状态计数。 |
| `GET` | `/dashboard/tasks/:taskId/logs` | 查询任务运行日志尾部内容。 |
| `GET` | `/dashboard/reports/daily` | 查询按天聚合的任务报告。 |
| `GET` | `/dashboard/reports/score-distribution` | 查询分数分布桶。 |
| `GET` | `/dashboard/analysis/human-rating-gaps` | 查询人工评级差异分析数据集。 |
| `POST` | `/dashboard/analysis/human-rating-gaps/manual-analysis-status` | 批量更新人工评级差异分析的人工处理状态。 |
| `GET` | `/dashboard/analysis/risk-review-calibrations` | 查询风险复核校准数据集。 |
| `POST` | `/dashboard/analysis/risk-review-calibrations/manual-analysis-status` | 批量更新风险复核校准的人工处理状态。 |
| `GET` | `/dashboard/analysis/negative-results` | 查询失败、低分、硬门槛、高风险和规则违反概览。 |
| `GET` | `/dashboard/cross-device/cases` | 查询涉及跨设备适配的任务列表。 |
| `GET` | `/dashboard/cross-device/rule-violations` | 查询跨设备规则违反聚合。 |
| `GET` | `/dashboard/cross-device/risk-review-calibrations` | 查询跨设备相关风险复核校准样本。 |

## 通用响应

成功响应均包含 `success: true`。失败响应通常为：

```json
{
  "success": false,
  "message": "error message"
}
```

分页接口返回 `page`、`pageSize`、`total` 和 `items`。`pageSize` 会被服务端限制在对应接口的最大值内。

## 任务与报表

### `GET /dashboard/summary`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `from` | 按任务创建时间起点过滤。 |
| `to` | 按任务创建时间终点过滤。 |

响应包含 `generatedAt`、`statusCounts`、`taskTypeCounts` 和 `scoreSummary`。

### `GET /dashboard/tasks`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `status` | `received`、`queued`、`running`、`completed`、`failed`。 |
| `taskType` | 按任务类型过滤。 |
| `keyword` | 按任务 ID、测试用例 ID 或名称搜索。 |
| `scoreMin` / `scoreMax` | 按分数区间过滤。 |
| `from` / `to` | 按任务创建时间过滤。 |
| `page` / `pageSize` | 分页，默认 `1` / `20`，`pageSize` 最大 `100`。 |
| `sortBy` | `createdAt`、`updatedAt`、`score`、`taskId`，默认 `updatedAt`。 |
| `sortOrder` | `asc` 或 `desc`，默认 `desc`。 |

### `GET /dashboard/tasks/status-counts`

无查询参数。响应包含 `statusCounts`。

### `GET /dashboard/tasks/:taskId/logs`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `tailBytes` | 日志尾部字节数，默认 `65536`，最大 `1048576`。 |

响应包含 `status`、`logPath`、`available`、`truncated`、`tailBytes` 和 `content`，不会暴露真实 case 目录。

### `GET /dashboard/reports/daily`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `taskType` | 按任务类型过滤。 |
| `from` / `to` | 按任务创建时间过滤。 |

响应 `items` 为按日期聚合的任务数和平均分。

### `GET /dashboard/reports/score-distribution`

可选查询参数同 `/dashboard/reports/daily`。响应 `buckets` 为分数区间分布。

## 分析数据集

### `GET /dashboard/analysis/human-rating-gaps`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `from` / `to` | 按人工评级复核时间过滤。 |
| `manualRating` | 按人工评级过滤，例如 `L1`。 |
| `primaryConclusion` | 按差异归因结论过滤。 |
| `keyword` | 按任务、用例或文本内容搜索。 |
| `manualAnalysisStatus` | `pending` 或 `analyzed`。 |
| `page` / `pageSize` | 分页，默认 `1` / `20`，`pageSize` 最大 `100`。 |

响应包含 `skippedRows` 和差异分析样本 `items`。

### `POST /dashboard/analysis/human-rating-gaps/manual-analysis-status`

请求体：

```json
{
  "taskIds": [88, 89],
  "status": "analyzed"
}
```

`status` 必须是 `pending` 或 `analyzed`。响应包含 `updated` 和 `missing`。

### `GET /dashboard/analysis/risk-review-calibrations`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `keyword` | 按任务、用例或风险文本搜索。 |
| `agreement` | `agreed` 或 `disagreed`。 |
| `manualAnalysisStatus` | `pending` 或 `analyzed`。 |
| `page` / `pageSize` | 分页，默认 `1` / `100`，`pageSize` 最大 `500`。 |

响应包含 `skippedRows` 和风险复核样本 `items`。

### `POST /dashboard/analysis/risk-review-calibrations/manual-analysis-status`

请求体：

```json
{
  "items": [
    { "taskId": 88, "riskId": 1 }
  ],
  "status": "analyzed"
}
```

`status` 必须是 `pending` 或 `analyzed`。响应包含 `updated`、`missing` 和 `skipped`；只会更新可人工分析的风险复核样本。

### `GET /dashboard/analysis/negative-results`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `scoreThreshold` | 低分阈值，默认 `70`。 |
| `taskType` | 按任务类型过滤。 |
| `from` / `to` | 按任务创建时间过滤。 |

响应包含失败任务、低分任务、硬门槛任务、风险等级计数和规则违反排行。

## 跨设备分析

### `GET /dashboard/cross-device/cases`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `keyword` | 按任务、用例或跨设备证据文本搜索。 |
| `from` / `to` | 按任务创建时间过滤。 |
| `taskType` | 按任务类型过滤。 |
| `scoreMin` / `scoreMax` | 按分数区间过滤。 |
| `page` / `pageSize` | 分页，默认 `1` / `20`，`pageSize` 最大 `100`。 |
| `sortBy` | `updatedAt`、`score`、`taskId`，默认 `updatedAt`。 |
| `sortOrder` | `asc` 或 `desc`，默认 `desc`。 |

只返回约束摘要或规则包显示为跨设备相关的任务。

### `GET /dashboard/cross-device/rule-violations`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `keyword` | 按规则 ID、摘要或来源搜索。 |
| `from` / `to` | 按任务创建时间过滤。 |
| `includeOtherRules` | `true` 时包含非跨设备内置规则。 |
| `page` / `pageSize` | 分页，默认 `1` / `50`，`pageSize` 最大 `200`。 |

响应包含 `summary` 和规则违反聚合 `items`。

### `GET /dashboard/cross-device/risk-review-calibrations`

可选查询参数：

| 参数 | 说明 |
| --- | --- |
| `keyword` | 按任务、用例或风险文本搜索。 |
| `from` / `to` | 按任务创建时间过滤。 |
| `agreement` | `agreed` 或 `disagreed`。 |
| `riskLevel` | `high`、`medium`、`low`。 |
| `page` / `pageSize` | 分页，默认 `1` / `20`，`pageSize` 最大 `100`。 |

只返回跨设备相关任务中的风险复核校准样本。
