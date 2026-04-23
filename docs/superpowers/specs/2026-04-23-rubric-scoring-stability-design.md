# Rubric 评分稳定性优化设计

## 背景

当前 rubric 评分链路已经拆分为独立的 prompt 构建与 agent 执行节点，但 agent 仍然直接对每个 rubric item 做自由裁量式选档。对于同一条用例，多轮调用模型时，即使输入工程和 rubric 不变，也可能因为模型输出波动导致 item 评分、理由和置信度不完全一致。

现有实现中的不稳定点主要有三类：

- `src/agent/rubricScoring.ts` 只要求 item 分数来自声明过的 `scoring_bands`，但没有要求默认分、扣分触发条件和扣分证据链。
- `src/nodes/rubricScoringAgentNode.ts` 只校验 schema 合法性，不区分“满分项”和“扣分项”应承担的解释责任。
- `src/scoring/scoreFusion.ts` 的 fallback 语义仍偏向“规则预检基础分”，与“找不到足够负面证据就保持满分”的业务要求不一致。

结果是：模型对同一 item 可能在高分 band 与次高分 band 之间摆动，而这些摆动并不总能给出稳定、可复核的依据。

## 目标

- 将 rubric 评分机制收紧为“默认满分，证据驱动扣分”。
- 只有在发现明确负面证据时，agent 才允许对 item 降档。
- 扣分项必须提供完整证据链：代码位置、影响范围、rubric 区间比对、明确评分理由。
- 无法找到足够负面证据时，该 item 必须保持满分。
- 扣分必须严格落在 rubric 已声明的 band 中，不允许中间分或主观微调。
- 将上述约束落到 prompt、类型、解析、报告和 fallback 行为中，减少多轮评分波动。

## 非目标

- 本次不把 rubric band 规则完全程序化为确定性评分器。
- 本次不改变规则分支的职责，规则分支仍负责确定性规则判定和后续修正。
- 本次不新增新的外部依赖或额外模型调用轮次。
- 本次不要求所有满分项都输出冗长解释，只对扣分项强制完整说明。

## 约束与判定原则

### 评分基线

对每个 rubric item，初始基线为该 item 的 `max_score`，也就是最高分 band。

agent 只有在同时满足以下条件时，才允许将该 item 从满分降到某个低档 band：

1. 找到明确负面证据。
2. 负面证据可定位到具体代码位置。
3. 可以说明问题影响范围。
4. 可以把证据与该 item 的 rubric band 文本逐条对照，并明确说明为什么高分档不成立、为什么当前档成立。

只要上述条件不完整，就不能扣分，item 维持满分。

### Band 选择原则

- `score` 和 `matched_band_score` 必须相等。
- `score` 只能取该 item `scoring_bands` 中已经声明的分值。
- 不允许输出 band 之间的中间分。
- 不允许因为“轻微怀疑”“倾向认为”“可能存在问题”而做保守扣分。

### 扣分项解释责任

只有当 `score < max_score` 时，才要求输出完整扣分依据。

满分项可以保留简短 `rationale` 和必要的 `evidence_used`，但不要求生成扣分轨迹。这样可以避免 agent 为了满足格式而对无问题项编造说明，反而引入额外噪音和波动。

## 推荐架构

本次不重排 workflow 节点顺序，重点修改 rubric 分支协议和 fallback 语义：

```text
rubricPreparationNode
  -> rubricScoringPromptBuilderNode
  -> rubricScoringAgentNode
  -> scoreFusionOrchestrationNode
  -> reportGenerationNode
```

核心变化是将 rubric agent 从“自由评分器”改为“满分基线上的证据驱动扣分器”。

## 类型与协议变更

### `RubricScoringItemScore`

扩展 `src/types.ts` 中的 `RubricScoringItemScore`，保留现有字段，并新增扣分轨迹结构：

```ts
interface RubricDeductionTrace {
  code_locations: string[];
  impact_scope: string;
  rubric_comparison: string;
  deduction_reason: string;
}

interface RubricScoringItemScore {
  dimension_name: string;
  item_name: string;
  score: number;
  max_score: number;
  matched_band_score: number;
  rationale: string;
  evidence_used: string[];
  confidence: ConfidenceLevel;
  review_required: boolean;
  deduction_trace?: RubricDeductionTrace;
}
```

语义约束如下：

- 当 `score === max_score` 时，`deduction_trace` 允许缺失。
- 当 `score < max_score` 时，`deduction_trace` 必须存在，且字段完整。
- `code_locations` 至少包含一个可定位的文件路径；允许补充行号。
- `impact_scope` 必须说明问题影响到的模块、页面、流程或行为边界。
- `rubric_comparison` 必须同时说明“为什么未命中更高档”和“为什么命中当前档”。
- `deduction_reason` 必须是最终评分结论，不能只写模糊怀疑。

### `RubricScoringResult`

`summary`、`hard_gate_candidates`、`risks`、`strengths`、`main_issues` 的主结构保持不变，避免扩大与现有下游的兼容面。稳定性改造聚焦在 `item_scores` 的判定约束与解释责任上。

## Prompt 设计

`src/agent/rubricScoring.ts` 中的 rubric prompt 需要改成“默认满分、仅在证据充分时扣分”的指令集。关键约束如下：

- 每个 item 先以 `max_score` 为默认结论。
- 只有发现明确负面证据时才允许降档。
- 证据不足时必须保持满分，不能因为保守心态而扣分。
- 扣分时必须返回 `deduction_trace`。
- 扣分必须落到现有 `scoring_bands` 之一。
- 满分项不要伪造扣分依据。
- 不允许输出“疑似”“可能”“大概”之类模糊语言来支撑扣分。

Prompt 中还需要补充一组更明确的模型行为示例：

