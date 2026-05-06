# 人工复核后基于逐条判定重新计分设计

## 背景

`POST /score/remote-tasks/:taskId/human-review` 当前接收逐条人工复核数据，并写入 `item_review_calibrations.jsonl` 与 `risk_review_calibrations.jsonl`。现有处理不修改用例 `outputs/result.json`，`GET /score/remote-tasks/:taskId/result` 直接读取原始 `result.json`。

新的目标是：服务端接收到人工复核数据后，根据人工对每条复核项、风险项的判定结果重新计算分数，并让查询结果接口返回修正后的得分。人工不提供分数，也不提交整单 overall 结论。

接口仍是首版本开发，不考虑历史接口兼容，不新增 workflow/node 节点，不接入后续 agent，不保存完整 human-review payload。

## 核心结论

首版本采用“逐条判定 -> 修改评分信号 -> 重算分数”的方案：

- 人工只提交逐条同意/不同意结果。
- `itemReviews` 影响与其绑定的评分信号，例如 hard gate 是否成立、规则判定是否成立。
- `riskReviews` 影响与风险项绑定的风险等级评分映射。
- 服务端根据 `result.json` 中预先生成的 `score_effect` 元数据重新计算评分项分、维度分、总分和 hard gate cap。
- 如果某条复核项没有 `score_effect`，它只沉淀数据集和复核记录，不参与重算。

这避免人工直接填分，也避免服务端从 `reason` 或 `correctedAssessment` 这类自然语言字段里猜测分数。

## 当前评分规则核对

当前评分代码中，`risks[].level` 本身不直接参与原始自动评分。自动评分主要来自：

- rubric agent 给出的评分项基础分。
- 规则命中后生成的 `score_fusion.rule_impacts[].score_delta`。
- `score_fusion.rule_delta` 汇总规则扣分，得到 `score_fusion.final_score`。
- `dimension_results[].score` 汇总评分项分数。
- `overall_conclusion.total_score` 汇总维度分数后，再应用 hard gate score cap。

风险项当前是评分过程的展示结果，不是评分输入。同一条规则违规可能同时生成风险项和扣分，但扣分来自 `rule_impacts[].score_delta`，不是来自 `risks[].level`。

为了让人工风险等级复核能影响重算分数，首版本需要显式建立风险等级到已有扣分信号的映射。这个映射只用于人工复核后的重算，不改变自动评分生成阶段的规则。

## 目标

- 人工复核请求不包含分数。
- `human-review` 接口在校验通过后，根据逐条复核结果同步重新计分。
- 修正后的完整 `result.json` 原地写回 `outputs/result.json`。
- `GET /score/remote-tasks/:taskId/result` 继续读取 `outputs/result.json`，自然返回修正后的得分。
- 保留原始自动评分分数、人工修改项、重算明细，便于排查。
- `itemReviews` 与 `riskReviews` 仍然都不是必填，缺失或空数组合法。
- 不保存完整请求 payload。
- 不新增 workflow/node。

## 非目标

- 不重新运行完整评分流程。
- 不重新调用 rubric agent 或 rule agent。
- 不让人工提交总分、维度分、评分项分。
- 不让人工提交 overall 结论。
- 不从自然语言 `reason` 推断分数。
- 不支持多轮复核覆盖；首版本同一任务只允许成功写回一次人工复核。
- 不引入旧协议兼容字段或字段别名。

## result.json 结构补充

为了让接口能基于逐条判定重新计分，生成 `result.json` 时需要给可影响分数的复核项增加 `score_effect`。

### 风险项 score_effect

规则违规生成的风险项需要携带其对应的扣分影响。示例：

```json
{
  "risks": [
    {
      "id": 3,
      "level": "high",
      "title": "规则违规：ARKTS-FORBID-026",
      "description": "禁止在 finally 代码块中使用 return、break、continue 或抛出未处理异常。",
      "evidence": "CheckinPageVM.ets",
      "score_effect": {
        "type": "risk_level_rule_impact",
        "rule_id": "ARKTS-FORBID-026",
        "original_level": "high",
        "level_weights": {
          "high": 1,
          "medium": 0.6,
          "low": 0.3,
          "none": 0
        },
        "hard_gate_ids": ["G3"],
        "hard_gate_active_levels": ["high"],
        "gate_caps": {
          "G3": 79
        },
        "impacts": [
          {
            "dimension_name": "代码质量与可维护性",
            "item_name": "复杂度控制",
            "original_score_delta": -3.5
          },
          {
            "dimension_name": "可靠性与安全性",
            "item_name": "稳定性风险",
            "original_score_delta": -4
          }
        ]
      }
    }
  ]
}
```

