# 人工复核前端适配说明

本文档只说明管理台前端需要适配的接口、字段和页面行为。前端只需要按接口读取结果、提交逐条复核结论，并在提交成功后刷新结果。

## 1. 接入流程

```text
进入远端任务结果页
  -> GET /score/remote-tasks/:taskId/result
  -> 展示评分结果、待复核项、风险项
  -> 用户逐条确认或修正
  -> POST /score/remote-tasks/:taskId/human-review
  -> 成功后重新 GET /score/remote-tasks/:taskId/result
  -> 展示复核后的最新评分结果
```

前端只需要适配两个接口：

- `GET /score/remote-tasks/:taskId/result`
- `POST /score/remote-tasks/:taskId/human-review`

## 2. 读取评分结果

### 接口

```http
GET /score/remote-tasks/:taskId/result
```

### 成功响应

```json
{
  "success": true,
  "taskId": 273,
  "status": "completed",
  "resultData": {
    "basic_info": {},
    "overall_conclusion": {},
    "dimension_results": [],
    "human_review_items": [],
    "risks": [],
    "human_review_revision": {}
  }
}
```

### 前端需要展示的结果字段

#### 总分信息

读取：

```json
{
  "overall_conclusion": {
    "total_score": 69,
    "hard_gate_triggered": true,
    "summary": "已完成 rubric 基础评分与规则修正融合，并触发硬门槛：G1。"
  }
}
```

字段说明：

- `resultData.overall_conclusion.total_score`：当前总分。
- `resultData.overall_conclusion.hard_gate_triggered`：是否触发硬门槛。
- `resultData.overall_conclusion.summary`：评分摘要。

#### 维度分信息

读取：

```json
{
  "dimension_results": [
    {
      "dimension_name": "代码正确性与静态质量",
      "score": 16,
      "max_score": 20,
      "item_results": [
        {
          "item_name": "ArkTS/ArkUI语法与类型安全",
          "score": 6,
          "item_weight": 8,
          "matched_band": {
            "score": 6,
            "criteria": "存在少量局部类型宽松或边界处理不够严谨。"
          },
          "confidence": "high",
          "review_required": true
        }
      ]
    }
  ]
}
```

字段说明：

- `dimension_results[].dimension_name`：维度名称。
- `dimension_results[].score`：维度得分。
- `dimension_results[].max_score`：维度满分。
- `dimension_results[].item_results[]`：维度下的评分项。
- `item_results[].item_name`：评分项名称。
- `item_results[].score`：评分项得分。
- `item_results[].item_weight`：评分项满分或权重。
- `item_results[].matched_band`：命中的评分档位，可用于展示评分依据。
- `item_results[].review_required`：该评分项是否建议关注。

## 3. 待人工复核项

前端从 `resultData.human_review_items[]` 读取普通复核项。

### 数据结构

```json
{
  "human_review_items": [
    {
      "id": 1,
      "item": "硬门槛复核",
      "current_assessment": "G1",
      "uncertainty_reason": "规则分支触发了 rubric hard gate 候选条件。",
      "suggested_focus": "确认规则违规是否真实构成硬门槛风险。"
    }
  ]
}
```

### 前端字段说明

- `id`：复核项 ID，提交时作为 `itemId`。
- `item`：复核项名称。
- `current_assessment`：当前系统判断，提交时必须原样带回 `resultAssessment`。
- `uncertainty_reason`：系统不确定原因。
- `suggested_focus`：建议人工关注点。

### 页面控件建议

每条 `human_review_items[]` 提供：

- 当前判断展示：`current_assessment`
- 选择项：同意当前判断 / 修正判断
- 同意当前判断时：无需填写修正判断和理由
- 修正判断时：必须填写修正判断 `correctedAssessment` 和原因 `reason`
- 可选备注：`comment`

## 4. 风险项复核

前端从 `resultData.risks[]` 读取风险项。

### 数据结构

```json
{
  "risks": [
    {
      "id": 1,
      "level": "medium",
      "title": "图标资源引用错误",
      "description": "MineVM 中新增的个人设置菜单项引用了不存在的图标资源。",
      "evidence": "generated/products/phone/src/main/ets/viewmodels/MineVM.ets:30"
    }
  ]
}
```

