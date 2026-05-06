# 人工复核整单 Agent 问题反馈设计

## 背景

`POST /score/remote-tasks/:taskId/human-review` 当前只接收两类逐条复核数据：

- `itemReviews`：针对 `result.json.human_review_items[]` 的普通人工复核项。
- `riskReviews`：针对 `result.json.risks[]` 的风险等级复核项。

这两类数据能沉淀“某条自动结果是否正确”，但无法收集复核人对本次 agent 整体遗漏、误判、表达问题或其他观察的自由反馈。新的需求是在同一个人工复核提交中新增一个独立字段，让复核人填写文字反馈，并用单独 JSONL 数据集文件记录。

## 目标

- 在 `POST /score/remote-tasks/:taskId/human-review` 请求体中新增可选字段 `agentIssueFeedback`。
- `agentIssueFeedback` 只接受字符串，表示复核人认为本次 agent 还有哪些遗漏和问题。
- 字段缺失、空字符串、全空白字符串都合法；缺失或空白时不写入反馈数据集。
- 字段有有效文本时，单独写入 `agent_issue_feedbacks.jsonl`。
- 反馈样本与 `item_review_calibrations.jsonl`、`risk_review_calibrations.jsonl` 分开存储。
- 保持现有 `itemReviews`、`riskReviews` 结构和行为不变。
- 成功响应中增加本次写入的反馈计数，便于前端确认提交结果。

## 非目标

- 不新增真实数据库表或迁移。本阶段继续沿用当前 `HumanReviewEvidenceStore` 的 JSONL 数据集模式。
- 不新增标签、分类、严重等级、结构化问题类型或附件。
- 不要求反馈必填。
- 不把完整 human-review 请求体原样保存。
- 不把 `agentIssueFeedback` 写入 `outputs/result.json` 或 `human_review_revision`。
- 不根据反馈内容重新计分。
- 不接入后续 agent 学习、检索、prompt 注入或自动分类流程。
- 不新增 workflow/node。

## 请求协议

接口路径保持不变：

```http
POST /score/remote-tasks/:taskId/human-review
Content-Type: application/json
```

请求体新增字段：

```json
{
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "itemReviews": [],
  "riskReviews": [],
  "agentIssueFeedback": "agent 漏掉了接口失败时无错误提示的问题，并且对 G3 风险判断偏重。"
}
```

### agentIssueFeedback 字段

- `agentIssueFeedback`：可选字符串。
- 缺失时合法，不写入 `agent_issue_feedbacks.jsonl`。
- 值为 `""` 或全空白字符串时合法，不写入 `agent_issue_feedbacks.jsonl`。
- 值为非空字符串时，服务端 `trim` 后写入反馈数据集。
- 值存在但不是字符串时返回 `400`。

`agentIssueFeedback` 是整单自由反馈，不绑定 `itemId` 或 `riskId`。它用于记录复核人认为本次 agent 还有哪些遗漏、误判、解释不清、证据不足或其他问题。

## 校验规则

沿用现有任务和逐条复核校验：

- 任务不存在：`404`。
- 任务未完成：`409`。
- `outputs/result.json` 不存在：`404`。
- `itemReviews` 和 `riskReviews` 继续按现有规则校验。

新增请求体校验：

- body 必须是 object。
- `agentIssueFeedback` 缺失合法。
- `agentIssueFeedback` 为字符串合法。
- `agentIssueFeedback` 为非字符串返回 `400`，错误信息建议为：

```json
{
  "success": false,
  "taskId": 88,
  "message": "agentIssueFeedback must be a string"
}
```

空反馈不算错误：

```json
{
  "agentIssueFeedback": "   "
}
```

该请求不写入反馈数据集，响应中的 `agentIssueFeedbackCount` 为 `0`。

## 数据集设计

新增 dataset type：

```ts
type HumanReviewDatasetType =
  | "item_review_calibration"
  | "risk_review_calibration"
  | "agent_issue_feedback";
```

新增 JSONL 文件：

```text
<HUMAN_REVIEW_EVIDENCE_ROOT>/datasets/agent_issue_feedbacks.jsonl
```

每次成功提交中，如果 `agentIssueFeedback.trim()` 非空，则追加一行样本：

```json
{
  "type": "agent_issue_feedback",
  "taskId": 88,
  "testCaseId": 188,
  "taskSummary": "case-188 | bug_fix",
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "feedback": "agent 漏掉了接口失败时无错误提示的问题，并且对 G3 风险判断偏重。",
  "submittedAt": "2026-05-06T10:00:00.000Z"
}
```

字段说明：

- `type`：固定为 `agent_issue_feedback`。
- `taskId`：远程任务 ID。
- `testCaseId`：远程任务记录中的测试用例 ID；没有时可省略或写为 `undefined` 由 JSON 序列化自然移除。
- `taskSummary`：复用现有 `buildTaskSummary(resultJson)`，与 item/risk 校准样本保持一致。
- `reviewer`：透传请求体中的 `reviewer`，如果未提交可省略。
- `feedback`：`agentIssueFeedback.trim()` 后的文本。
- `submittedAt`：服务端接收并写入样本的时间，ISO 字符串。

样本不生成 `reviewId`、`evidenceId` 或额外主键。分析时使用 `taskId`、`testCaseId`、`submittedAt` 和文件行记录定位样本。

