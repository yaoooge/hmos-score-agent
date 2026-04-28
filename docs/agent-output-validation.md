# Rubric Agent 与 Rule Agent 输出校验梳理

更新时间：2026-04-28

本文只整理当前实现中的校验逻辑，便于后续评审和调整。未包含任何运行时代码修改。

## 相关源码位置

- Rubric agent：`src/agent/opencodeRubricScoring.ts`
- Rule agent：`src/agent/opencodeRuleAssessment.ts`
- opencode 最终 JSON 提取：`src/opencode/finalJson.ts`
- 旧 strict JSON 协议工具：`src/agent/jsonProtocol.ts`
- Rubric agent 节点状态处理：`src/nodes/rubricScoringAgentNode.ts`
- Rule agent 节点状态处理：`src/nodes/ruleAssessmentAgentNode.ts`
- Rubric prompt builder：`src/agent/opencodeRubricPrompt.ts`
- 相关测试：`tests/opencode-rubric-scoring.test.ts`、`tests/opencode-rule-assessment.test.ts`

## 总体流程

当前 rubric agent 与 rule agent 的输出都会经过以下流程：

1. opencode runner 返回 `rawText`。
2. `extractFinalJsonObject(rawText)` 从最终文本中提取 JSON object。
3. 使用各自的 Zod schema 做字段结构和类型校验。
4. 本地 normalization 将部分字段对齐到本地 skeleton。
5. 执行业务覆盖校验。
6. 如果失败，发起一次 retry prompt。
7. retry 后仍失败则返回 `protocol_error` 或 `request_failed`。
8. node 层要求必须存在 `final_answer`，否则抛错，中断当前节点。

## 通用 JSON 提取校验

位置：`src/opencode/finalJson.ts`

当前规则：

