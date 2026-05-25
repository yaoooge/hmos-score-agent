# Result JSON v2 Schema 设计

## 背景

当前 `outputs/result.json` 同时承担管理台展示、评分审计、报告渲染和调试追踪职责，导致单个结果文件体积偏大，且同一规则结论在多个字段重复出现。

以 1665 为例，原始 `result.json` 约 153 KB。主要膨胀来源不是必要的全量规则结果，而是：

- `dimension_results.item_results[*].score_recalculation.scoring_bands` 逐项复制 rubric 档位。
- `dimension_results.item_results[*].rule_impacts[*].reason` 和 `evidence` 内容完全相同。
- 规则结论同时出现在 `rule_audit_results`、`risks.description/evidence`、`official_linter_results.conclusion`、`rule_impacts.reason/evidence`、`human_review_items.suggested_focus`。
- `human_review_items` 中硬门槛复核项拼接了完整规则内容，信息过长且与规则结果重复。

管理台只访问 `result.json`，因此本设计保持单 JSON 文件，不拆分 debug 文件，也不依赖 HTML 报告。

## 目标

1. 保留管理台需要的全量规则结果。
2. 增加 `pre_cap_score`，解决硬门槛截断后无法看到截断前分数的问题。
3. 去除重复长文本，让规则结论只在一个位置保存。
4. 移除管理台不需要的 rubric 档位复制。
5. 将风险等级权重从单条 risk 中提到顶层策略配置。
6. 移除 `official_linter_results`，官方 linter 的核心结论统一进入全量规则结果。

## 非目标

- 不新增 ranking 分。
- 不拆成多个 JSON 文件。
- 不删除 `rule_audit_results` 的全量规则列表。
- 不改变现有评分逻辑，只调整结果结构。
- 不要求管理台访问 HTML 或额外 artifact。

## 顶层结构

新版 `result.json` 使用 `schema_version: "result.v2"`，建议结构如下：

```json
{
  "schema_version": "result.v2",
  "basic_info": {},
  "overall_conclusion": {},
  "score_policy": {},
  "dimension_results": [],
  "rule_audit_results": [],
  "risks": [],
  "strengths": [],
  "main_issues": [],
  "human_review_items": [],
  "official_linter_summary": {},
  "build_check_summary": {},
  "report_meta": {}
}
```

空数组字段可以省略，但为了兼容管理台已有字段访问，第一版实现可以暂时保留空数组。

## Overall Conclusion

`overall_conclusion` 增加 `pre_cap_score` 和结构化硬门槛列表。

```json
{
  "total_score": 69,
  "pre_cap_score": 85,
  "hard_gate_triggered": true,
  "hard_gates": [
    {
      "id": "G1",
      "name": "高密度静态错误",
      "score_cap": 69,
      "description": "大量未定义引用、类型错误、import/export 错位或明显不可运行代码片段密集出现。",
      "trigger_reason": "must_rule 不满足数量达到硬门槛阈值",
      "trigger_policy": {
        "type": "must_violation_count",
        "threshold": 2,
        "actual": 3
      },
      "triggered_rule_ids": ["RSP-MUST-03", "CMP-MUST-10", "CMP-MUST-11"]
    }
  ],
  "summary": "已完成 rubric 基础评分与规则修正融合，并触发硬门槛：G1。"
}
```

字段说明：

- `total_score`：最终正式分，受硬门槛上限影响。
- `pre_cap_score`：硬门槛 cap 前的维度分汇总值。
- `hard_gates`：当前触发的硬门槛详情。
- `description`：硬门槛自身含义，来自 rubric hard gate 定义。
- `trigger_reason`：本次为什么触发，不拼接完整规则结论。
- `trigger_policy`：机器可读的触发策略，例如 must 违规数量阈值。
- `triggered_rule_ids`：触发硬门槛的规则 id 列表，用于关联 `rule_audit_results`。

## Score Policy

风险等级权重从每条 risk 的 `score_effect.level_weights` 中移出，放到顶层：

```json
{
  "risk_level_weights": {
    "high": 1,
    "medium": 0.6,
    "low": 0.3,
    "none": 0
  }
}
```

如果管理台不做风险等级人工调整后的前端重算，可以不输出 `score_policy`。如果需要重算，所有 risk 共用这一份配置。

## Dimension Results

保留维度分、item 分、agent 评分摘要、规则扣分和 score fusion 信息。

删除：

- `item_results[*].score_recalculation.scoring_bands`
- `rule_impacts[*].reason`
- `rule_impacts[*].evidence`

规则影响项只保留结构化引用：

```json
{
  "rule_id": "RSP-MUST-03",
  "rule_source": "must_rule",
  "result": "不满足",
  "severity": "medium",
  "score_delta": -2.8,
  "agent_assisted": false,
  "needs_human_review": false
}
```

管理台需要展示扣分原因时，通过 `rule_id` 到 `rule_audit_results` 查 `conclusion`。

## Rule Audit Results

`rule_audit_results` 是规则结论的唯一权威来源，必须全量保留。

```json
{
  "rule_id": "RSP-MUST-03",
  "rule_summary": "断点值分发工具类必须覆盖 sm/md/lg/xl 四个断点。",
  "rule_source": "must_rule",
  "result": "不满足",
  "conclusion": "断点值分发工具类 BreakpointType 未强制覆盖 sm/md/lg/xl 四个断点..."
}
```

要求：

