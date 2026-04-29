# 人工复核风险项简化接口设计

## 背景

当前 `POST /score/remote-tasks/:taskId/human-review` 还未对外发布，可以直接调整协议，不需要兼容已有调用方。现有接口偏向“整单人工复核”，包含 `overallDecision`，且 `itemReviews` 必填；这与实际复核方式不一致。

新的复核模型按条目提交人工判断：普通复核项和风险项都可以提交，也都可以为空。风险项复核只关心人工是否同意自动识别出的风险等级；不同意时，人工给出新的风险等级和调整理由。

本阶段只完成接口接收、原始记录落盘、风险复核数据集沉淀。不接入后续评分 agent，不新增 workflow/node 节点，不引入复杂状态机。

## 目标

- 简化 `/score/remote-tasks/:taskId/human-review` 请求协议，移除整单 `overallDecision`。
- 支持逐条提交普通复核项 `itemReviews` 和风险项复核 `riskReviews`。
- `itemReviews` 与 `riskReviews` 都不是必填；缺失或空数组都合法。
- 风险项复核只支持“同意/不同意自动风险等级”。
- 当人工不同意自动风险等级时，必须提交新的风险等级和理由。
- 将风险项人工复核结论写入一份独立 JSONL 数据集，用于后续评分能力增强。
- 不新增 node 节点；风险复核数据集写入在接口处理逻辑或轻量 helper 中完成。
- 保留原始人工复核 payload，便于追溯。

## 非目标

- 不考虑接口向后兼容。
- 不接入后续评分 agent 检索、prompt 注入或自动学习流程。
- 不新增 `RiskReviewIngestionNode` 或修改现有 workflow 节点编排。
- 不设计跨任务批量提交。
- 不在本阶段修改 `result.json` 风险项生成 schema。
- 不强制人工复核必须覆盖所有风险项。
- 不对普通 `itemReviews` 做新的复杂分类或训练样本生成设计。

## 接口设计

接口路径保持不变：

```http
POST /score/remote-tasks/:taskId/human-review
Content-Type: application/json
```

请求体：

```json
{
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "itemReviews": [
    {
      "reviewItemKey": "接口接入复核",
      "sourceItem": "human_review_items[0]",
      "humanVerdict": "confirmed_issue",
      "correctedAssessment": "接口接入问题成立。",
      "evidence": {
        "files": ["entry/src/main/ets/pages/Index.ets"],
        "snippets": ["使用 mockData 直接渲染列表"],
        "comment": "未调用题目要求的数据接口。"
      },
      "tags": ["api_integration"]
    }
  ],
  "riskReviews": [
    {
      "riskIndex": 0,
      "agreeWithAutoLevel": false,
      "autoLevel": "major",
      "correctedLevel": "minor",
      "reason": "该风险只影响异常态提示，不影响主流程功能，因此不应判为 major。",
      "comment": "建议后续评分区分主流程阻断和边界体验问题。"
    },
    {
      "riskIndex": 1,
      "agreeWithAutoLevel": true,
      "autoLevel": "critical"
    }
  ]
}
```

字段说明：

- `reviewer`：可选，记录人工复核人员或系统身份。
- `itemReviews`：可选，普通人工复核项数组；缺失或空数组合法。
- `riskReviews`：可选，风险项复核数组；缺失或空数组合法。
- `riskReviews[].riskIndex`：必填，指向当前任务 `outputs/result.json` 中 `risks` 数组的下标。
- `riskReviews[].agreeWithAutoLevel`：必填，`true` 表示同意自动风险等级，`false` 表示不同意。
- `riskReviews[].autoLevel`：必填，前端展示给人工确认的自动风险等级。
- `riskReviews[].correctedLevel`：当 `agreeWithAutoLevel=false` 时必填。
- `riskReviews[].reason`：当 `agreeWithAutoLevel=false` 时必填，说明改级原因。
- `riskReviews[].comment`：可选，人工补充说明。

风险等级取值：

```text
critical | major | minor | info
```

`itemReviews` 和 `riskReviews` 可以同时为空。此时接口只记录一次人工复核提交，数据集新增条数为 0。

## 校验规则

接口仍只接受已完成远程任务：

- 任务不存在：`404`。
- 任务未完成：`409`。
- `outputs/result.json` 不存在：`404`。

请求体校验：

- body 必须是 object。
- 不再校验 `overallDecision`。
- `itemReviews` 缺失、空数组都合法；若提供，数组元素仍按现有普通复核字段做基础校验。
- `riskReviews` 缺失、空数组都合法。
- 若提供 `riskReviews`，每一项必须包含合法 `riskIndex`、`agreeWithAutoLevel`、`autoLevel`。
- `riskIndex` 必须能匹配 `result.json.risks[riskIndex]`。
- `autoLevel` 必须与 `result.json.risks[riskIndex].level` 归一化后相同；不同则返回 `409`，表示前端复核基于过期结果。
- 当 `agreeWithAutoLevel=false` 时，`correctedLevel` 与 `reason` 必填。
- 当 `agreeWithAutoLevel=true` 时，忽略 `correctedLevel`，不要求 `reason`。

## 落盘设计

### 原始记录

继续写入现有 raw review 目录，payload 保存完整请求体。原始记录结构去掉对 `overallDecision` 的要求：