- 允许最终文本整体包在一个 ```json fence 中，解析前会去掉 fence。
- 在文本中扫描顶层 `{ ... }` 片段。
- 要求最终文本中包含且只包含一个 JSON object。
- JSON 片段必须能被 `JSON.parse` 解析。
- 解析结果必须是 object，不能是 array、null 或其他类型。

影响：

- 输出自然语言前后缀本身不一定直接失败，只要文本里只有一个 JSON object，就会被提取出来。
- 如果 agent 输出两个 JSON object，即使其中一个是正确答案，也会失败。
- 如果 agent 输出顶层 array，会失败。

另有旧工具 `src/agent/jsonProtocol.ts` 的 `parseSingleJsonObjectStrict` 更严格：

- 第一个非空字符必须是 `{`。
- 最后一个非空字符必须是 `}`。
- 不允许 JSON 前后有任何说明文字。
- 不允许多个顶层 JSON object。
- 最后再按传入 schema 校验。

**comment：旧规则未使用的话进行清理**

当前 opencode rubric/rule 路径实际使用的是 `extractFinalJsonObject`，不是 `parseSingleJsonObjectStrict`。

## Rubric Agent Schema 校验

位置：`src/agent/opencodeRubricScoring.ts`

顶层字段必须且只能包含：

- `summary`
- `item_scores`
- `hard_gate_candidates`
- `risks`
- `strengths`
- `main_issues`

所有对象都使用 `.strict()`，因此额外字段会导致 schema validation 失败。

### `summary`

字段：

- `overall_assessment`: 必须是非空 string。
- `overall_confidence`: 必须是枚举值之一：`high`、`medium`、`low`。

强校验点：

- 不允许空字符串。
- 不允许 `certain`、`unknown`、中文置信度等自定义值。
- 不允许额外字段。

**comment：不强校验额外字段，只是在使用json时忽略**


### `item_scores[]`

每个条目字段必须且只能包含：

- `dimension_name`: 非空 string。
- `item_name`: 非空 string。
- `score`: number。
- `max_score`: 可选 number。
- `matched_band_score`: 可选 number。
- `rationale`: 非空 string。
- `evidence_used`: string array。
- `confidence`: 枚举值之一：`high`、`medium`、`low`。
- `review_required`: boolean。
- `deduction_trace`: 可选 object。

强校验点：

- `dimension_name`、`item_name`、`rationale` 不能是空字符串。
- `score` 必须是 number，不接受数字字符串。
- `confidence` 只能是 `high`、`medium`、`low`。
- `review_required` 必须是 boolean。
- `evidence_used` 必须是 array，但数组可以为空，元素可以是空字符串，因为当前只校验 `z.string()`。
- 不允许 `score_reason`、`reason`、`evidence`、`item_id`、`risk_level` 等额外字段。

**comment：不强校验额外字段，只是在使用json时忽略**


### `deduction_trace`

如果输出 `deduction_trace`，字段必须且只能包含：

- `code_locations`: 非空 string array，且数组长度至少为 1。
- `impact_scope`: 非空 string。
- `rubric_comparison`: 非空 string。
- `deduction_reason`: 非空 string。
- `improvement_suggestion`: string。

强校验点：

- `code_locations` 不能为空。
- `impact_scope`、`rubric_comparison`、`deduction_reason` 不能是空字符串。
- `improvement_suggestion` 可以是空字符串，因为当前没有 `.min(1)`。
- 不校验 `code_locations` 是否真的是 sandbox 相对路径。
- 不校验 `rubric_comparison` 的固定措辞。测试明确覆盖了“不强校验比较措辞”。

### `hard_gate_candidates[]`

每个条目字段必须且只能包含：

- `gate_id`: 枚举值之一：`G1`、`G2`、`G3`、`G4`。
- `triggered`: boolean。
- `reason`: string。
- `confidence`: 枚举值之一：`high`、`medium`、`low`。

强校验点：

- `gate_id` 只能是四个固定值。
- `triggered` 必须是 boolean。
- `reason` 可以是空字符串。
- 不允许额外字段。

**comment：不强校验额外字段，只是在使用json时忽略**


### `risks[]`

每个条目字段必须且只能包含：

- `level`: string。
- `title`: string。
- `description`: string。
- `evidence`: string。

强校验点：

- 不允许使用 `risk_level`、`message`、`reason` 等替代字段。
- 四个字段允许空字符串。
- `level` 没有枚举限制。

**comment：不强校验额外字段，只是在使用json时忽略**


### `strengths[]` 与 `main_issues[]`

规则：

- 必须是 string array。
- 数组可为空。
- 元素可为空字符串。

## Rubric Agent 业务覆盖校验

位置：`validateRubricCoverage`，`src/agent/opencodeRubricScoring.ts`

校验基于本地 `rubricSnapshot.dimension_summaries[].item_summaries[]` 建立预期 item 列表。

当前校验：

- `item_scores` 必须覆盖每个 `dimension_name + item_name`。
- 不允许重复 item。
- 不允许输出不在 rubric snapshot 中的未知 item。
- `max_score` 必须等于 rubric item 的 `weight`。
- `score` 必须属于该 item 的 `scoring_bands[].score`。
- `matched_band_score` 必须等于 `score`。
- 如果 `score < max_score`，必须有有效 `deduction_trace`。

强校验点：

- 即使 agent 自主判断一个中间分值合理，只要该分值不在 `scoring_bands[].score` 中，就会失败。
- 即使 `max_score` 是可选字段，normalization 会写回本地 weight，随后覆盖校验要求它等于本地 weight。
- 即使 `matched_band_score` 是可选字段，normalization 会写成 `score`，随后覆盖校验要求二者一致。
- 扣分项必须提供 `deduction_trace`，否则失败。
- 缺 item、重复 item、未知 item 都会失败。

注意：当前 normalization 会先按本地 skeleton 重排和补写部分字段：

- 只保留能匹配本地 `dimension_name + item_name` 的条目。
- 重复条目只取第一个。
- 将 `dimension_name`、`item_name` 写成本地 skeleton 中的标准值。
- 将 `max_score` 写成本地 `weight`。
- 将 `matched_band_score` 写成 agent 输出的 `score`。

因此，部分 schema 上可选的字段在最终结果中会被本地补齐。但缺失 item 不会自动补一个评分项，仍会导致 `missing=` 失败。

**comment：重复 item、未知 item不失败，只有缺失item失败**


## Rubric Agent Prompt 中的强约束

位置：`renderRubricScoringPrompt` 与 `renderRubricScoringRetryPrompt`，`src/agent/opencodeRubricScoring.ts`

普通 prompt 明确要求：

- 必须覆盖每个 rubric item，不能新增、遗漏或重复。
- 每个 `score` 必须等于对应 `scoring_bands.score`。
- `matched_band_score` 必须与 `score` 相同。
- `max_score` 必须等于 item weight。
- 扣分项必须提供 `deduction_trace`。
- `evidence_used` 只能填写 sandbox 内相对路径。
- 最终只输出一个 JSON object，不要 Markdown 或解释文字。
- 只输出 system prompt 正确输出格式中列出的字段，不能增加额外字段。

retry prompt 进一步要求：

- 只修正最终 JSON 的字段、去重、覆盖和格式问题。
- 不要重新评分，不要修改上一轮评分判断。
- 对 `invalid_band`，将 score 改为对应 allowed score。
- 对 `invalid_weight`，将 max_score 改为对应 item 的 max_score。
- 对 `invalid_deduction_trace`，补齐 deduction trace。
- `risks` 每项必须且只能包含 `level`、`title`、`description`、`evidence`。

这些 prompt 要求有些是格式契约，有些已经涉及字段值和评分策略。

## Rule Agent Schema 校验

位置：`src/agent/opencodeRuleAssessment.ts`

顶层字段必须且只能包含：

- `summary`
- `rule_assessments`

所有对象都使用 `.strict()`，因此额外字段会导致 schema validation 失败。

### `summary`

字段：

- `assistant_scope`: 非空 string。
- `overall_confidence`: 枚举值之一：`high`、`medium`、`low`。

强校验点：

- `assistant_scope` 不能是空字符串。
- `overall_confidence` 不允许自定义值。
- 不允许额外字段。

**comment：不强校验额外字段**

### `rule_assessments[]`

每个条目字段必须且只能包含：

- `rule_id`: 非空 string。
- `decision`: 枚举值之一：`violation`、`pass`、`not_applicable`、`uncertain`。
- `confidence`: 枚举值之一：`high`、`medium`、`low`。
- `reason`: 非空 string。
- `evidence_used`: string array。
- `needs_human_review`: boolean。

强校验点：

- `rule_id`、`reason` 不能是空字符串。
- `decision` 只能是四个固定值。
- `confidence` 只能是三个固定值。
- `needs_human_review` 必须是 boolean。
- `evidence_used` 必须是 array，但数组可为空，元素可为空字符串。
- 不允许额外字段。

## Rule Agent 业务覆盖校验

位置：`validateRuleCoverage` 与 `normalizeRuleAssessmentResult`，`src/agent/opencodeRuleAssessment.ts`

当前校验目标是候选规则 `assisted_rule_candidates[].rule_id`。

原始覆盖校验逻辑包含：

- 不允许遗漏候选 rule id。
- 不允许重复 rule id。
- 不允许输出未知 rule id。

但实际执行顺序是先 normalization，再 validate：

1. 将 agent 输出按 `rule_id` 建 map，重复项只保留第一个。
2. 按本地 candidates 顺序重新生成 `rule_assessments`。
3. 如果某个候选缺失，则本地补为：
   - `decision: "uncertain"`
   - `confidence: "low"`
   - `reason: "agent 输出遗漏该候选规则，本地骨架补为 uncertain，需人工复核。"`
   - `evidence_used: []`
   - `needs_human_review: true`
4. 未知 rule id 被过滤。
5. normalization 后再做覆盖校验。

实际影响：

- rule agent 缺少候选规则不会失败，会被本地补 `uncertain`。
- rule agent 输出重复 rule id 不会失败，会保留第一个。
- rule agent 输出未知 rule id 不会失败，会被过滤。
- schema 不合法仍会失败，例如额外字段、错误枚举、错误类型、空 `reason`。

这与 rubric agent 不一致：rubric agent 缺 item、重复 item、未知 item 当前仍会失败。

**comment：重复 item、未知 item不失败，只有缺失item失败**

## Rule Agent Prompt 中的强约束

位置：`renderRuleAssessmentPrompt` 与 `renderRuleAssessmentRetryPrompt`，`src/agent/opencodeRuleAssessment.ts`

普通 prompt 明确要求：

- 必须覆盖 `assisted_rule_candidates` 中每个 `rule_id`。
- 不能新增、遗漏或重复 `rule_id`。
- 无法确认时使用 `decision="uncertain"`，并设置 `needs_human_review=true`。
- `evidence_used` 只能填写 sandbox 内相对路径。
- 最终只输出一个 JSON object，不要 Markdown 或解释文字。
- JSON 字段必须完全符合 system prompt 中的结构，不能增加额外字段。

retry prompt 进一步要求：

- 只根据 `candidate_rule_ids` 覆盖所有候选 rule id。
- 只修复 listed protocol errors，禁止重新判定。
- 对 `missing`，补齐候选 `rule_id`。
- 对 `duplicate`，只保留每个 `rule_id` 的一个判定。
- 对 `unexpected`，删除未知 `rule_id`。
- 对 schema error，删除未声明字段、补齐缺失字段、修正字段类型。

由于运行时 normalization 已经会补齐/去重/过滤，prompt 中关于 coverage 的一部分强约束比实际运行时更严格。

## 失败与重试行为

Rubric agent 与 rule agent 都会在首次解析失败后 retry 一次。

会触发 retry 的情况：

- opencode request 抛错。
- JSON 提取失败。
- Zod schema validation 失败。
- 业务覆盖校验失败。

retry 仍失败时：

- runner 返回 `request_failed` 或 `protocol_error`。
- node 层检查没有 `final_answer` 后抛错。
- 当前节点不会把这种情况降级为 `invalid_output` 后继续走完。

相关位置：

- `src/nodes/rubricScoringAgentNode.ts`
- `src/nodes/ruleAssessmentAgentNode.ts`

## 当前看起来可能“不必要强”的校验点

以下只是从“字段值允许 agent 有一定自主填空权”的角度标注，是否放宽需要结合后续评分消费方再决定。

### Rubric agent

- `summary.overall_confidence`、`item_scores[].confidence`、`hard_gate_candidates[].confidence` 固定为 `high | medium | low`。
- `hard_gate_candidates[].gate_id` 固定为 `G1 | G2 | G3 | G4`。
- `item_scores[].score` 必须属于 rubric 中声明的 scoring band 分值。
- `matched_band_score` 必须等于 `score`。
- `max_score` 必须等于 rubric item weight。
- 扣分项强制要求 `deduction_trace`，且 `code_locations` 至少 1 个。
- `rationale`、`overall_assessment`、`dimension_name`、`item_name` 等字段禁止空字符串。
- 顶层和嵌套对象 `.strict()`，不允许 agent 额外输出解释性字段或补充字段。
- `risks[]` 字段名固定为 `level/title/description/evidence`，不允许常见替代字段。
- 缺失、重复、未知 rubric item 不会被本地补齐或过滤为成功，而是触发失败。

### Rule agent

- `summary.overall_confidence` 与 `rule_assessments[].confidence` 固定为 `high | medium | low`。
- `rule_assessments[].decision` 固定为 `violation | pass | not_applicable | uncertain`。
- `assistant_scope`、`rule_id`、`reason` 禁止空字符串。
- 顶层和嵌套对象 `.strict()`，不允许额外字段。
- `needs_human_review` 必须是 boolean。

相对不强的点：

- rule coverage 在运行时已被本地 skeleton 容错：缺失补 `uncertain`、重复取第一个、未知过滤。
- `evidence_used` 不校验路径格式，只校验是 string array。

## 与“只强校验字段名称，字段值给 agent 自主填空权”的差异

如果目标是只强校验字段名称和基本 JSON shape，当前实现仍有这些额外限制：

- 枚举值限制：`confidence`、`decision`、`gate_id`。
- 非空字符串限制：多个说明字段必须 `.min(1)`。
- boolean 类型限制：`review_required`、`needs_human_review`、`triggered`。
- number 类型限制：`score`、`max_score`、`matched_band_score`。
- Rubric scoring band 限制：`score` 必须来自预设档位。
- Rubric 权重限制：`max_score` 必须等于本地 weight。
- Rubric 扣分 trace 限制：扣分必须给 trace 且 code location 非空。
- strict object 限制：不允许任何额外字段。
- Rubric item 覆盖限制：缺失、重复、未知 item 会失败。

## 后续调整时建议确认的问题

1. 字段名称是否仍要求精确固定？例如 `risks[].level` 是否允许 agent 输出 `risk_level` 后本地映射。 --不允许
2. 是否保留字段类型强校验？例如 boolean/number 是否允许字符串后本地转换。 --允许
3. `confidence`、`decision`、`gate_id` 这类枚举是否属于字段值自主范围，还是下游逻辑必须固定。 ---必须固定
4. rubric `score` 是否必须来自 scoring band，还是允许任意 number 后本地吸附到最近档位。 --可以任意number后吸附
5. 扣分项是否必须提供 `deduction_trace`，还是允许缺失后由报告层展示为未提供。 --必须提供
6. rubric coverage 是否应向 rule coverage 看齐，缺失补本地 skeleton、重复取第一个、未知过滤，而不是直接失败。 --尽量看齐
7. `.strict()` 是否要改为保留或忽略额外字段；如果忽略，是否需要把原始输出留在 artifact 中便于审计。 --忽略额外字段
8. prompt 中的强约束是否应同步放宽，避免模型被要求执行比运行时更严格的格式策略。 --不放宽

