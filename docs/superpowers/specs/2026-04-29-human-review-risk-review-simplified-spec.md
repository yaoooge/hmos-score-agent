# 人工复核首版接口与结果项 ID 设计

## 背景

`POST /score/remote-tasks/:taskId/human-review` 是首版本接口。协议以逐条人工复核为核心，不定义整单人工结论字段，也不定义字段别名。

当前需要同时简化两类人工复核项：

- 普通复核项 `itemReviews`：人工确认是否同意 `result.json.human_review_items` 中的当前判断；不同意时给出修正判断和理由。
- 风险复核项 `riskReviews`：人工确认是否同意 `result.json.risks` 中的当前风险等级；不同意时给出修正等级和理由。

为了避免人工复核请求依赖数组下标，`result.json` 在生成时需要为 `human_review_items` 和 `risks` 中的每条记录生成用例内唯一数字 ID。人工复核请求只携带这些 ID。

本阶段只完成接口接收、逐条数据集沉淀和同步响应。不接入后续评分 agent，不新增 workflow/node 节点，不引入复杂状态机。human-review 数据集只接收人工提交后的复核结论；远程任务完成时不得自动写入 human-review 数据集。

## 目标

- 在 `result.json.human_review_items[]` 中新增用例内唯一数字 `id`。
- 在 `result.json.risks[]` 中新增用例内唯一数字 `id`。
- 简化 `itemReviews` 请求体，参考 `riskReviews` 使用“同意/不同意当前结果”的结构。
- `itemReviews` 与 `riskReviews` 都不是必填；缺失或空数组都合法。
- 人工复核没有 overall 结论，只有逐条复核信息。
- 人工复核请求通过 `itemId` / `riskId` 匹配 `result.json` 中的条目。
- 人工不同意当前结果时，必须提交修正值和理由。
- 普通复核项写入 `item_review_calibrations.jsonl`。
- 风险复核项写入 `risk_review_calibrations.jsonl`。
- 风险等级只使用 `high`、`medium`、`low`、`none`。
- 不写完整 raw payload，避免数据冗余留存。
- 数据集样本不生成 `reviewId` 或 `evidenceId`；使用 `taskId`、`testCaseId`、`itemId`、`riskId` 定位样本。
- 不保留未接入的 ingestion/classifier/rebuild 路径。

## 非目标

- 不接入后续评分 agent 检索、prompt 注入或自动学习流程。
- 不新增 `HumanReviewIngestionNode`、`RiskReviewIngestionNode` 或修改 workflow 编排。
- 不设计跨任务批量提交。
- 不要求人工复核覆盖所有 `human_review_items` 或所有 `risks`。
- 不保存完整请求 payload。
- 人工复核协议字段不使用数组下标。

## result.json 结构变更

### human_review_items

每条普通复核项在生成 `result.json` 时分配一个正整数 `id`。ID 只要求在当前 `result.json.human_review_items` 数组内唯一，建议从 `1` 开始递增。

```json
{
  "human_review_items": [
    {
      "id": 1,
      "item": "硬门槛复核",
      "current_assessment": "G1, G3",
      "uncertainty_reason": "规则分支触发了 rubric hard gate 候选条件。",
      "suggested_focus": "确认规则违规是否真实构成硬门槛风险。"
    }
  ]
}
```

### risks

每条风险项在生成 `result.json` 时分配一个正整数 `id`。ID 只要求在当前 `result.json.risks` 数组内唯一，建议从 `1` 开始递增。

```json
{
  "risks": [
    {
      "id": 1,
      "level": "medium",
      "title": "接口风险",
      "description": "接口失败时缺少明确错误提示。",
      "evidence": "Index.ets 中仅打印日志，未展示错误态。"
    }
  ]
}
```

`human_review_items[].id` 与 `risks[].id` 分别在各自数组内唯一即可，二者可以都从 `1` 开始，不需要跨数组全局唯一。

历史用例结果可能不存在上述 `id` 字段。接口读取这类历史 `result.json` 时按数组位置建立临时映射：`human_review_items[index]` 使用 `index + 1` 作为 `itemId`，`risks[index]` 使用 `index + 1` 作为 `riskId`。如果结果条目已经包含显式 `id`，始终优先使用显式 `id`。

## 人工复核接口设计

接口路径：

```http
POST /score/remote-tasks/:taskId/human-review
Content-Type: application/json
```

请求体示例：

