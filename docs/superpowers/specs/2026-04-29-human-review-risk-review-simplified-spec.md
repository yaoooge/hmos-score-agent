# 人工复核风险项简化接口设计

## 背景

`POST /score/remote-tasks/:taskId/human-review` 作为首版本接口开发。协议以逐条人工复核为核心，不定义整单人工结论字段，也不定义字段别名或协议迁移层。

新的复核模型按条目提交人工判断：普通复核项和风险项都可以提交，也都可以为空。风险项复核只关心人工是否同意当前用例结果中已经给出的风险等级；不同意时，人工给出新的风险等级和调整理由。

本阶段只完成接口接收、原始记录落盘、风险复核数据集沉淀。不接入后续评分 agent，不新增 workflow/node 节点，不引入复杂状态机。human-review 评测集只接收人工提交后的复核结论；远程任务完成时不得把 `result.json.risks` 自动写入 human-review 评测集。

## 目标

- 定义 `/score/remote-tasks/:taskId/human-review` 首版本请求协议，不包含整单人工结论字段。
- 支持逐条提交普通复核项 `itemReviews` 和风险项复核 `riskReviews`。
- `itemReviews` 与 `riskReviews` 都不是必填；缺失或空数组都合法。
- 风险项复核只支持“同意/不同意当前用例结果中的风险等级”。
- 当人工不同意当前结果风险等级时，必须提交新的风险等级和理由。
- 将风险项人工复核结论写入一份独立 JSONL 数据集，用于后续评分能力增强。
- 风险等级复用当前用例结果口径，只使用 `high`、`medium`、`low`、`none`。
- 清理自动结果风险直接入 human-review 评测集的开发中代码路径，包括远程任务完成回调、rebuild 工具和对应测试。
- 不新增 node 节点；风险复核数据集写入在接口处理逻辑或轻量 helper 中完成。
- 保留原始人工复核 payload，便于追溯。

## 非目标

- 首版本只实现本文定义的请求体，未列出的字段不进入协议设计。
- 不接入后续评分 agent 检索、prompt 注入或自动学习流程。
- 不新增 `RiskReviewIngestionNode` 或修改现有 workflow 节点编排。
- 不设计跨任务批量提交。
- 不在本阶段修改 `result.json` 风险项生成 schema。
- 不强制人工复核必须覆盖所有风险项。
- 不对普通 `itemReviews` 做新的复杂分类或训练样本生成设计。
- 不保留自动结果风险入库作为兜底训练数据；没有人工提交的风险复核，不产生 human-review 风险评测样本。

## 接口设计

接口路径：

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
      "agreeWithResultLevel": false,
      "resultLevel": "medium",
      "correctedLevel": "low",
      "reason": "该风险只影响异常态提示，不影响主流程功能，因此不应判为 medium。",
      "comment": "建议后续评分区分主流程阻断和边界体验问题。"
    },
    {
      "riskIndex": 1,
      "agreeWithResultLevel": true,
      "resultLevel": "high"
    }
  ]
}
```

字段说明：

- `reviewer`：可选，记录人工复核人员或系统身份。
- `itemReviews`：可选，普通人工复核项数组；缺失或空数组合法。
- `riskReviews`：可选，风险项复核数组；缺失或空数组合法。
- `riskReviews[].riskIndex`：必填，指向当前任务 `outputs/result.json` 中 `risks` 数组的下标。
- `riskReviews[].agreeWithResultLevel`：必填，`true` 表示同意当前用例结果风险等级，`false` 表示不同意。
- `riskReviews[].resultLevel`：必填，前端展示给人工确认的当前用例结果风险等级。
- `riskReviews[].correctedLevel`：当 `agreeWithResultLevel=false` 时必填。
- `riskReviews[].reason`：当 `agreeWithResultLevel=false` 时必填，说明改级原因。
- `riskReviews[].comment`：可选，人工补充说明。

风险等级取值：

```text
high | medium | low | none
```

其中 `none` 表示人工判断该风险项不构成有效风险。若当前用例结果已经支持 `none`，`resultLevel` 也允许为 `none`；否则 `none` 主要用于 `correctedLevel`。

`itemReviews` 和 `riskReviews` 可以同时为空。此时接口只记录一次人工复核提交，数据集新增条数为 0。

## 校验规则

接口仍只接受已完成远程任务：

- 任务不存在：`404`。
- 任务未完成：`409`。
- `outputs/result.json` 不存在：`404`。

请求体校验：

- body 必须是 object。
- 请求体不包含整单人工结论字段。
- `itemReviews` 缺失、空数组都合法；若提供，数组元素仍按现有普通复核字段做基础校验。
- `riskReviews` 缺失、空数组都合法。
- 若提供 `riskReviews`，每一项必须包含合法 `riskIndex`、`agreeWithResultLevel`、`resultLevel`。
- `riskIndex` 必须能匹配 `result.json.risks[riskIndex]`。
- `resultLevel` 必须与 `result.json.risks[riskIndex].level` 归一化后相同；不同则返回 `409`，表示前端复核基于过期结果。
- 风险等级只接受 `high`、`medium`、`low`、`none`；其他值返回 `400`。
- 当 `agreeWithResultLevel=false` 时，`correctedLevel` 与 `reason` 必填。
- 当 `agreeWithResultLevel=true` 时，忽略 `correctedLevel`，不要求 `reason`。

## 落盘设计

### 原始记录

原始记录写入 raw review 目录，payload 保存完整请求体。原始记录结构不包含整单人工结论字段：

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

每条 `riskReviews` 生成一行样本。即使人工同意当前用例结果等级，也写入数据集；它代表“该等级被人工确认”。人工不同意时写入 corrected level 和 reason。

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
  "resultRisk": {
    "level": "medium",
    "title": "异常态提示不完整",
    "description": "接口失败时缺少明确错误提示。",
    "evidence": "Index.ets 中仅打印日志，未展示错误态。"
  },
  "humanReview": {
    "agreeWithResultLevel": false,
    "correctedLevel": "low",
    "reason": "该风险只影响异常态提示，不影响主流程功能，因此不应判为 medium。",
    "comment": "建议后续评分区分主流程阻断和边界体验问题。"
  }
}
```