字段说明：

- `type=risk_level_rule_impact` 表示该风险等级变化会按等级权重调整关联扣分。
- `rule_id` 用于关联 `dimension_results[].item_results[].rule_impacts[]` 中的规则影响。
- `original_level` 是自动评分生成的风险等级。
- `level_weights` 是复核重算使用的等级权重。
- `hard_gate_ids` 是该风险对应的 hard gate；没有则为空数组。
- `hard_gate_active_levels` 表示哪些风险等级仍会触发这些 hard gate；默认只包含 `high`。
- `gate_caps` 是 hard gate 对应的 score cap，接口重算时只读取 `result.json`，不临时加载外部 rubric。
- `impacts` 是该风险在自动评分中造成的原始扣分。

rubric agent 自身产出的普通风险如果没有明确扣分影响，可以不带 `score_effect`。人工修改这类风险等级只更新风险展示和复核记录，不影响分数。

### 人工复核项 score_effect

`human_review_items[]` 中能影响分数的项需要携带 `score_effect`。示例：

```json
{
  "human_review_items": [
    {
      "id": 1,
      "item": "硬门槛复核",
      "current_assessment": "G3",
      "uncertainty_reason": "规则分支触发了 rubric hard gate 候选条件。",
      "suggested_focus": "确认规则违规是否真实构成硬门槛风险。",
      "score_effect": {
        "type": "hard_gate",
        "gate_ids": ["G3"],
        "gate_caps": {
          "G3": 79
        }
      }
    }
  ]
}
```

首版本支持两类 `human_review_items[].score_effect`：

- `hard_gate`：人工修正 hard gate 是否成立，重算 score cap。
- `rule_result`：人工修正规则判定是否成立，重算关联 `rule_impacts`。

`rule_result` 示例：

```json
{
  "score_effect": {
    "type": "rule_result",
    "rule_ids": ["ARKTS-FORBID-026"],
    "hard_gate_ids": ["G3"],
    "gate_caps": {
      "G3": 79
    }
  }
}
```

### 评分项重算上下文

为保证重算后的评分项仍能按 rubric 离散档位收敛，`dimension_results[].item_results[]` 需要保留该评分项的可选重算上下文：

```json
{
  "item_name": "复杂度控制",
  "score": 5,
  "score_recalculation": {
    "scoring_bands": [
      { "score": 7, "criteria": "复杂度控制优秀。" },
      { "score": 5, "criteria": "复杂度基本可控。" },
      { "score": 3, "criteria": "复杂度偏高。" },
      { "score": 0, "criteria": "复杂度严重失控。" }
    ]
  }
}
```

如果缺少 `score_recalculation.scoring_bands`，该评分项重算时按两位小数保留，不做档位收敛。

## 请求协议