- 满分项示例：返回最高档分数和简短理由，不附带 `deduction_trace`。
- 扣分项示例：返回降档后的 band 分数，并给出完整 `code_locations`、`impact_scope`、`rubric_comparison`、`deduction_reason`。

这样可以减少模型把所有 item 都写成长解释，或在无证据时做主观降档。

## 解析与协议校验

`src/agent/rubricScoring.ts` 中的 schema 与严格解析逻辑需要同步增强。

除现有校验外，新增以下规则：

- 若 `score < max_score` 且缺少 `deduction_trace`，则判定为协议不合格。
- 若 `deduction_trace.code_locations` 为空，则判定为协议不合格。
- 若 `rubric_comparison` 未体现高档不成立与当前档成立两个部分，则判定为协议不合格。
- 若 `score === max_score` 却附带冗余的扣分轨迹，允许存在但不强依赖；首版可允许通过，避免不必要的 repair 抖动。

协议失败后，继续沿用 `src/nodes/rubricScoringAgentNode.ts` 的 repair 流程，但 repair prompt 需要明确：

- 只能修复协议字段和扣分证据链完整性。
- 不要随意改动已给出的 band 选择，除非原 band 本身不合法。

若 repair 后仍不合格，则维持当前 `invalid_output` 路径。

## Score Fusion 与降级语义

`src/scoring/scoreFusion.ts` 的主融合逻辑可以保持“rubric 基础分 + rule delta”的框架不变，因为这次要解决的是 rubric 基础分的稳定性，而不是规则修正机制。

需要调整的是 fallback 语义。

当前 `buildFallbackRubricItems` 会在 rubric agent 不可用时生成一组兜底 item 分，这组分数需要改为“满分待人工复核”：

- 每个 item 的 `score` 取该 item 的最高分 band。
- `matched_band_score` 同样取最高分 band。
- `confidence` 设为 `low`。
- `review_required` 设为 `true`。
- `rationale` 写明“rubric agent 未产出可信扣分依据，暂按满分保留，待人工复核”。
- `deduction_trace` 不生成。

这样可以保证在 agent 失败、协议修复失败或输出非法时，系统不会凭空引入额外低分，也与“找不到足够负面证据就保持满分”的业务规则保持一致。

## 报告与 Schema 落盘

`references/scoring/report_result_schema.json` 与 `src/nodes/reportGenerationNode.ts` 需要同步扩展，让扣分依据进入 `result.json` 和 HTML 报告。

建议在 `dimension_results[].item_results[].agent_evaluation` 下新增：

- `deduction_trace`

字段结构与 `RubricDeductionTrace` 一致，且允许为 `null`。约束如下：

- 满分项：`deduction_trace` 为 `null`。
- 扣分项：`deduction_trace` 为对象，字段完整。

这样可以复用现有 `agent_evaluation` 语义，不需要再新增新的并列结果块。报告层展示时只在扣分项渲染该部分信息，避免界面噪音。

## 受影响文件

主要修改面如下：

- `src/agent/rubricScoring.ts`
- `src/nodes/rubricScoringAgentNode.ts`
- `src/scoring/scoreFusion.ts`
- `src/nodes/reportGenerationNode.ts`
- `src/types.ts`
- `references/scoring/report_result_schema.json`
- `tests/rubric-scoring.test.ts`
- `tests/score-fusion.test.ts`
- `tests/schema-validator.test.ts`
- `tests/score-agent.test.ts`
- `tests/report-renderer.test.ts`

## 测试策略

### 协议与解析测试

在 `tests/rubric-scoring.test.ts` 增加以下覆盖：

- 满分项不带 `deduction_trace` 时可以通过。
- 扣分项带完整 `deduction_trace` 时可以通过。
- 扣分项缺少 `deduction_trace` 时必须失败。
- 扣分项缺少 `code_locations` 或 `rubric_comparison` 时必须失败。
- band 分数不在声明范围内时必须失败。
- prompt 文本必须包含“默认满分、证据不足不得扣分、扣分必须提供完整依据”的约束。

### 融合与降级测试

在 `tests/score-fusion.test.ts` 增加以下覆盖：

- rubric agent 成功且无负面证据时，总分保持满分基线。
- rubric agent `invalid_output` 时，fallback item 分为满分且 `review_required=true`。
- 规则分支仍可在满分基线上施加确定性扣分，不受此次改造影响。

### 报告与 Schema 测试

在 `tests/schema-validator.test.ts`、`tests/score-agent.test.ts`、`tests/report-renderer.test.ts` 增加以下覆盖：

- 满分项的 `agent_evaluation.deduction_trace` 为 `null`。
- 扣分项的 `agent_evaluation.deduction_trace` 会完整透传到 `result.json`。
- HTML 报告只在扣分项显示代码位置、影响范围、rubric 比对和评分理由。

## 风险与取舍

- 更严格的协议会提高 repair 触发频率，但这是可接受成本，因为目标是用更强约束换取更稳定的评分输出。
- 允许满分项继续保持轻量文本，有利于控制 token 和减少模型噪音，但也意味着报告中不会为所有 item 展示详细推理；这是明确的产品取舍。
- 本次不把 rubric 语义硬编码为确定性规则，因此仍保留一定模型判断空间，但该空间会被限制在“是否存在充分负面证据”和“证据对应哪个既有 band”两个问题上，比现状更可控。

## 成功标准

- 同一用例重复执行 rubric 评分时，在无新增负面证据的前提下，item 分数保持稳定，不再因为模型措辞波动随意降档。
- 任一扣分项都能在结果中给出可复核的代码位置、影响范围、rubric 区间比对和明确评分理由。
- rubric agent 失败时，系统按“满分待复核”降级，而不是产生额外低分。
- 现有规则修正链路、结果落盘与报告生成继续正常工作。