```json
{
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "itemReviews": [
    {
      "itemId": 1,
      "agreeWithResultAssessment": false,
      "resultAssessment": "G1, G3",
      "correctedAssessment": "G1",
      "reason": "G3 硬门槛风险不成立，当前证据只支持 G1。",
      "comment": "保留 G1 复核结论。"
    }
  ],
  "riskReviews": [
    {
      "riskId": 1,
      "agreeWithResultLevel": false,
      "resultLevel": "medium",
      "correctedLevel": "low",
      "reason": "该风险只影响异常态提示，不影响主流程功能。",
      "comment": "建议后续评分区分主流程阻断和边界体验问题。"
    },
    {
      "riskId": 2,
      "agreeWithResultLevel": true,
      "resultLevel": "high"
    }
  ]
}
```

### itemReviews 字段

- `itemReviews`：可选，普通人工复核项数组；缺失或空数组合法。
- `itemReviews[].itemId`：必填，匹配 `result.json.human_review_items[].id`；历史结果缺少 `id` 时匹配 `human_review_items` 数组下标 `index + 1`。
- `itemReviews[].agreeWithResultAssessment`：必填，`true` 表示同意当前结果判断，`false` 表示不同意。
- `itemReviews[].resultAssessment`：必填，前端展示给人工确认的当前判断，对应 `result.json.human_review_items[id].current_assessment`。
- `itemReviews[].correctedAssessment`：当 `agreeWithResultAssessment=false` 时必填。
- `itemReviews[].reason`：当 `agreeWithResultAssessment=false` 时必填，说明调整原因。
- `itemReviews[].comment`：可选，人工补充说明。

`itemReviews` 首版本字段仅包含 `itemId`、`agreeWithResultAssessment`、`resultAssessment`、`correctedAssessment`、`reason`、`comment`。

### riskReviews 字段

- `riskReviews`：可选，风险项复核数组；缺失或空数组合法。
- `riskReviews[].riskId`：必填，匹配 `result.json.risks[].id`；历史结果缺少 `id` 时匹配 `risks` 数组下标 `index + 1`。
- `riskReviews[].agreeWithResultLevel`：必填，`true` 表示同意当前风险等级，`false` 表示不同意。
- `riskReviews[].resultLevel`：必填，前端展示给人工确认的当前风险等级，对应 `result.json.risks[id].level`。
- `riskReviews[].correctedLevel`：当 `agreeWithResultLevel=false` 时必填。
- `riskReviews[].reason`：当 `agreeWithResultLevel=false` 时必填，说明改级原因。
- `riskReviews[].comment`：可选，人工补充说明。

风险等级取值：

```text
high | medium | low | none
```

其中 `none` 表示人工判断该风险项不构成有效风险。

## 校验规则

接口只接受已完成远程任务：

- 任务不存在：`404`。
- 任务未完成：`409`。
- `outputs/result.json` 不存在：`404`。

请求体校验：

- body 必须是 object。
- 请求体不包含整单人工结论字段。
- `itemReviews` 缺失、空数组都合法；若提供，必须是数组。
- `riskReviews` 缺失、空数组都合法；若提供，必须是数组。
- `itemReviews[].itemId` 必须是正整数，并能匹配 `result.json.human_review_items[].id`；历史结果缺少 `id` 时匹配数组下标 `index + 1`。
- `riskReviews[].riskId` 必须是正整数，并能匹配 `result.json.risks[].id`；历史结果缺少 `id` 时匹配数组下标 `index + 1`。
- 同一次提交中，`itemReviews` 不允许重复 `itemId`。
- 同一次提交中，`riskReviews` 不允许重复 `riskId`。
- `itemReviews[].resultAssessment` 必须与匹配条目的 `current_assessment` 相同；不同返回 `409`，表示前端复核基于过期结果。
- `riskReviews[].resultLevel` 必须与匹配条目的 `level` 相同；不同返回 `409`，表示前端复核基于过期结果。
- 当 `agreeWithResultAssessment=false` 时，`correctedAssessment` 与 `reason` 必填且不能为空。
- 当 `agreeWithResultAssessment=true` 时，不要求 `correctedAssessment` 和 `reason`。
- 当 `agreeWithResultLevel=false` 时，`correctedLevel` 与 `reason` 必填且不能为空。
- 当 `agreeWithResultLevel=true` 时，不要求 `correctedLevel` 和 `reason`。
- 风险等级只接受 `high`、`medium`、`low`、`none`；其他值返回 `400`。

## 数据集设计

### item_review_calibrations.jsonl