接口路径保持不变：

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
      "resultAssessment": "G3",
      "correctedAssessment": "none",
      "reason": "该 forbidden_pattern 证据不足，不应触发 G3。",
      "comment": "取消该 hard gate。"
    }
  ],
  "riskReviews": [
    {
      "riskId": 3,
      "agreeWithResultLevel": false,
      "resultLevel": "high",
      "correctedLevel": "medium",
      "reason": "风险存在，但影响范围低于 high。"
    }
  ]
}
```

### itemReviews 字段

- `itemId`：必填，匹配 `result.json.human_review_items[].id`。
- `agreeWithResultAssessment`：必填，是否同意当前复核项判定。
- `resultAssessment`：必填，必须等于匹配项的 `current_assessment`。
- `correctedAssessment`：当 `agreeWithResultAssessment=false` 时必填。
- `reason`：当 `agreeWithResultAssessment=false` 时必填。
- `comment`：可选。

不同 `score_effect.type` 对 `correctedAssessment` 的要求：

- `hard_gate`：只能是 `none` 或由逗号分隔的 gate id 列表，例如 `G1`、`G1,G3`。
- `rule_result`：只能是 `满足`、`不满足`、`不涉及`、`待人工复核`。
- 无 `score_effect`：只要求非空字符串，不参与计分。

### riskReviews 字段

- `riskId`：必填，匹配 `result.json.risks[].id`。
- `agreeWithResultLevel`：必填，是否同意当前风险等级。
- `resultLevel`：必填，必须等于匹配风险项的 `level`。
- `correctedLevel`：当 `agreeWithResultLevel=false` 时必填。
- `reason`：当 `agreeWithResultLevel=false` 时必填。
- `comment`：可选。

风险等级取值：

```text
high | medium | low | none
```

## 重新计分规则

### 基础模型

接口从当前 `result.json` 构造一个临时评分模型：

- 每个评分项读取 `agent_evaluation.base_score`。
- 每个评分项读取当前 `rule_impacts[]`。
- 每个维度读取其评分项集合。
- hard gate 读取 `overall_conclusion.hard_gate_triggered` 以及 `score_effect.hard_gate_ids` 中的 gate 信息。

重算时不调用 agent，不重新跑规则，只修改已有评分信号。

### riskReviews 对分数的影响

当 `riskReviews[].agreeWithResultLevel=true`：

- 对应风险项等级不变。
- 关联 `rule_impacts[].score_delta` 不变。

当 `agreeWithResultLevel=false` 且风险项存在 `score_effect.type=risk_level_rule_impact`：

1. 将 `risks[].level` 改为 `correctedLevel`。
2. 读取 `original_level` 和 `level_weights`。
3. 对每条 `impacts[].original_score_delta` 计算新扣分：

```text
base_delta = original_score_delta / level_weights[original_level]
corrected_delta = base_delta * level_weights[correctedLevel]
```

4. 用 `corrected_delta` 替换匹配 `rule_id + dimension_name + item_name` 的 `rule_impacts[].score_delta`。
5. 根据 `hard_gate_active_levels` 判断该风险关联的 `hard_gate_ids` 是否继续参与 hard gate cap；例如默认配置下，只有 `correctedLevel=high` 时继续触发 G3，改为 `medium`、`low`、`none` 都会移除该风险带来的 G3 cap。

示例：原风险为 `high`，原扣分 `-4`；人工改为 `medium`：

```text
base_delta = -4 / 1 = -4
corrected_delta = -4 * 0.6 = -2.4
```

如果风险项没有 `score_effect`：

- 只更新 `risks[].level`。
- 不调整分数。
- 在 `human_review_revision.risk_reviews[]` 中记录 `score_effect_applied=false`。

### itemReviews 对分数的影响

#### hard_gate

当 `human_review_items[].score_effect.type=hard_gate`：

- `agreeWithResultAssessment=true`：保留当前 gate 结果。
- `agreeWithResultAssessment=false` 且 `correctedAssessment=none`：移除该项 `gate_ids`。
- `agreeWithResultAssessment=false` 且 `correctedAssessment=G1,G3`：将该项 active gate 设置为提交的 gate id 列表。

重算总分时：

```text
raw_total_score = sum(dimension_results[].score)
score_cap = min(active hard gate score caps)
total_score = score_cap 存在 ? min(raw_total_score, score_cap) : raw_total_score
```

hard gate 的 score cap 使用 `score_effect.gate_caps` 中写入的值。接口重算时不临时加载 rubric。

#### rule_result

当 `human_review_items[].score_effect.type=rule_result`：

- `correctedAssessment=不满足`：保留或恢复关联 `rule_impacts[].score_delta`。
- `correctedAssessment=满足` 或 `不涉及`：将关联 `rule_impacts[].score_delta` 置为 `0`，该规则不再产生扣分。
- `correctedAssessment=待人工复核`：将关联 `rule_impacts[].score_delta` 置为 `0`，保留 `needs_human_review=true`。

如果该规则关联 hard gate：

- `不满足`：对应 hard gate 仍可参与 cap。
- `满足`、`不涉及`、`待人工复核`：对应 hard gate 不参与 cap。

### 评分项、维度、总分重算

每个受影响评分项按以下方式重算：

```text
rule_delta = sum(rule_impacts[].score_delta)
raw_item_score = max(0, agent_evaluation.base_score + rule_delta)
item_score = snap_to_scoring_bands(raw_item_score)
```

如果有 `score_recalculation.scoring_bands`，按现有评分逻辑选择距离最近的档位；距离相同取较低档。否则保留两位小数。

然后重算：

- `item_results[].score`
- `item_results[].score_fusion.rule_delta`
- `item_results[].score_fusion.final_score`
- `item_results[].score_fusion.fusion_logic`
- `dimension_results[].score`
- `dimension_results[].rule_violation_summary.total_rule_delta`
- `overall_conclusion.total_score`
- `overall_conclusion.hard_gate_triggered`
- `overall_conclusion.summary`

## human_review_revision

`result.json` 顶层新增 `human_review_revision`，记录人工复核和重算摘要。

示例：

```json
{
  "human_review_revision": {
    "applied": true,
    "reviewed_at": "2026-05-06T10:00:00.000Z",
    "reviewer": {
      "id": "alice",
      "role": "qa"
    },
    "score_recalculation": {
      "original_total_score": 78,
      "revised_total_score": 86,
      "original_hard_gate_triggered": true,
      "revised_hard_gate_triggered": false,
      "changed_item_count": 1,
      "changed_risk_count": 1
    },
    "item_reviews": [
      {
        "itemId": 1,
        "agreeWithResultAssessment": false,
        "resultAssessment": "G3",
        "correctedAssessment": "none",
        "reason": "该 forbidden_pattern 证据不足，不应触发 G3。",
        "score_effect_applied": true
      }
    ],
    "risk_reviews": [
      {
        "riskId": 3,
        "agreeWithResultLevel": false,
        "resultLevel": "high",
        "correctedLevel": "medium",
        "reason": "风险存在，但影响范围低于 high。",
        "score_effect_applied": true
      }
    ]
  }
}
```

`human_review_revision` 是系统计算记录，不是人工 overall 结论。

## 写回策略

写回目标：

```text
<caseDir>/outputs/result.json
```

处理顺序：

1. 读取当前 `result.json`。
2. 校验请求和 `result.json` 中的 `id`、当前结果是否一致。
3. 根据逐条复核结果生成修正后的 `result.json`。
4. 写入 item/risk 校准数据集。
5. 原子写回 `outputs/result.json`。
6. 返回重算摘要。

不新增 `reviewed-result.json`。查询接口只有一个结果来源。

## 查询接口行为

`GET /score/remote-tasks/:taskId/result` 保持路径和响应结构不变，继续返回 `resultData`。由于 `outputs/result.json` 已被写回，查询接口无需额外聚合即可返回修正后的：

- `overall_conclusion.total_score`
- `overall_conclusion.hard_gate_triggered`
- `dimension_results[].score`
- `dimension_results[].item_results[].score`
- `risks[].level`
- `human_review_revision`

远程任务完成 callback 暂不补发。人工复核发生在任务完成之后，当前需求只要求修正查询结果接口。

## 校验规则

在现有校验基础上新增：

- `itemReviews[].resultAssessment` 必须与匹配的 `human_review_items[].current_assessment` 一致。
- `riskReviews[].resultLevel` 必须与匹配的 `risks[].level` 一致。
- `hard_gate` 类型的 `correctedAssessment` 只能是 `none` 或合法 gate id 列表。
- `rule_result` 类型的 `correctedAssessment` 只能是 `满足`、`不满足`、`不涉及`、`待人工复核`。
- `riskReviews[].correctedLevel` 只能是 `high`、`medium`、`low`、`none`。
- 同一次提交中最多出现一次针对同一 `rule_id` 的 score effect 修改；否则返回 `400`，避免同一扣分被两个复核项重复修改。
- 如果 `result.json` 已存在 `human_review_revision.applied=true`，再次提交返回 `409`。

## Schema 更新

`references/scoring/report_result_schema.json` 与测试夹具 schema 需要同步更新：

- `risks[].score_effect` 可选。
- `human_review_items[].score_effect` 可选。
- `dimension_results[].item_results[].score_recalculation` 可选。
- 顶层 `human_review_revision` 可选。

所有新增结构都必须 `additionalProperties=false`，避免完整 payload 或临时调试字段落盘。

## API 响应调整

成功响应增加重算摘要：

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
    "datasetItemCount": 2,
    "scoreRecalculationApplied": true,
    "originalTotalScore": 78,
    "revisedTotalScore": 86,
    "changedItemScoreCount": 2,
    "changedDimensionScoreCount": 1
  },
  "message": "人工复核结果已接收，结果分数已重新计算。"
}
```

