# Agent 输出校验规则优化 Spec

## 背景

当前 rubric agent 与 rule agent 的输出校验把“协议结构校验”和“字段值业务判断”耦合得较紧。结果是：agent 已经给出可用 JSON 时，仍可能因为额外字段、数字/布尔类型写法、rubric 分数未精确落到 band 等问题被判为 `protocol_error`，触发重试或节点失败。

用户对 `docs/agent-output-validation.md` 的回复已经明确了优化方向：字段名称仍然是协议边界，不能接受替代字段；但字段值应允许 agent 有一定自主填空权，运行时负责忽略无关字段、转换可转换类型、对 rubric 分数做本地吸附。

## 目标

- 保持字段名称契约稳定：必需字段名仍必须存在，不做别名映射。
- 放宽额外字段处理：agent 输出未声明字段时不再失败，解析后忽略。
- 放宽数字和布尔值类型：允许可明确转换的 string 进入本地规范化。
- 保持关键枚举固定：`confidence`、`decision`、`gate_id` 仍只能取当前固定集合。
- Rubric `score` 允许 agent 输出任意有限 number，再本地吸附到最近的 rubric band 分值。
- Rubric 扣分项仍必须提供 `deduction_trace`，保留可复核证据链。
- Rubric coverage 尽量向 rule coverage 看齐：重复 item 和未知 item 不导致失败，缺失 item 仍失败。
- Prompt 不同步放宽，仍要求 agent 严格输出推荐格式；运行时只是更容错。
- 清理未使用的旧 strict JSON 协议工具，降低后续维护歧义。

## 非目标

- 不允许字段别名映射。例如 `risks[].risk_level` 不映射为 `risks[].level`。
- 不允许枚举值自由扩展。例如 `confidence: "certain"` 或中文置信度仍失败。
- 不把扣分证据链降级为可选。
- 不改最终报告 schema 的字段名称。
- 不增加额外模型调用轮次。
- 不改变 opencode 最终 JSON 提取策略。

## 决策归纳

### 字段名称

字段名称仍要求精确固定。

- 必需字段缺失仍失败。
- 替代字段不生效，也不做映射。
- 额外字段允许出现，但解析后的业务对象中忽略。

示例：

```json
{
  "risks": [
    {
      "level": "medium",
      "title": "风险标题",
      "description": "风险说明",
      "evidence": "generated/a.ets",
      "risk_level": "medium"
    }
  ]
}
```

应通过 schema，最终业务对象只保留 `level/title/description/evidence`。如果只输出 `risk_level` 而缺少 `level`，仍失败。

### 字段类型

数字和布尔字段允许本地转换。

数字转换规则：

- 接受 number。
- 接受可转换为有限 number 的 string，例如 `"80"`、`"80.5"`。
- 拒绝空字符串、非数字字符串、`NaN`、`Infinity`。

布尔转换规则：

- 接受 boolean。
- 接受大小写不敏感的 string：`"true"`、`"false"`。
- 拒绝 `"yes"`、`"no"`、`"1"`、`"0"` 等非明确布尔文本。

数组和对象不做宽松转换。例如 `evidence_used` 仍必须是 array，不把单个 string 自动包成 array。

### 枚举字段

枚举仍固定，不纳入自主填空范围。

- `confidence`: `high | medium | low`
- rule `decision`: `violation | pass | not_applicable | uncertain`
- rubric `gate_id`: `G1 | G2 | G3 | G4`

这些字段如果输出其他值，仍返回 `protocol_error` 并触发一次 retry。

### Rubric 分数吸附

Rubric item 的 `score` 允许任意有限 number，然后本地吸附到该 item 的 `scoring_bands[].score`。

吸附规则：

- 取与原始 `score` 绝对距离最近的 band score。
- 如果两个 band 距离相同，取较高分，避免 tie 时产生额外扣分。
- 如果原始 `score` 低于最低 band，吸附到最低 band。
- 如果原始 `score` 高于最高 band，吸附到最高 band。
- 规范化后 `score` 与 `matched_band_score` 都写成吸附后的 band score。
- `max_score` 仍由本地 rubric item weight 写回。

示例：

- allowed scores: `[0, 50, 100]`
- agent 输出 `score: 72`
- 本地吸附为 `score: 50`、`matched_band_score: 50`

tie 示例：

- allowed scores: `[50, 100]`
- agent 输出 `score: 75`
- 本地吸附为 `score: 100`、`matched_band_score: 100`

### Deduction Trace

扣分项仍必须提供 `deduction_trace`。

判定基于吸附后的分数：