```json
{
  "schemaVersion": 2,
  "reviewId": "hr_20260429_88_xxx",
  "taskId": 88,
  "testCaseId": 123,
  "receivedAt": "2026-04-29T10:20:30.000Z",
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "resultSummary": {
    "caseId": "remote-case-123",
    "taskType": "ArkTS UI",
    "totalScore": 72,
    "humanReviewItemCount": 1,
    "riskCount": 2
  },
  "payload": {
    "itemReviews": [],
    "riskReviews": []
  }
}
```

### 风险复核数据集

新增数据集文件：

```text
datasets/risk_review_calibrations.jsonl
```

每条 `riskReviews` 生成一行样本。即使人工同意自动等级，也写入数据集；它代表“自动等级被人工确认”。人工不同意时写入 corrected level 和 reason。

样本结构：

```json
{
  "type": "risk_review_calibration",
  "reviewId": "hr_20260429_88_xxx",
  "evidenceId": "hr_20260429_88_xxx-risk-1",
  "taskId": 88,
  "testCaseId": 123,
  "riskIndex": 0,
  "taskSummary": "remote-case-123 | ArkTS UI",
  "autoRisk": {
    "level": "major",
    "title": "异常态提示不完整",
    "description": "接口失败时缺少明确错误提示。",
    "evidence": "Index.ets 中仅打印日志，未展示错误态。"
  },
  "humanReview": {
    "agreeWithAutoLevel": false,
    "correctedLevel": "minor",
    "reason": "该风险只影响异常态提示，不影响主流程功能，因此不应判为 major。",
    "comment": "建议后续评分区分主流程阻断和边界体验问题。"
  }
}
```

## 处理流程

```text
POST /score/remote-tasks/:taskId/human-review
  -> 解析 taskId
  -> 校验任务存在且 completed
  -> 读取 outputs/result.json
  -> 校验 itemReviews 和 riskReviews
  -> 生成 reviewId
  -> 写 raw review record
  -> 对 riskReviews 逐条生成 risk_review_calibration JSONL
  -> 写 status completed
  -> 返回成功响应
```

不新增 node。实现上可以在 `humanReviewHandler` 中调用一个轻量 helper，例如 `writeRiskReviewCalibrationSamples(...)`，负责从 `resultJson.risks` 取自动风险内容并追加 JSONL。

## 响应设计

成功响应：

```json
{
  "success": true,
  "taskId": 88,
  "reviewId": "hr_20260429_88_xxx",
  "status": "completed",
  "rawPath": "/data/hmos-score-agent/human-review-evidences/raw/2026-04-29/task-88-review-hr_20260429_88_xxx.json",
  "summary": {
    "itemReviewCount": 1,
    "riskReviewCount": 2,
    "riskAgreementCount": 1,
    "riskDisagreementCount": 1,
    "datasetItemCount": 2
  },
  "message": "人工复核结果已接收。"
}
```

错误响应保持现有风格：

```json
{
  "success": false,
  "taskId": 88,
  "message": "riskReviews[0].reason is required when agreeWithAutoLevel is false"
}
```

## 状态记录

由于本阶段不新增 node，也不做后台分类，状态可以直接写为 `completed`。为保持实现简单，不扩展状态结构；`GET /score/human-reviews/:reviewId` 继续返回现有 `classificationSummary` 形状，只把风险复核数据集条数计入 `datasetItemCount`：

```json
{
  "success": true,
  "schemaVersion": 1,
  "reviewId": "hr_20260429_88_xxx",
  "taskId": 88,
  "status": "completed",
  "updatedAt": "2026-04-29T10:20:30.000Z",
  "classificationSummary": {
    "rawItemCount": 3,
    "eligibleItemCount": 3,
    "filteredItemCount": 0,
    "datasetItemCount": 2,
    "positive": 0,
    "negative": 0,
    "neutral": 3
  }
}
```

风险复核的同意/不同意明细不进入 status，避免为了展示状态扩展额外类型。需要追溯时读取 raw record；需要训练或分析时读取 `risk_review_calibrations.jsonl`。

## 实现建议

需要修改的主要位置：

- `src/humanReview/humanReviewTypes.ts`：重定义提交 payload，新增 `HumanRiskReview` 和 `risk_review_calibration` dataset type。
- `src/api/humanReviewHandler.ts`：移除 `overallDecision` 校验，允许空 `itemReviews` / `riskReviews`，增加风险复核校验与数据集写入。
- `src/humanReview/humanReviewEvidenceStore.ts`：为 `risk_review_calibration` 增加 JSONL 文件名。
- `src/api/apiDefinitions.ts`：更新接口文档和示例。
- `tests/human-review-ingestion.test.ts`：更新旧校验测试，新增风险复核测试。

测试覆盖：

- 空 body `{}` 合法，写 raw，dataset count 为 0。
- 只有 `riskReviews` 合法。
- `agreeWithAutoLevel=true` 时不需要 `correctedLevel` 和 `reason`。
- `agreeWithAutoLevel=false` 缺少 `correctedLevel` 返回 `400`。
- `agreeWithAutoLevel=false` 缺少 `reason` 返回 `400`。
- `riskIndex` 越界返回 `400`。
- `autoLevel` 与 `result.json.risks[index].level` 不一致返回 `409`。
- 同意和不同意风险等级都写入 `risk_review_calibrations.jsonl`。
- 未完成任务仍返回 `409`。

## 取舍

这个方案刻意保持轻量：风险复核是当前接口的直接副产物，不引入新的 node、异步分类或后续 agent 依赖。代价是数据集生成逻辑会暂时靠近 API handler；如果后续风险复核规则变复杂，再抽成 service/helper 即可，不需要现在提前设计完整流水线。
