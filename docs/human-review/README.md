# 人工复核流程

本文说明 `POST /score/remote-tasks/:taskId/human-review` 的使用流程、服务端处理规则、复核后重算逻辑和产物位置。它面向接口联调、管理台接入和后续排查。

## 适用场景

人工复核用于修正已完成远端任务中的逐条评分判断或风险等级，并提交整单 L1-L6 人工评级。它不重新运行完整评分 workflow。

适合使用人工复核的情况：

- 人工确认某个 `human_review_items[]` 的判断不准确。
- 人工确认某个 `risks[]` 的风险等级需要调整。
- 人工想补充 agent 未识别、未发现或未充分说明的问题。
- 人工提交整单 L1-L6 评级，并在与自动分差异较大时触发差异分析。

不适合使用人工复核的情况：

- 人工想直接改总分、维度分或评分项分。当前接口不接受人工直接提交分数。
- 任务还未完成。接口只处理 `completed` 的远端任务。

## 前置数据

人工复核依赖远端任务已经完成，并且本地存在：

```text
.local-cases/<case-id>/
  outputs/result.json
```

服务端会从 `remote-task-index.json` 找到 `taskId` 对应的 `caseDir`，再读取 `outputs/result.json`。

管理台通常先调用：

```http
GET /score/remote-tasks/:taskId/result
```

从结果中展示：

- `human_review_items[]`：待人工确认的逐条复核项。
- `risks[]`：风险项及当前风险等级。
- `overall_conclusion`：当前总分和硬门槛状态。

## 请求格式

接口路径：

```http
POST /score/remote-tasks/:taskId/human-review
Content-Type: application/json
```

请求体：