- 如果吸附后 `score === max_score`，`deduction_trace` 允许缺失。
- 如果吸附后 `score < max_score`，`deduction_trace` 必须存在。
- `deduction_trace` 必须包含既有字段：`code_locations`、`impact_scope`、`rubric_comparison`、`deduction_reason`、`improvement_suggestion`。
- `code_locations` 至少包含一个 string。
- `impact_scope`、`rubric_comparison`、`deduction_reason` 继续要求非空，避免扣分无可复核依据。
- `deduction_trace` 中额外字段忽略。

### Rubric Coverage

Rubric coverage 的目标是保留本地 rubric skeleton 的确定性，同时减少 agent 输出形态导致的无效失败。

新规则：

- 缺失 rubric item 仍失败。
- 重复 rubric item 不失败，保留第一个匹配项。
- 未知 rubric item 不失败，过滤忽略。
- 输出顺序不重要，最终按本地 rubric skeleton 顺序重排。
- `dimension_name` 与 `item_name` 仍用于匹配本地 item；名称无法匹配时视为未知 item。

缺失 item 仍失败的原因：本地无法可靠替 agent 生成该 item 的评分与理由。与 rule agent 不同，rubric item 缺失时直接补 `uncertain` 会改变总分语义。

### Rule Coverage

Rule coverage 维持当前容错策略：

- 缺失 candidate rule 本地补为 `uncertain` 且 `needs_human_review=true`。
- 重复 rule 保留第一个。
- 未知 rule 过滤忽略。

本次只补齐 rule schema 的额外字段忽略和类型转换能力。

### Prompt 策略

Prompt 不放宽。

- 继续要求字段完全符合输出格式。
- 继续要求 rubric score 使用 scoring band。
- 继续要求不得新增、遗漏或重复 item/rule。
- 继续要求扣分项提供 `deduction_trace`。

运行时容错只作为防御层，不鼓励 agent 输出非推荐格式。

## 需要修改的地方

### 1. 清理旧 strict JSON 协议工具

文件：`src/agent/jsonProtocol.ts`

当前 `rg` 结果显示 `parseSingleJsonObjectStrict`、`StrictJsonProtocolError`、`findTopLevelJsonObjectEnd` 等只在该文件内定义，没有运行时引用。

修改要求：

- 如果确认没有测试或外部引用，删除 `src/agent/jsonProtocol.ts`。
- 如果 TypeScript build 因引用缺失失败，再改为只删除未使用导出。
- 保留当前 opencode 路径使用的 `src/opencode/finalJson.ts`。

验证：

- `npm run build`
- `npm test`

### 2. 提取宽松解析 helper

建议新增文件：`src/agent/agentOutputNormalization.ts`

职责：

- 提供 `coerceFiniteNumber(value, path)`。
- 提供 `coerceBoolean(value, path)`。
- 提供 `snapScoreToAllowedBand(score, allowedScores)`。
- 提供 Zod preprocess helper，供 rubric/rule schema 复用。

设计约束：

- helper 只处理明确可转换的类型。
- helper 错误信息要包含字段路径，便于 retry prompt 定位。
- 不做字段别名映射。
- 不做 string 到 array 的转换。

### 3. 调整 Rubric agent schema

文件：`src/agent/opencodeRubricScoring.ts`

修改点：

- 将所有 `.strict()` 调整为忽略额外字段的策略。优先使用 Zod 默认 strip 行为或显式 `.strip()`。
- `score`、`max_score`、`matched_band_score` 使用 number coercion。
- `review_required`、`hard_gate_candidates[].triggered` 使用 boolean coercion。
- 保留 `confidence` 与 `gate_id` enum。
- 保留必需字段检查。
- 保留关键说明字段非空检查，尤其是扣分 trace 相关字段。

注意：

- 额外字段应从 `parsed.data` 中消失。
- `final_answer_raw_text` 仍保留完整原始输出，因此审计能力不丢失。

### 4. 调整 Rubric normalization 与 coverage

文件：`src/agent/opencodeRubricScoring.ts`

修改点：

- 在 `rubricSkeleton` 或相邻逻辑中保留每个 item 的 allowed scores。
- `normalizeRubricResult` 对每个匹配 item 执行 score snapping。
- `normalizeRubricResult` 将 `score` 和 `matched_band_score` 写为吸附后的 band score。
- `normalizeRubricResult` 将 `max_score` 写为本地 item weight。
- `validateRubricCoverage` 不再产生 `duplicate`、`unexpected` 失败。
- `validateRubricCoverage` 仍产生 `missing` 失败。
- `validateRubricCoverage` 不再产生 `invalid_band` 和 `invalid_weight` 失败，因为 normalization 已处理。
- `validateRubricCoverage` 继续检查 `invalid_deduction_trace`。

扣分 trace 判断必须使用吸附后的分数。