每条 `itemReviews` 生成一行样本。即使人工同意当前结果判断，也写入数据集；它代表“该判断被人工确认”。人工不同意时写入修正判断和理由。

```json
{
  "type": "item_review_calibration",
  "taskId": 88,
  "testCaseId": 188,
  "itemId": 1,
  "taskSummary": "case-188 | bug_fix",
  "resultReviewItem": {
    "id": 1,
    "item": "硬门槛复核",
    "current_assessment": "G1, G3",
    "uncertainty_reason": "规则分支触发了 rubric hard gate 候选条件。",
    "suggested_focus": "确认规则违规是否真实构成硬门槛风险。"
  },
  "humanReview": {
    "agreeWithResultAssessment": false,
    "correctedAssessment": "G1",
    "reason": "G3 硬门槛风险不成立，当前证据只支持 G1。",
    "comment": "保留 G1 复核结论。"
  }
}
```

### 样本唯一性

数据集样本不生成额外唯一 ID。普通复核样本用 `taskId + itemId` 定位，风险复核样本用 `taskId + riskId` 定位；如果需要跨测试用例分析，可同时使用 `testCaseId`。同一次提交中禁止重复 `itemId` / `riskId`，因此无需再生成 `reviewId` 或 `evidenceId`。

### risk_review_calibrations.jsonl

每条 `riskReviews` 生成一行样本。即使人工同意当前结果等级，也写入数据集；它代表“该等级被人工确认”。人工不同意时写入修正等级和理由。

```json
{
  "type": "risk_review_calibration",
  "taskId": 88,
  "testCaseId": 188,
  "riskId": 1,
  "taskSummary": "case-188 | bug_fix",
  "resultRisk": {
    "id": 1,
    "level": "medium",
    "title": "接口风险",
    "description": "接口失败时缺少明确错误提示。",
    "evidence": "Index.ets 中仅打印日志，未展示错误态。"
  },
  "humanReview": {
    "agreeWithResultLevel": false,
    "correctedLevel": "low",
    "reason": "该风险只影响异常态提示，不影响主流程功能。",
    "comment": "建议后续评分区分主流程阻断和边界体验问题。"
  }
}
```

## 处理流程

```text
生成 result.json
  -> 为 human_review_items[] 分配 item id
  -> 为 risks[] 分配 risk id

POST /score/remote-tasks/:taskId/human-review
  -> 解析 taskId
  -> 校验任务存在且 completed
  -> 读取 outputs/result.json
  -> 校验 itemReviews 和 riskReviews
  -> 用 itemId 匹配 result.json.human_review_items[].id
  -> 用 riskId 匹配 result.json.risks[].id
  -> 对 itemReviews 逐条生成 item_review_calibration JSONL
  -> 对 riskReviews 逐条生成 risk_review_calibration JSONL
  -> 返回同步处理结果
```

不新增 node。实现上可以在 `humanReviewHandler` 中调用轻量 helper，分别负责 item review 和 risk review 的校验与 JSONL 追加。

## 响应设计

成功响应：

```json
{
  "success": true,
  "taskId": 88,
  "status": "completed",
  "summary": {
    "itemReviewCount": 1,
    "riskReviewCount": 2,
    "riskAgreementCount": 1,
    "riskDisagreementCount": 1,
    "datasetItemCount": 3
  },
  "message": "人工复核结果已接收。"
}
```

错误响应示例：

```json
{
  "success": false,
  "taskId": 88,
  "message": "riskReviews[0].reason is required when agreeWithResultLevel is false"
}
```

## 同步响应与状态

接口按同步处理设计。成功响应中的 `status` 固定为 `completed`，响应只返回本次提交的计数摘要，不生成独立 `reviewId`。

逐条复核明细不进入状态记录，避免重复存储。需要训练或分析时读取 `item_review_calibrations.jsonl` 和 `risk_review_calibrations.jsonl`。

## 需要修改的位置

### result.json 生成链路

- `src/types.ts`
  - `HumanReviewItem` 增加 `id: number`。
  - `RiskItem` 增加 `id: number`。
- `src/scoring/scoringEngine.ts`
  - 生成 `humanReviewItems` 后为每条普通复核项分配 `id`。
  - 生成 `risks` 后为每条风险项分配 `id`。
  - 保证两个数组各自从 `1` 开始递增且用例内唯一。
- `src/nodes/reportGenerationNode.ts`
  - 保持透传 `state.scoreComputation.humanReviewItems` 和 `state.scoreComputation.risks`，确认落盘结果包含 `id`。