```json
{
  "reviewer": "qa-user-1",
  "manualLevel": "L3",
  "overallComment": "人工补充：agent 未发现异常态缺少 toast 提示。",
  "itemReviews": [
    {
      "itemId": 1,
      "agree": false,
      "reason": "该证据不足，不应触发硬门槛。"
    }
  ],
  "riskReviews": [
    {
      "riskId": 1,
      "agree": false,
      "correctedLevel": "medium",
      "reason": "风险存在，但影响范围低于 high。"
    }
  ]
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `reviewer` | string | 否 | 复核人标识。 |
| `manualLevel` | enum | 是 | 整单人工评级，可选 `L1`、`L2`、`L3`、`L4`、`L5`、`L6`。 |
| `overallComment` | string | 否 | 整体评价，用于补充 agent 未识别、未发现或未充分说明的问题；人工评级差异分析会将它作为评级依据。 |
| `itemReviews` | array | 否 | 对 `result.json.human_review_items[]` 的逐条复核。 |
| `itemReviews[].itemId` | number | 是 | 复核项 ID。缺少 ID 的历史结果按数组位置从 1 映射。 |
| `itemReviews[].agree` | boolean | 是 | 是否同意当前复核项判断。 |
| `itemReviews[].reason` | string | 条件必填 | `agree=false` 时必填。 |
| `riskReviews` | array | 否 | 对 `result.json.risks[]` 的风险等级复核。 |
| `riskReviews[].riskId` | number | 是 | 风险项 ID。缺少 ID 的历史结果按数组位置从 1 映射。 |
| `riskReviews[].agree` | boolean | 是 | 是否同意当前风险等级。 |
| `riskReviews[].correctedLevel` | enum | 条件必填 | `agree=false` 时必填，可选 `high`、`medium`、`low`、`none`。 |
| `riskReviews[].reason` | string | 条件必填 | `agree=false` 时必填。 |

`itemReviews` 和 `riskReviews` 可以同时缺省或为空数组。此时接口只记录整单人工评级，不会写入逐项数据集，也不会触发复核重算。

## 校验规则

服务端会做以下校验：

- `taskId` 必须能在远端任务 registry 中找到。
- 任务状态必须是 `completed`。
- `outputs/result.json` 必须存在且可解析。
- `manualLevel` 必须是 `L1` 到 `L6`。
- `itemReviews` 和 `riskReviews` 如果出现，必须是数组。
- 同一个请求中 `itemId` 不能重复，`riskId` 不能重复。
- `agree` 必须是 boolean。
- `agree=false` 时，必须提供非空 `reason`。
- `riskReviews[].agree=false` 时，必须提供合法 `correctedLevel`。
- 提交的 `itemId` 必须能匹配 `result.json.human_review_items[]`。
- 提交的 `riskId` 必须能匹配 `result.json.risks[]`。
- 如果 `result.json` 已存在 `human_review_revision`，再次提交会直接覆盖为最新复核结果，不保留历史 revision。

当前简化协议不再要求客户端回传原始判断、原始风险等级或评分项修正结论，也不再单独提交 `basis`。服务端以 `id` 从 `result.json` 读取当前结果，人工评级依据取 `overallComment`，缺省时按空字符串记录。

## 服务端处理流程

接口实现位于：

- `src/api/humanReviewHandler.ts`
- `src/humanReview/applyHumanReviewRecalculation.ts`
- `src/humanReview/humanReviewEvidenceStore.ts`
- `src/humanRating/humanRatingSubmission.ts`

处理步骤：

1. 解析并校验请求体。
2. 从 registry 读取远端任务记录。
3. 校验任务已完成，并读取 `outputs/result.json`。
4. 按 `itemId` 和 `riskId` 校验提交项存在。
5. 将逐项复核样本追加写入人工复核数据集。
6. 如果有逐项复核，调用重算逻辑。
7. 如果重算成功，将修正后的 `outputs/result.json` 原子写回。
8. 按 `manualLevel` 和最新总分执行人工评级差异分析；`overallComment` 作为评级依据。
9. 返回同步处理摘要。

成功响应示例：

```json
{
  "success": true,
  "taskId": 703,
  "status": "completed",
  "summary": {
    "itemReviewCount": 0,
    "riskReviewCount": 1,
    "riskAgreementCount": 0,
    "riskDisagreementCount": 1,
    "datasetItemCount": 1,
    "hasOverallComment": true,
    "manualLevel": "L3",
    "autoScore": 100,
    "autoRating": "L6",
    "gapQualified": false,
    "analysisStatus": "skipped",
    "scoreRecalculationApplied": true,
    "originalTotalScore": 79,
    "revisedTotalScore": 100,
    "changedItemScoreCount": 3,
    "changedDimensionScoreCount": 3
  },
  "message": "人工复核结果已接收，结果分数已重新计算。"
}
```

## 数据集写入

人工复核样本写入 `HUMAN_REVIEW_EVIDENCE_ROOT` 下的 `datasets/` 目录。

默认本地路径：

```text
~/.hmos-score-agent/human-review-evidences/datasets/
```

逐条评分项复核写入：

```text
item_review_calibrations.jsonl
```

风险项复核写入：

```text
risk_review_calibrations.jsonl
```

风险项样本示例：

```json
{
  "type": "risk_review_calibration",
  "taskId": 703,
  "testCaseId": 195,
  "riskId": 1,
  "taskSummary": "remote-task-703 | continuation",
  "resultRisk": {
    "id": 1,
    "level": "high",
    "title": "规则违规：ARKTS-FORBID-001"
  },
  "humanReview": {
    "agree": false,
    "correctedLevel": "medium",
    "reason": "风险存在，但影响范围低于 high。",
    "overallComment": "人工补充：agent 未充分说明长期维护风险。"
  }
}
```

注意：数据集样本里的 `resultRisk` / `resultReviewItem` 记录的是复核前的自动结果，便于后续校准模型或分析人工与自动判断的差异。

## 重算规则

人工复核后的重算遵循一个核心原则：

人工只改变结构化评分信号，服务端只根据 `result.json` 中已有的 `score_effect` 元数据重算，不从 `reason` 或 `overallComment` 推断分数。`overallComment` 只作为人工评级差异分析的文字依据。

### 风险等级重算

当 `riskReviews[].agree=false` 且目标风险项带有：

```json
{
  "score_effect": {
    "type": "risk_level_rule_impact"
  }
}
```

服务端会：

1. 将 `risks[].level` 更新为 `correctedLevel`。
2. 读取 `level_weights`。
3. 按等级权重缩放该规则原始扣分：

```text
corrected_delta = original_score_delta / original_weight * corrected_weight
```

默认权重通常是：

```json
{
  "high": 1,
  "medium": 0.6,
  "low": 0.3,
  "none": 0
}
```

4. 更新关联 `dimension_results[].item_results[].rule_impacts[].score_delta`。
5. 根据 `hard_gate_active_levels` 判断是否保留 hard gate。
6. 重新计算评分项分、维度分和总分。

如果风险项没有 `score_effect`，人工改等级只会记录复核结果，不参与分数重算。

### 复核项记录

`itemReviews` 当前只表达人工是否同意复核项，以及不同意时的原因。服务端不再要求或读取评分项修正结论，因此评分项复核不会根据 `human_review_items[].score_effect` 改写 hard gate 或规则扣分。

风险项复核仍支持通过 `correctedLevel` 触发风险等级相关的分数重算。

### 评分项档位收敛

每个评分项会先计算：

```text
raw_score = base_score + sum(rule_impacts.score_delta)
```

然后如果该评分项带有 `score_recalculation.scoring_bands`，服务端会把 `raw_score` 收敛到最近的 rubric 档位。

这意味着：小额扣分在某些 rubric 档位下可能不会改变最终评分项分。例如一个评分项基础分为 8，人工复核后剩余扣分为 `-0.72`，`raw_score=7.28`，如果可选档位是 `8/6/4/0`，最终仍会落到最近的 `8`。

如果业务希望 medium 风险一定体现在总分上，需要调整对应规则的扣分权重、rubric 档位或重算收敛策略，而不是从人工复核接口直接填分。

## result.json 写回

复核成功后，接口会原地更新：

```text
.local-cases/<case-id>/outputs/result.json
```

关键变化：

- `overall_conclusion.total_score`
- `overall_conclusion.hard_gate_triggered`
- `overall_conclusion.summary`
- `risks[].level`
- `dimension_results[].score`
- `dimension_results[].item_results[].score`
- `dimension_results[].item_results[].rule_impacts[].score_delta`
- `dimension_results[].item_results[].score_fusion`
- 新增 `human_review_revision`

`human_review_revision` 示例：

```json
{
  "human_review_revision": {
    "applied": true,
    "reviewed_at": "2026-05-12T07:07:16.785Z",
    "reviewer": "codex-local-check",
    "overall_comment": "人工复核补充：当前 agent 未强调长期维护和类型安全影响。",
    "score_recalculation": {
      "original_total_score": 79,
      "revised_total_score": 100,
      "original_hard_gate_triggered": true,
      "revised_hard_gate_triggered": false,
      "changed_item_count": 0,
      "changed_risk_count": 1
    },
    "item_reviews": [],
    "risk_reviews": [
      {
        "riskId": 1,
        "agree": false,
        "correctedLevel": "medium",
        "reason": "风险存在，但影响范围低于 high。",
        "score_effect_applied": true
      }
    ]
  }
}
```

## 本次样例复盘

本地最新远端用例：

```text
taskId: 703
caseDir: .local-cases/20260512T025612_full_generation_629796ef
```

复核前：

- `overall_conclusion.total_score = 79`
- `overall_conclusion.hard_gate_triggered = true`
- `risks[0].level = high`
- 风险项为 `规则违规：ARKTS-FORBID-001`
- 该风险带有 `score_effect.type=risk_level_rule_impact`
- 该风险的 `hard_gate_active_levels = ["high"]`

人工复核请求将 `riskId=1` 从 `high` 改为 `medium`。

复核后：

- `risks[0].level = medium`
- `hard_gate_triggered = false`
- `overall_conclusion.total_score = 100`
- `human_review_revision.risk_reviews[0].score_effect_applied = true`
- `risk_review_calibrations.jsonl` 追加 1 条样本

本次总分从 79 到 100 是合理的，原因是：

1. 原 79 分主要由 G3 hard gate cap 限制。
2. 该风险从 `high` 下调为 `medium` 后，不再满足 `hard_gate_active_levels=["high"]`，因此 G3 cap 被解除。
3. 规则扣分仍然保留，但按 medium 权重缩放为原来的 60%。
4. 缩放后的剩余扣分较小，经过评分项 rubric 档位收敛后，相关评分项回到当前档位满分。
5. 维度分汇总后没有新的 hard gate cap，因此总分回到 100。

如果后续认为“medium 等级仍应降低总分”，需要调优评分体系，而不是改变这次复核接口：

- 提高 medium 权重对应的扣分影响。
- 调整相关 rubric 档位，让小额扣分能落入较低档。
- 改变人工复核重算时的档位收敛策略。
- 设置某些 medium 风险仍触发特定 hard gate。

## 排查命令

查看任务记录：

```bash
node -e "const fs=require('fs'); const x=JSON.parse(fs.readFileSync('.local-cases/remote-task-index.json','utf8')); console.log(JSON.stringify(x.records.find(r=>r.taskId===703), null, 2));"
```

查看复核后的结果摘要：

```bash
node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync('.local-cases/20260512T025612_full_generation_629796ef/outputs/result.json','utf8')); console.log(JSON.stringify({overall:r.overall_conclusion, risks:r.risks, revision:r.human_review_revision}, null, 2));"
```

查看风险复核数据集最后一条：

```bash
tail -n 1 ~/.hmos-score-agent/human-review-evidences/datasets/risk_review_calibrations.jsonl
```

检查数据集行数：

```bash
wc -l ~/.hmos-score-agent/human-review-evidences/datasets/risk_review_calibrations.jsonl
```

## 注意事项

- 人工复核会改写 `outputs/result.json`，后续 `GET /score/remote-tasks/:taskId/result` 返回的是修正后结果。
- 再次提交人工复核会覆盖最新 `human_review_revision` 和 `human-rating/manual-rating.json`。
- 人工评级差异分析不会改写 `outputs/result.json`。
- `overallComment` 用于记录整体人工观察并作为人工评级依据，不参与分数重算。
- 数据集样本用于后续校准和分析，不是恢复原始结果的备份。