### 5. 调整 Rubric retry guidance

文件：`src/agent/opencodeRubricScoring.ts`

修改点：

- `invalid_band` 和 `invalid_weight` 正常情况下不再出现，可删除对应 retry guidance，或保留但不再由 coverage 产生。
- `duplicate`、`unexpected` 正常情况下不再出现，可删除对应 retry guidance，或保留但不再由 coverage 产生。
- `missing` 和 `invalid_deduction_trace` 仍应保留。
- schema error guidance 保留，但不再因为额外字段触发。

Prompt 主体不放宽。只调整 retry 中已经失效的错误分支，避免误导后续维护。

### 6. 调整 Rule agent schema

文件：`src/agent/opencodeRuleAssessment.ts`

修改点：

- 将所有 `.strict()` 调整为忽略额外字段。
- `needs_human_review` 使用 boolean coercion。
- 保留 `decision` 与 `confidence` enum。
- 保留 `rule_id`、`reason` 等必需字段检查。
- 保留当前 `normalizeRuleAssessmentResult` 的缺失补齐、重复去重、未知过滤逻辑。

### 7. 同步测试

文件：

- `tests/opencode-rubric-scoring.test.ts`
- `tests/opencode-rule-assessment.test.ts`

Rubric 新增或调整测试：

- 额外顶层字段和嵌套字段被忽略，不触发 `protocol_error`。
- `score` 为数字字符串时通过，并吸附到最近 band。
- `review_required`、`triggered` 为 `"true"` 或 `"false"` 时通过并转换为 boolean。
- `score` 为任意 number 时吸附到最近 band。
- tie 时吸附到较高 band。
- 超出 band 范围时 clamp 到最高或最低 band。
- 吸附后为满分时，不要求 `deduction_trace`。
- 吸附后为扣分时，缺少 `deduction_trace` 仍失败。
- 重复 rubric item 不失败，保留第一个。
- 未知 rubric item 不失败，被过滤。
- 缺失 rubric item 仍失败。
- `confidence` 非法值仍失败。
- 替代字段不生效：例如只输出 `risks[].risk_level` 而缺少 `risks[].level` 仍失败。

Rule 新增或调整测试：

- 额外顶层字段和嵌套字段被忽略。
- `needs_human_review` 为 `"true"` 或 `"false"` 时通过并转换为 boolean。
- `decision` 非法值仍失败。
- 缺失候选 rule 仍本地补 `uncertain`。
- 重复 rule 仍保留第一个。
- 未知 rule 仍过滤。
- 替代字段不生效：例如只有 `message` 没有 `reason` 时仍失败。

清理测试：

- 如果删除 `src/agent/jsonProtocol.ts`，确认没有测试仍导入它。
- `npm run build` 必须通过。
- `npm test` 必须通过。

## 接受标准

- Agent 输出额外字段不再导致 rubric/rule schema validation 失败。
- 可明确转换的 number string 和 boolean string 被规范化到正确类型。
- 字段别名仍不被接受，缺少必需字段仍失败。
- `confidence`、`decision`、`gate_id` 非法值仍失败。
- Rubric arbitrary score 会被吸附到最近 allowed band，最终结果不保留中间分。
- Rubric 扣分项缺少有效 `deduction_trace` 仍失败。
- Rubric 重复 item 和未知 item 被本地归一化处理，不触发失败。
- Rubric 缺失 item 仍触发失败。
- Rule coverage 行为与当前一致。
- Prompt 文本没有为了运行时容错而放宽核心要求。
- 旧未使用 strict JSON 协议工具被清理，或有明确理由保留。

## 风险与取舍

- 放宽类型转换会接受更多模型输出形态，但也可能掩盖 prompt 不稳定。通过保留 raw output artifact 和不放宽 prompt 来缓解。
- Rubric score 吸附会改变 agent 原始分数表达。最终评分必须以本地 allowed band 为准，原始分数只能从 raw artifact 审计。
- tie 取较高分会降低误扣风险，但可能让部分边界情况更宽松。这与“证据不足不扣分”的既有评分稳定性方向一致。
- 额外字段忽略后，agent 输出中的补充信息不会进入业务对象。若未来要展示补充信息，应显式扩展 schema，而不是依赖额外字段。

## 与既有稳定性设计的关系

`docs/superpowers/specs/2026-04-23-rubric-scoring-stability-design.md` 要求 agent 扣分落在既有 band 中。本 spec 不放宽 prompt 里的该要求，但将运行时从“直接拒绝非 band 分数”调整为“本地吸附到最近 band”。因此最终业务结果仍满足“最终分数落在既有 band 中”，只是 agent 原始输出不再必须精确命中 band 才能进入后续流程。