### 前端字段说明

- `id`：风险项 ID，提交时作为 `riskId`。
- `level`：当前风险等级，提交时必须原样带回 `resultLevel`。
- `title`：风险标题。
- `description`：风险描述。
- `evidence`：风险证据。

### 风险等级枚举

```text
high | medium | low | none
```

建议前端展示文案：

- `high`：高风险
- `medium`：中风险
- `low`：低风险
- `none`：无风险

### 页面控件建议

每条 `risks[]` 提供：

- 当前风险等级展示：`level`
- 选择项：同意当前等级 / 修正等级
- 同意当前等级时：无需填写修正等级和理由
- 修正等级时：必须选择 `correctedLevel`，并填写 `reason`
- 可选备注：`comment`

## 5. 提交人工复核

### 接口

```http
POST /score/remote-tasks/:taskId/human-review
Content-Type: application/json
```

### 请求体 TypeScript 结构

```ts
type HumanReviewSubmissionPayload = {
  reviewer?: {
    id?: string;
    role?: string;
  };
  itemReviews?: HumanReviewItemReview[];
  riskReviews?: HumanRiskReview[];
};

type HumanReviewItemReview = {
  itemId: number;
  agreeWithResultAssessment: boolean;
  resultAssessment: string;
  correctedAssessment?: string;
  reason?: string;
  comment?: string;
};

type HumanRiskReview = {
  riskId: number;
  agreeWithResultLevel: boolean;
  resultLevel: "high" | "medium" | "low" | "none";
  correctedLevel?: "high" | "medium" | "low" | "none";
  reason?: string;
  comment?: string;
};
```

### itemReviews 字段规则

- `itemReviews`：可选；缺失或空数组合法。
- `itemReviews[].itemId`：必填，来自 `resultData.human_review_items[].id`。
- `itemReviews[].agreeWithResultAssessment`：必填，是否同意当前系统判断。
- `itemReviews[].resultAssessment`：必填，必须使用读取结果时的 `current_assessment`。
- `itemReviews[].correctedAssessment`：当 `agreeWithResultAssessment=false` 时必填。
- `itemReviews[].reason`：当 `agreeWithResultAssessment=false` 时必填。
- `itemReviews[].comment`：可选。

### riskReviews 字段规则

- `riskReviews`：可选；缺失或空数组合法。
- `riskReviews[].riskId`：必填，来自 `resultData.risks[].id`。
- `riskReviews[].agreeWithResultLevel`：必填，是否同意当前风险等级。
- `riskReviews[].resultLevel`：必填，必须使用读取结果时的 `level`。
- `riskReviews[].correctedLevel`：当 `agreeWithResultLevel=false` 时必填。
- `riskReviews[].reason`：当 `agreeWithResultLevel=false` 时必填。
- `riskReviews[].comment`：可选。

人工复核只提交“是否同意当前结果”和“修正后的逐条判断”，不提交任何分数。

## 6. 提交示例

### 同意当前判断

```json
{
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "itemReviews": [
    {
      "itemId": 1,
      "agreeWithResultAssessment": true,
      "resultAssessment": "G1"
    }
  ],
  "riskReviews": [
    {
      "riskId": 1,
      "agreeWithResultLevel": true,
      "resultLevel": "medium"
    }
  ]
}
```