## 处理流程

```text
POST /score/remote-tasks/:taskId/human-review
  -> 解析 taskId
  -> 校验 body 是 object
  -> 解析 itemReviews、riskReviews、agentIssueFeedback
  -> 校验任务存在且 completed
  -> 读取 outputs/result.json
  -> 校验 itemReviews 和 riskReviews 与 result.json 一致
  -> 如存在逐条复核项，执行现有分数重算逻辑
  -> 写入 item_review_calibrations.jsonl
  -> 写入 risk_review_calibrations.jsonl
  -> 如果 agentIssueFeedback.trim() 非空，写入 agent_issue_feedbacks.jsonl
  -> 如发生重算，原子写回 outputs/result.json
  -> 返回同步处理结果
```

反馈写入失败应和现有数据集写入失败保持一致：接口抛出错误，由服务端统一错误处理中断本次请求。首版本不做部分成功状态。

## 响应设计

成功响应的 `summary` 增加：

- `agentIssueFeedbackCount`：本次写入 `agent_issue_feedbacks.jsonl` 的样本数，只能是 `0` 或 `1`。
- `datasetItemCount`：继续表示本次写入全部 human-review 数据集的总样本数，应包含 agent issue feedback 样本。

示例：

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
    "agentIssueFeedbackCount": 1,
    "datasetItemCount": 4
  },
  "message": "人工复核结果已接收。"
}
```

只有自由反馈、没有逐条复核时也合法：

```json
{
  "agentIssueFeedback": "agent 没有指出空态页面缺少重试入口。"
}
```

响应：

```json
{
  "success": true,
  "taskId": 88,
  "status": "completed",
  "summary": {
    "itemReviewCount": 0,
    "riskReviewCount": 0,
    "riskAgreementCount": 0,
    "riskDisagreementCount": 0,
    "agentIssueFeedbackCount": 1,
    "datasetItemCount": 1
  },
  "message": "人工复核结果已接收。"
}
```

空 body 仍然合法：

```json
{}
```

响应中的 `agentIssueFeedbackCount` 和 `datasetItemCount` 都为 `0`，除非未来还有其他数据集写入。

## 需要修改的位置

### `src/humanReview/humanReviewTypes.ts`

- `HumanReviewSubmissionPayload` 增加：

```ts
agentIssueFeedback?: string;
```

- `HumanReviewDatasetType` 增加：

```ts
"agent_issue_feedback"
```

### `src/humanReview/humanReviewEvidenceStore.ts`

在 `DATASET_FILE_NAMES` 中增加映射：

```ts
agent_issue_feedback: "agent_issue_feedbacks.jsonl"
```

### `src/api/humanReviewHandler.ts`

- `parseSubmissionPayload` 解析并校验 `agentIssueFeedback`。
- 返回 payload 时保留 `agentIssueFeedback`。
- 新增 helper，例如 `appendAgentIssueFeedbackSample`：
  - 如果 `payload.agentIssueFeedback?.trim()` 为空，返回 `0`。
  - 否则追加一条 `agent_issue_feedback` 样本并返回 `1`。
- 成功响应 `summary` 增加 `agentIssueFeedbackCount`。
- `datasetItemCount` 改为 `itemDatasetCount + riskDatasetCount + agentIssueFeedbackCount`。

### `src/api/apiDefinitions.ts`

- `POST /score/remote-tasks/:taskId/human-review` 请求体说明增加 `agentIssueFeedback` 字段。
- 成功响应 `summary` 描述增加 `agentIssueFeedbackCount`。
- 描述中明确 `datasetItemCount` 包含 item/risk 校准样本和 agent issue feedback 样本。

### `tests/human-review-ingestion.test.ts`

新增或更新测试：

- `agentIssueFeedback` 为非字符串返回 `400`。
- `agentIssueFeedback` 缺失时合法，`agentIssueFeedbackCount=0`。
- `agentIssueFeedback` 为空字符串或全空白字符串时合法，不创建或不追加反馈样本，`agentIssueFeedbackCount=0`。
- 只有 `agentIssueFeedback`、没有 `itemReviews` 和 `riskReviews` 时合法，写入 `agent_issue_feedbacks.jsonl`。
- `itemReviews`、`riskReviews`、`agentIssueFeedback` 同时存在时，三个数据集分别写入，`datasetItemCount` 为三类样本总数。
- 写入的反馈样本包含 `type`、`taskId`、`testCaseId`、`taskSummary`、`feedback`、`submittedAt`，并在有 reviewer 时包含 `reviewer`。
- 写入样本不包含完整 raw payload、`reviewId` 或 `evidenceId`。

## 测试命令

聚焦测试：

```bash
npm test -- tests/human-review-ingestion.test.ts
```

如果项目测试脚本不支持按文件过滤，则运行仓库现有完整测试命令：

```bash
npm test
```

## 取舍

该设计把整单自由反馈作为第三类 human-review 数据集样本，而不是混入逐条 item/risk 校准样本。这样前端只需要新增一个文本框和一个字符串字段，后端只增加轻量解析、校验和 JSONL 追加逻辑。

首版本只存文本，不做结构化标签或自动分类。这样能快速收集“agent 漏了什么、哪里判断不对”这类高价值人工观察，同时避免在需求尚未稳定时过早设计复杂表结构。