- 包含 `满足`、`不满足`、`不涉及`、`待人工复核` 全量结果。
- 所有其它字段只引用 `rule_id`，不复制 `conclusion`。
- 官方 linter 规则继续以 `OFFICIAL-LINTER:<rule_id>` 形式进入该列表。

## Risks

规则类 risk 不再重复规则结论。

```json
{
  "id": 2,
  "level": "medium",
  "title": "规则违规：RSP-MUST-03",
  "risk_code": "RULE_VIOLATION:RSP-MUST-03",
  "risk_category": "medium",
  "source_rule_id": "RSP-MUST-03",
  "score_effect": {
    "type": "risk_level_rule_impact",
    "rule_id": "RSP-MUST-03",
    "original_level": "medium",
    "hard_gate_ids": ["G1"],
    "hard_gate_active_levels": ["medium"],
    "gate_caps": { "G1": 69 },
    "impacts": [
      {
        "dimension_name": "代码正确性与静态质量",
        "item_name": "ArkTS/ArkUI语法与类型安全",
        "original_score_delta": -2.8
      }
    ]
  }
}
```

删除：

- `description`
- `evidence`
- `score_effect.level_weights`

例外：非规则类 risk 没有 `source_rule_id` 时，可以保留 `description` 和 `evidence`，否则管理台没有其它来源可展示原因。

## Human Review Items

硬门槛复核项应包含硬门槛描述、触发机制和触发规则 id，不拼接完整规则结论。

```json
{
  "id": 1,
  "item": "硬门槛复核",
  "current_assessment": "G1",
  "uncertainty_reason": "G1 高密度静态错误：must_rule 不满足数量为 3，达到触发阈值 2。",
  "suggested_focus": "请确认 G1（高密度静态错误，总分上限 69）是否应因 must_rule 不满足数量达到阈值而保留。",
  "score_effect": {
    "type": "hard_gate",
    "gate_ids": ["G1"],
    "gate_caps": { "G1": 69 },
    "trigger_reason": "must_rule 不满足数量达到硬门槛阈值",
    "trigger_policy": {
      "type": "must_violation_count",
      "threshold": 2,
      "actual": 3
    },
    "triggered_rule_ids": ["RSP-MUST-03", "CMP-MUST-10", "CMP-MUST-11"]
  }
}
```

普通规则复核项也只保留规则 id 和简短说明。需要完整规则结论时，管理台通过 `rule_id` 查 `rule_audit_results`。

## Official Linter

移除 `official_linter_results`。

原因：

- 官方 linter 的规则级结论已经合并进 `rule_audit_results`。
- 规则 id、结果、结论、违规数量摘要均可从 `rule_audit_results` 获取。
- 原 `official_linter_results.conclusion` 与 `rule_audit_results.conclusion` 重复。
- 原 `official_linter_results.affected_items[*].reason` 与规则结论重复。

保留 `official_linter_summary`：

```json
{
  "effectiveFindingCount": 1,
  "runStatus": "success",
  "exitCode": 0,
  "durationMs": 4710
}
```

如果管理台需要逐条 linter finding 的文件、行、列详情，后续应将 findings 合并到对应 `rule_audit_results` 的可选字段中，例如：

```json
{
  "rule_id": "OFFICIAL-LINTER:@cross-device-app-dev/color-value",
  "result": "不满足",
  "conclusion": "...",
  "finding_count": 1,
  "findings": [
    {
      "file": "commons/components/src/main/ets/components/ConvenientService.ets",
      "line": 23,
      "column": 12,
      "severity": "warn",
      "message": "The color values should be set for both dark and light color modes through '$r'."
    }
  ]
}
```

这样仍然保持“规则结论在 `rule_audit_results` 单点存储”。

## 删除字段

第一版 v2 应删除或停止输出：

- `official_linter_results`
- `dimension_results.item_results[*].score_recalculation`
- `dimension_results.item_results[*].rule_impacts[*].reason`
- `dimension_results.item_results[*].rule_impacts[*].evidence`
- 规则类 `risks[*].description`
- 规则类 `risks[*].evidence`
- `risks[*].score_effect.level_weights`
- 硬门槛复核中拼接的完整规则内容
- `artifacts`

## 迁移建议

1. 在 `scoreFusion` 中计算 `pre_cap_score`，即 cap 前的 `rawTotalScore`。
2. 在 hard gate 计算处生成结构化 `hard_gates`，包含 gate 描述、触发策略和触发规则 id。
3. 在 `buildRiskScoreEffect` 中移除 `level_weights`，改为顶层 `score_policy.risk_level_weights`。
4. 在 report/result view model 生成时删除 `score_recalculation.scoring_bands`。
5. 在 `rule_impacts` 中删除 `reason/evidence`，管理台通过 `rule_id` 关联规则结论。
6. 将官方 linter findings 合并到对应 `rule_audit_results` 可选字段；随后移除 `official_linter_results`。
7. 调整硬门槛复核文案，只描述 hard gate 和触发机制，不拼接完整规则内容。
8. 更新 schema validator、报告渲染测试、dashboard 解析测试。

## 兼容策略

为降低管理台改造风险，可以分两步上线：

1. 先输出 `schema_version: "result.v2"`、`pre_cap_score`、`score_policy`、`hard_gates`，同时保留旧字段。
2. 管理台切换到 v2 字段后，再删除重复字段。

如果当前管理台没有版本分支能力，则应一次性改造读取逻辑，并在接口层明确要求 `schema_version === "result.v2"`。