### 清理自动结果风险入库代码

首版本只允许通过人工复核接口写入 human-review 数据集。远程任务完成本身不产生任何 human-review 数据，避免未经人工确认的结果污染人工复核评测集。

需要清理的范围：

- 删除 `src/humanReview/resultRiskIngestionNode.ts`。
- 删除 `src/humanReview/resultRiskRebuild.ts`。
- 删除 `src/tools/rebuildResultRiskEvidence.ts`。
- 从 `src/api/app.ts` 移除 `runResultRiskIngestionNode`、`buildResultRiskReviewId` import，以及 `onCompletedCallbackUploaded` 中写 human-review evidence store 的逻辑。
- 移除或改写 `tests/human-review-ingestion.test.ts` 中覆盖 result risk ingestion / rebuild 的测试。
- 移除文档或脚本中针对 result risk rebuild 的入口引用。

清理后，`result.json.risks` 只作为人工复核提交时的匹配来源；没有 `riskReviews` 提交时，不写任何风险复核评测样本。

## 处理流程

```text
POST /score/remote-tasks/:taskId/human-review
  -> 解析 taskId
  -> 校验任务存在且 completed
  -> 读取 outputs/result.json
  -> 校验 itemReviews 和 riskReviews
  -> 生成 reviewId
  -> 写 raw review record
  -> 对人工提交的 riskReviews 逐条生成 risk_review_calibration JSONL
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

错误响应：

```json
{
  "success": false,
  "taskId": 88,
  "message": "riskReviews[0].reason is required when agreeWithResultLevel is false"
}
```

## 状态记录

由于本阶段不新增 node，也不做后台分类，状态可以直接写为 `completed`。`GET /score/human-reviews/:reviewId` 返回与提交响应一致的 `summary`，`datasetItemCount` 同时统计 item 复核和风险复核生成的数据集条数：

```json
{
  "success": true,
  "schemaVersion": 1,
  "reviewId": "hr_20260429_88_xxx",
  "taskId": 88,
  "status": "completed",
  "updatedAt": "2026-04-29T10:20:30.000Z",
  "summary": {
    "itemReviewCount": 1,
    "riskReviewCount": 2,
    "riskAgreementCount": 1,
    "riskDisagreementCount": 1,
    "datasetItemCount": 3
  }
}
```

逐条复核明细不进入 status，避免为了展示状态重复存储。需要训练或分析时读取 `item_review_calibrations.jsonl` 和 `risk_review_calibrations.jsonl`。

## 实现建议

需要修改的主要位置：

- `src/humanReview/humanReviewTypes.ts`：重定义提交 payload，新增 `HumanRiskReview`、`item_review_calibration` 和 `risk_review_calibration` dataset type；风险等级类型统一为 `high | medium | low | none`。
- `src/api/humanReviewHandler.ts`：按首版本请求体做校验，允许空 `itemReviews` / `riskReviews`，增加 item 复核和风险复核数据集写入。
- `src/humanReview/humanReviewEvidenceStore.ts`：为 `item_review_calibration` 与 `risk_review_calibration` 增加 JSONL 文件名，移除完整 payload 落盘能力。
- `src/api/apiDefinitions.ts`：更新接口文档和示例。
- `tests/human-review-ingestion.test.ts`：更新接口校验测试，新增风险复核测试。
- 删除 `src/humanReview/resultRiskIngestionNode.ts`、`src/humanReview/resultRiskRebuild.ts`、`src/tools/rebuildResultRiskEvidence.ts` 及其引用，清除自动风险直接入库逻辑。

测试覆盖：

- 空 body `{}` 合法，不写 raw payload，dataset count 为 0。
- 只有 `itemReviews` 合法，并逐条写入 `item_review_calibrations.jsonl`。
- 只有 `riskReviews` 合法。
- `agreeWithResultLevel=true` 时不需要 `correctedLevel` 和 `reason`。
- `agreeWithResultLevel=false` 缺少 `correctedLevel` 返回 `400`。
- `agreeWithResultLevel=false` 缺少 `reason` 返回 `400`。
- `correctedLevel=none` 合法，表示人工认为该项不构成风险。
- 风险等级为枚举外字符串时返回 `400`。
- `riskIndex` 越界返回 `400`。
- `resultLevel` 与 `result.json.risks[index].level` 不一致返回 `409`。
- 同意和不同意风险等级都写入 `risk_review_calibrations.jsonl`。
- 接口不写完整 raw payload，不创建 raw 目录。
- 远程任务完成后，即使 `result.json.risks` 非空，也不会自动写入任何 human-review 数据集。
- result risk rebuild 工具、未接入 item review ingestion 节点和相关测试被删除，代码库中不保留自动结果风险回灌或后台分类入口。
- 未完成任务仍返回 `409`。

## 取舍

这个方案刻意保持轻量：item 复核和风险复核都是当前接口的直接副产物，不引入新的 node、异步分类或后续 agent 依赖。代价是数据集生成逻辑会暂时靠近 API handler；如果后续规则变复杂，再抽成 service/helper 即可，不需要现在提前设计完整流水线。
