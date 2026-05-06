# human-review 接口本地验证记录

验证时间：2026-05-06

验证接口：

```http
POST /score/remote-tasks/:taskId/human-review
```

## 请求地址

```http
POST http://8.136.155.63:3000/score/remote-tasks/:taskId/human-review
Content-Type: application/json
```

## 请求体

```json
{
  "reviewer": {
    "id": "local-codex",
    "role": "evaluation_admin"
  },
  "itemReviews": [
    {
      "itemId": 1,
      "agreeWithResultAssessment": false,
      "resultAssessment": "G3",
      "correctedAssessment": "G3 规则违规成立，但复核建议聚焦到具体规则证据。",
      "reason": "最新结果中的复核项是硬门槛复核，当前结论只给出 G3，人工复核补充说明该项仍成立但需要明确证据。",
      "comment": "基于 simple_test 最新 result.json 构造。"
    }
  ],
  "riskReviews": [
    {
      "riskId": 3,
      "agreeWithResultLevel": false,
      "resultLevel": "high",
      "correctedLevel": "medium",
      "reason": "ARKTS-FORBID-026 违规存在，但在 simple_test 中主要体现为规范风险，暂未看到直接导致核心流程不可用的证据。",
      "comment": "用于验证风险等级复核数据集生成。"
    }
  ]
}
```

## 接口返回

HTTP 状态码：

```text
200 OK
```

响应体：

```json
{
  "success": true,
  "taskId": 900001,
  "status": "completed",
  "summary": {
    "itemReviewCount": 1,
    "riskReviewCount": 1,
    "riskAgreementCount": 0,
    "riskDisagreementCount": 1,
    "datasetItemCount": 2
  },
  "message": "人工复核结果已接收。"
}
```

## 历史结果兼容性

历史 result.json 时如果数组元素没有 id，就用该元素所在数组下标 index + 1 作为匹配 id

## 数据集落盘结果

接口返回后，数据集目录下追加了两条样本：

```text
/Users/guoyutong/.hmos-score-agent/human-review-evidences/datasets/item_review_calibrations.jsonl
/Users/guoyutong/.hmos-score-agent/human-review-evidences/datasets/risk_review_calibrations.jsonl
```

`item_review_calibrations.jsonl` 追加样本：

```json
{
  "type": "item_review_calibration",
  "taskId": 900001,
  "testCaseId": 1,
  "itemId": 1,
  "taskSummary": "simple_test | continuation",
  "resultReviewItem": {
    "id": 1,
    "item": "硬门槛复核",
    "current_assessment": "G3",
    "uncertainty_reason": "规则分支触发了 rubric hard gate 候选条件。",
    "suggested_focus": "确认规则违规是否真实构成硬门槛风险。"
  },
  "humanReview": {
    "agreeWithResultAssessment": false,
    "correctedAssessment": "G3 规则违规成立，但复核建议聚焦到具体规则证据。",
    "reason": "最新结果中的复核项是硬门槛复核，当前结论只给出 G3，人工复核补充说明该项仍成立但需要明确证据。",
    "comment": "基于 simple_test 最新 result.json 构造。"
  }
}
```

`risk_review_calibrations.jsonl` 追加样本：

```json
{
  "type": "risk_review_calibration",
  "taskId": 900001,
  "testCaseId": 1,
  "riskId": 3,
  "taskSummary": "simple_test | continuation",
  "resultRisk": {
    "id": 3,
    "level": "high",
    "title": "规则违规：ARKTS-FORBID-026",
    "description": "禁止在 finally 代码块中使用 return、break、continue 或抛出未处理异常。 检测到规则命中，文件：components/module_secure_checkin/src/main/ets/viewmodels/CheckinPageVM.ets",
    "evidence": "禁止在 finally 代码块中使用 return、break、continue 或抛出未处理异常。 检测到规则命中，文件：components/module_secure_checkin/src/main/ets/viewmodels/CheckinPageVM.ets"
  },
  "humanReview": {
    "agreeWithResultLevel": false,
    "correctedLevel": "medium",
    "reason": "ARKTS-FORBID-026 违规存在，但在 simple_test 中主要体现为规范风险，暂未看到直接导致核心流程不可用的证据。",
    "comment": "用于验证风险等级复核数据集生成。"
  }
}
```

## 验证结论

- 接口可正常接收 `itemReviews` 和 `riskReviews`。
- 接口按 `itemId` 与 `riskId` 匹配 `result.json` 中的 `human_review_items` 与 `risks`。
- 返回 `datasetItemCount: 2`，符合本次 1 条 item review 与 1 条 risk review 的输入。
- 数据集样本未包含 `reviewId`、`evidenceId` 或完整请求 payload。