如果本次复核没有任何 `score_effect` 被应用：

```json
{
  "scoreRecalculationApplied": false,
  "originalTotalScore": 78,
  "revisedTotalScore": 78
}
```

## 数据集影响

继续生成：

- `datasets/item_review_calibrations.jsonl`
- `datasets/risk_review_calibrations.jsonl`

样本中记录人工逐条判定和是否触发重算，但不保存完整 payload，不生成额外 `reviewId` 或 `evidenceId`。

示例：

```json
{
  "type": "risk_review_calibration",
  "taskId": 900001,
  "testCaseId": 188,
  "riskId": 3,
  "resultRisk": {
    "id": 3,
    "level": "high",
    "title": "规则违规：ARKTS-FORBID-026"
  },
  "humanReview": {
    "agreeWithResultLevel": false,
    "correctedLevel": "medium",
    "reason": "风险存在，但影响范围低于 high。"
  },
  "scoreRecalculation": {
    "applied": true,
    "originalTotalScore": 78,
    "revisedTotalScore": 86
  }
}
```

## 测试计划

### TDD 用例

1. 提交 `hard_gate` item review，将 `G3` 修正为 `none`：
   - 接口成功。
   - 对应 hard gate 不再参与 cap。
   - `overall_conclusion.total_score` 按维度原始总分和剩余 cap 重算。
   - `overall_conclusion.hard_gate_triggered` 更新。
   - 查询接口返回重算后结果。