### 修正判断

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
      "resultAssessment": "G1",
      "correctedAssessment": "none",
      "reason": "当前证据不足以触发 G1。",
      "comment": "取消该复核项。"
    }
  ],
  "riskReviews": [
    {
      "riskId": 2,
      "agreeWithResultLevel": false,
      "resultLevel": "medium",
      "correctedLevel": "none",
      "reason": "人工复核认为该项不构成有效风险。"
    }
  ]
}
```

## 7. 提交成功响应

```json
{
  "success": true,
  "taskId": 273,
  "status": "completed",
  "summary": {
    "itemReviewCount": 1,
    "riskReviewCount": 3,
    "riskAgreementCount": 1,
    "riskDisagreementCount": 2,
    "datasetItemCount": 4,
    "scoreRecalculationApplied": true,
    "originalTotalScore": 69,
    "revisedTotalScore": 96,
    "changedItemScoreCount": 2,
    "changedDimensionScoreCount": 2
  },
  "message": "人工复核结果已接收，结果分数已重新计算。"
}
```

### 前端重点使用字段

- `success`：是否提交成功。
- `message`：可用于 Toast。
- `summary.itemReviewCount`：本次提交的普通复核项数量。
- `summary.riskReviewCount`：本次提交的风险复核项数量。
- `summary.riskAgreementCount`：同意当前风险等级的数量。
- `summary.riskDisagreementCount`：修正风险等级的数量。
- `summary.scoreRecalculationApplied`：本次复核是否导致分数重算。
- `summary.originalTotalScore`：复核前总分。
- `summary.revisedTotalScore`：复核后总分。

提交成功后，前端应重新调用：

```http
GET /score/remote-tasks/:taskId/result
```

以最新 `resultData` 更新页面，不要只依赖提交响应局部刷新。

## 8. 复核后结果字段

复核成功后，结果接口返回的 `resultData` 可能新增：

```json
{
  "human_review_revision": {
    "applied": true,
    "reviewed_at": "2026-05-06T06:38:24.926Z",
    "reviewer": {
      "id": "alice",
      "role": "qa"
    },
    "score_recalculation": {
      "original_total_score": 69,
      "revised_total_score": 96,
      "original_hard_gate_triggered": true,
      "revised_hard_gate_triggered": false,
      "changed_item_count": 1,
      "changed_risk_count": 2
    },
    "item_reviews": [],
    "risk_reviews": []
  }
}
```

前端展示建议：

- `human_review_revision.applied=true`：显示“已复核”，并禁用再次提交。
- `reviewed_at`：复核时间。
- `reviewer`：复核人信息。
- `score_recalculation.original_total_score` 和 `revised_total_score`：展示分数变化。
- `score_recalculation.original_hard_gate_triggered` 和 `revised_hard_gate_triggered`：展示硬门槛状态变化。
- `item_reviews` / `risk_reviews`：可作为复核记录展示。

复核后可能变化的结果字段：

- `overall_conclusion.total_score`
- `overall_conclusion.hard_gate_triggered`
- `overall_conclusion.summary`
- `dimension_results[].score`
- `dimension_results[].item_results[].score`
- `risks[].level`
- `human_review_revision`

## 9. 错误响应

### 400

表示请求体不合法。常见原因：

- `itemReviews` 或 `riskReviews` 不是数组。
- `itemId` / `riskId` 不是正整数。
- 同一次提交中重复提交同一个 `itemId` 或 `riskId`。
- 不同意当前判断时缺少修正值或原因。
- `correctedLevel` 不是 `high | medium | low | none`。
- 请求体包含不支持的字段。

前端处理：

- 展示后端返回的 `message`。
- 保留用户输入，方便修正后再次提交。

### 404

表示任务或结果不存在。前端可提示任务结果不存在或已失效。

### 409

表示当前状态不允许提交。常见原因：

- 任务还未完成。
- 页面上的当前判断已经过期。
- 该任务已经成功提交过人工复核。

前端处理：

- 重新调用 `GET /score/remote-tasks/:taskId/result` 刷新结果。
- 如果刷新后存在 `human_review_revision.applied=true`，展示已复核状态并禁用提交。

## 10. 页面状态建议

```ts
const result = response.resultData;
const reviewApplied = result.human_review_revision?.applied === true;
const canReview = response.status === "completed" && !reviewApplied;
```

- `canReview=true`：展示人工复核表单。
- `reviewApplied=true`：展示复核记录，禁用提交。
- `response.status !== "completed"`：不展示复核入口。

## 11. 前端提交前校验清单

- `itemReviews[].itemId` 不重复。
- `riskReviews[].riskId` 不重复。
- `itemReviews[].resultAssessment` 使用接口返回的 `current_assessment`。
- `riskReviews[].resultLevel` 使用接口返回的 `level`。
- 不同意普通复核项时，`correctedAssessment` 和 `reason` 非空。
- 不同意风险项时，`correctedLevel` 和 `reason` 非空。
- `correctedLevel` 只允许 `high | medium | low | none`。
- 不提交任何分数。