- `tests/fixtures/report_result_schema.json`
  - `human_review_items.items.required` 增加 `id`。
  - `risks.items.required` 增加 `id`。
- `tests/schema-validator.test.ts`、`tests/score-agent.test.ts`、`tests/remote-network-execution.test.ts`
  - 更新期望结果和 fixture，确保 result schema 要求 id。

### 人工复核接口链路

- `src/humanReview/humanReviewTypes.ts`
  - `HumanReviewItemReview` 使用 `itemId`、`agreeWithResultAssessment`、`resultAssessment`、`correctedAssessment?`、`reason?`、`comment?`。
  - `HumanRiskReview` 使用 `riskId`。
  - `HumanReviewDatasetSample` 不要求 `reviewId` 或 `evidenceId`。
  - 移除普通复核项复杂字段类型。
- `src/api/humanReviewHandler.ts`
  - 请求校验使用 id 匹配。
  - `itemReviews` 校验 `itemId`、`agreeWithResultAssessment`、`resultAssessment`。
  - `riskReviews` 校验 `riskId`、`agreeWithResultLevel`、`resultLevel`。
  - 校验重复 `itemId` / `riskId`。
  - 数据集样本写入 `taskId`、`testCaseId`、`itemId` / `riskId`。
  - 不生成 `reviewId` 或 `evidenceId`。
- `src/api/apiDefinitions.ts`
  - 更新请求体说明和字段示例。
  - 成功响应不包含 `reviewId`。
  - 如果不再需要独立状态查询，移除 human review status endpoint 定义。
- `tests/human-review-ingestion.test.ts`
  - 更新 item review 简化字段测试。
  - 更新成功响应不包含 `reviewId` 的测试。
  - 更新数据集样本不包含 `reviewId` / `evidenceId` 的测试。
  - 覆盖 risk review 使用 `riskId` 的测试。
  - 新增过期结果校验：`resultAssessment` / `resultLevel` 不匹配返回 `409`。
  - 新增重复 id 返回 `400` 的测试。

### 展示链路

- `src/report/renderer/buildHtmlReportViewModel.ts`
  - 当前展示可以继续忽略 `id`。
  - 如需要方便前端调试，可在 view model 中保留或展示 `id`，但不是本次接口必需。
- `src/report/renderer/renderHtmlReport.ts`
  - 不要求展示 `id`；除非前端需要直接从报告复制复核 id。

## 测试覆盖

- `result.json.human_review_items[]` 每条都有正整数 `id`。
- `result.json.risks[]` 每条都有正整数 `id`。
- 普通复核项和风险项的 id 分别从 `1` 递增。
- 空 body `{}` 合法，dataset count 为 0，响应不包含 `reviewId`。
- 只有 `itemReviews` 合法，并逐条写入 `item_review_calibrations.jsonl`。
- 只有 `riskReviews` 合法，并逐条写入 `risk_review_calibrations.jsonl`。
- `itemId` 不存在返回 `400`。
- `riskId` 不存在返回 `400`。
- 重复 `itemId` 返回 `400`。
- 重复 `riskId` 返回 `400`。
- `agreeWithResultAssessment=true` 时不需要 `correctedAssessment` 和 `reason`。
- `agreeWithResultAssessment=false` 缺少 `correctedAssessment` 返回 `400`。
- `agreeWithResultAssessment=false` 缺少 `reason` 返回 `400`。
- `resultAssessment` 与 `result.json.human_review_items[].current_assessment` 不一致返回 `409`。
- `agreeWithResultLevel=true` 时不需要 `correctedLevel` 和 `reason`。
- `agreeWithResultLevel=false` 缺少 `correctedLevel` 返回 `400`。
- `agreeWithResultLevel=false` 缺少 `reason` 返回 `400`。
- `correctedLevel=none` 合法。
- 风险等级为枚举外字符串时返回 `400`。
- `resultLevel` 与 `result.json.risks[].level` 不一致返回 `409`。
- 接口不写完整 raw payload，不创建 raw 目录。
- 数据集样本不包含 `reviewId` 或 `evidenceId`。
- 远程任务完成后，即使 `result.json.risks` 非空，也不会自动写入任何 human-review 数据集。

## 取舍

这个方案把人工复核请求稳定性放在 `result.json` 生成阶段解决：前端只携带数字 id 和人工判断，不携带普通复核项的复杂证据结构。代价是 `result.json` schema 需要增加两个 `id` 字段，并同步更新生成链路与 schema 测试。整体实现仍保持轻量，不新增节点、不做异步分类、不保存完整 payload。