2. 提交带 `score_effect` 的 risk review，将 `high` 修正为 `medium`：
   - 接口成功。
   - `risks[].level` 更新为 `medium`。
   - 关联 `rule_impacts[].score_delta` 按等级权重重算。
   - 评分项、维度、总分更新。

3. 提交 risk review，将带 `score_effect` 的风险修正为 `none`：
   - 关联 `rule_impacts[].score_delta` 置为 `0`。
   - 关联 hard gate 不再参与 cap。
   - 风险项保留，`level=none`。

4. 提交不带 `score_effect` 的 risk review：
   - 只更新 `risks[].level`。
   - 总分不变。
   - `human_review_revision.risk_reviews[].score_effect_applied=false`。

5. 同一提交中两个复核项修改同一 `rule_id`：
   - 返回 `400`。
   - 不写数据集。
   - 不修改 `result.json`。

6. 已存在 `human_review_revision.applied=true` 再次提交：
   - 返回 `409`。
   - 不写数据集。
   - 不修改 `result.json`。

### 回归验证

- `npm test`
- `npm run lint`
- `npm run build`

## 实现边界建议

建议新增纯函数模块：

```text
src/humanReview/applyHumanReviewRecalculation.ts
```

职责：

- 输入 `resultJson`、`payload`、`reviewer`、`reviewedAt`。
- 输出 `{ resultJson, summary }`。
- 不读写文件，不依赖 Express。
- 只做逐条复核结果到评分信号的转换和重算。

`humanReviewHandler` 只负责请求解析、任务状态校验、读取结果文件、调用纯函数、写数据集、原子写回和返回响应。

## 验收标准

- 人工复核请求不包含任何分数。
- 人工修改 `hard_gate` 复核项后，总分通过 score cap 重算。
- 人工修改带 `score_effect` 的风险等级后，关联扣分和总分重算。
- 查询接口返回的 `resultData.overall_conclusion.total_score` 与写回后的 `result.json` 一致。
- `human_review_revision` 记录原始分、修正分、逐条复核结果和 score effect 是否应用。
- 不落完整 payload。
- 不新增 workflow/node。
- 不接入 agent。
- 不引入历史接口兼容字段。
