# Rubric 与规则评分并联改造设计

## 背景

当前评分流程已经加载 rubric，也会调用 agent，但现有 agent 的职责只是辅助判定不确定规则。最终评分由 `computeScoreBreakdown` 生成，该函数会先把 rubric 子项初始化到最高分档，再根据规则命中结果扣分。这不符合目标模型：rubric 应该是主评分依据，规则集应该作为辅助修正层。

当前 `featureExtractionNode` 也是占位实现。它只返回固定描述文案，作为未被使用的入参传入评分函数，并额外落盘为 `intermediate/feature-extraction.json` 或出现在日志摘要里。把它从阻塞式主流程中移除，不会改变当前评分行为。

## 目标

- 让基于 rubric 的 agent 评分成为主评分来源。
- 保留确定性规则评测和 agent 辅助规则评判，作为辅助证据与修正项。
- 并联运行 rubric 评分 agent 和规则评判 agent，降低整体评分耗时。
- 从关键路径移除 `featureExtractionNode`，因为它当前不影响评分。
- 当任一 agent 失败或输出非法时，仍保持稳定降级；该降级只服务运行可靠性，不作为旧版本兼容策略。
- 扩展 `report_result_schema.json`，让维度评分同时呈现 rubric agent 评价逻辑和 rules 违规影响。

## 非目标

- 本次不增加构建检查或编译验证。
- 本次不重设计完整 report schema，但需要对 `dimension_results` 做定向扩展。
- 不让规则集独立生成第二套总分。
- 不继续把占位的特征提取节点作为评分必需依赖。

## 当前问题

### Rubric 不是主评分器

`rubricPreparationNode` 会生成 `rubricSnapshot`，但当前 agent prompt 只要求 agent 判断 `assisted_rule_candidates`。agent 输出 schema 只有规则评估结果，没有 rubric 子项分数。

`scoringOrchestrationNode` 会重新加载 rubric 并调用 `computeScoreBreakdown`。该函数把 rubric 维度当成分数容器，先把每个子项初始化到最高分档，再根据规则违规映射做扣分。rubric 的分档描述和评分标准并没有被 agent 直接理解和评判。

### Feature Extraction 没有实际作用

`featureExtractionNode` 当前返回固定占位值：

- `状态管理类型待静态扫描增强`
- `存在 original/workspace 双工程对照输入`
- `命名与关键字提取已预留规则接口`
- patch 是否存在的描述文本

当前使用 `featureExtraction` 的代码路径只有：

- 存入 workflow state。
- 落盘 `intermediate/feature-extraction.json`。
- 输出节点日志摘要。
- 传入 `computeScoreBreakdown`，但函数内部不读取任何字段。
- 测试 fixture 中用于满足当前函数签名。

因此该节点应从必需评分流程中移除。如果后续需要真实特征，应改成可选 evidence builder，或作为 rubric agent 可调用的 case-aware 只读工具能力实现。

## 推荐架构

任务分类后分成两个并联分支：

```text
remoteTaskPreparation
  -> taskUnderstanding
  -> inputClassification
  -> parallel:
       rubricPreparation
       ruleAudit
  -> parallel:
       rubricScoringPromptBuilder -> rubricScoringAgent
       ruleAgentPromptBuilder -> ruleAssessmentAgent -> ruleMerge
  -> scoreFusionOrchestration
  -> reportGeneration
  -> artifactPostProcess
  -> persistAndUpload
```

核心耗时优化来自两个 LLM 调用并发执行：

```text
rubricScoringAgent || ruleAssessmentAgent
```

预期墙钟耗时从：

```text
rule_agent_time + rubric_agent_time + deterministic_time
```

变成：

```text
max(rule_agent_time, rubric_agent_time) + deterministic_time + fusion_time
```

## Workflow 节点

### `rubricPreparationNode`

保留该节点。它负责加载当前任务类型对应的 rubric，并生成 `rubricSnapshot`。

该节点可以在 `inputClassificationNode` 之后立即运行，因为它只依赖 `taskType` 和 `referenceRoot`。

### `ruleAuditNode`

保留该节点。它负责运行确定性规则评测，并识别需要 agent 辅助判定的不确定规则候选。

该节点也可以在 `inputClassificationNode` 之后立即运行。它不依赖被移除的 feature extraction 输出。

### `rubricScoringPromptBuilderNode`

新增节点。

职责：

- 基于 `caseInput`、`taskType`、`constraintSummary`、`rubricSnapshot`、patch 元数据和可用 case 路径构造 rubric 评分 payload。
- 向 agent 提供当前任务类型的完整 rubric 评分分档。
- 明确要求 agent 直接根据代码证据逐项评估每个 rubric item。
- 产出 `rubricScoringPromptText` 和 `rubricScoringPayload`。

该 prompt 不应要求 agent 判断规则 ID。规则判断由规则分支负责。

### `rubricScoringAgentNode`

新增节点。

职责：

- 使用严格 JSON 协议调用模型。
- 允许受限的 case 只读工具调用，能力类似现有 case-aware rule runner。
- 返回结构化 rubric item 分数、证据、理由、置信度、复核标记、硬门槛候选、风险、优势和主要问题。
- 如果 agent 调用失败或协议校验失败，返回失败状态且不产出有效评分。

### `ruleAgentPromptBuilderNode`

替换当前 `agentPromptBuilderNode`。

职责：

- 保留当前规则 agent payload 行为。
- 只针对 `assistedRuleCandidates` 构造 prompt。
- 写入 `ruleAgentPromptText` 和 `ruleAgentBootstrapPayload`。

该命名可以避免误以为当前 prompt 是通用评分 prompt。

### `ruleAssessmentAgentNode`

替换当前 `agentAssistedRuleNode`。

职责：

- 继续判定不确定规则候选。
- 返回 `agentAssistedRuleResults`、`agentTurns` 和 `agentToolTrace`。
- 保留无候选规则或未配置 agent client 时的运行降级行为。

### `ruleMergeNode`

保留该节点。

职责：

- 合并确定性规则结果和规则 agent 结果。
- 产出 `mergedRuleAuditResults`。
- 对 skipped、failed、invalid output 等状态保持运行降级。

### `scoreFusionOrchestrationNode`

新增节点，用于替代主路径上的 `scoringOrchestrationNode`。

职责：

- 以 rubric agent 的 item scores 作为基础分。
- 将确定性规则结果和合并后的规则结果作为 modifier 应用到基础分上。
- 应用硬门槛 score cap。
- 针对低置信度、agent 失败、不确定规则判断、patch 上下文缺失、分数临界带等情况生成 human review items。
- 产出现有 `ScoreComputation` 结构，供 report generation 继续使用。

## State 模型变更

新增 rubric scoring 状态：

```ts
rubricScoringPayload: Annotation<RubricScoringPayload>();
rubricScoringPromptText: Annotation<string>();
rubricScoringResult: Annotation<RubricScoringResult>();
rubricAgentRunStatus: Annotation<AgentRunStatus>();
rubricAgentTurns: Annotation<CaseAwareAgentTurn[]>();
rubricAgentToolTrace: Annotation<CaseToolTraceItem[]>();
```

条件允许时重命名规则 agent 相关状态：

```ts
ruleAgentBootstrapPayload: Annotation<AgentBootstrapPayload>();
ruleAgentPromptText: Annotation<string>();
ruleAgentRunStatus: Annotation<AgentRunStatus>();
```

不保留现有泛化 agent state 名称作为别名。首版直接使用 rubric agent 与 rule agent 的明确命名，避免状态语义混淆。

从必需评分路径移除 feature extraction 状态：

```ts
featureExtraction: Annotation<FeatureExtraction>();
```

不保留 `FeatureExtraction` 作为 workflow state 或 scoring input。相关测试需要同步删除或改写。

## Rubric Agent 输出

引入严格结果类型：

```ts
interface RubricScoringResult {
  summary: {
    overall_assessment: string;
    overall_confidence: ConfidenceLevel;
  };
  item_scores: Array<{
    dimension_name: string;
    item_name: string;
    score: number;
    max_score: number;
    matched_band_score: number;
    rationale: string;
    evidence_used: string[];
    confidence: ConfidenceLevel;
    review_required: boolean;
  }>;
  hard_gate_candidates: Array<{
    gate_id: "G1" | "G2" | "G3" | "G4";
    triggered: boolean;
    reason: string;
    confidence: ConfidenceLevel;
  }>;
  risks: RiskItem[];
  strengths: string[];
  main_issues: string[];
}
```

校验规则：

- `rubricSnapshot.dimension_summaries` 中的每个 rubric item 必须且只能出现一次。
- `score` 必须是该 item 声明过的 rubric band score。
- `matched_band_score` 必须等于 `score`。
- `max_score` 必须等于 item weight。
- 未知 dimension 或未知 item 视为非法输出。
- 证据不足时应设置 `confidence = low` 且 `review_required = true`。

## Report Schema 扩展

需要扩展 `references/scoring/report_result_schema.json`，让评分报告在维度和子项层面同时表达两类信息：

- rubric agent 为什么给出当前分数。
- rules 违规如何影响该维度或子项。

现有 schema 中 `dimension_results.item_results` 只有 `rationale` 和 `evidence` 两个扁平字段，不足以区分 agent 评分依据、规则违规证据和分数融合逻辑。首版直接切换为结构化字段，不做旧字段兼容。

### Dimension 级新增字段

在 `dimension_results[]` 对象中新增：

```ts
agent_evaluation_summary: {
  base_score: number;
  logic: string;
  key_evidence: string[];
  confidence: ConfidenceLevel;
};
rule_violation_summary: {
  violated_rule_count: number;
  affected_item_count: number;
  total_rule_delta: number;
  summary: string;
};
```

字段含义：

- `agent_evaluation_summary.base_score` 是该维度在规则修正前的 rubric agent 基础分。
- `agent_evaluation_summary.logic` 说明 agent 对该维度的总体判断逻辑。
- `agent_evaluation_summary.key_evidence` 列出支撑该维度判断的关键文件、patch 或代码片段摘要。
- `rule_violation_summary.violated_rule_count` 是影响该维度的违规规则数量。
- `rule_violation_summary.affected_item_count` 是被规则修正影响的子项数量。
- `rule_violation_summary.total_rule_delta` 是规则层对该维度造成的总分修正，通常为 0 或负数。
- `rule_violation_summary.summary` 用中文概括规则违规对该维度的影响。

### Item 级新增字段

在 `dimension_results[].item_results[]` 对象中新增：

```ts
agent_evaluation: {
  base_score: number;
  matched_band_score: number;
  matched_criteria: string;
  logic: string;
  evidence_used: string[];
  confidence: ConfidenceLevel;
};
rule_impacts: Array<{
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "不满足" | "待人工复核";
  severity: "review_only" | "light" | "medium" | "heavy" | "gating";
  score_delta: number;
  reason: string;
  evidence: string;
  agent_assisted: boolean;
  needs_human_review: boolean;
}>;
score_fusion: {
  base_score: number;
  rule_delta: number;
  final_score: number;
  fusion_logic: string;
};
```

字段含义：

- `agent_evaluation` 记录 rubric agent 对该 item 的基础判断，不混入规则扣分。
- `rule_impacts` 只记录影响该 item 的规则结果，不重复塞入全量 `rule_audit_results`。
- `score_fusion.base_score` 必须等于 `agent_evaluation.base_score`。
- `score_fusion.rule_delta` 是该 item 所有 `rule_impacts.score_delta` 的合计。
- `score_fusion.final_score` 必须等于最终输出的 `score`。
- `score_fusion.fusion_logic` 用中文说明“为什么从基础分变成最终分”。

### Schema 切换策略

本次扩展应把新增字段设为 required。理由是改造目标就是让每个维度评分都可解释，如果这些字段可选，报告仍可能退化成旧的不可区分结构。

旧字段处理：

- `comment` 保留，用于维度级简短结论，它不是兼容字段，而是维度 summary。
- `rationale` 从 `item_results[]` 中移除，由 `agent_evaluation.logic` 和 `score_fusion.fusion_logic` 取代。
- `evidence` 从 `item_results[]` 中移除，由 `agent_evaluation.evidence_used` 和 `rule_impacts[].evidence` 取代。

### Report Generation 要求

`reportGenerationNode` 需要从 `scoreComputation.submetricDetails` 或新的 fusion detail 中生成上述字段。

建议在 `ScoreComputation` 中增加结构化明细，避免 report 层反推：

```ts
interface RuleImpactDetail {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: "不满足" | "待人工复核";
  severity: "review_only" | "light" | "medium" | "heavy" | "gating";
  score_delta: number;
  reason: string;
  evidence: string;
  agent_assisted: boolean;
  needs_human_review: boolean;
}

interface ScoreFusionDetail {
  dimension_name: string;
  item_name: string;
  agent_evaluation: {
    base_score: number;
    matched_band_score: number;
    matched_criteria: string;
    logic: string;
    evidence_used: string[];
    confidence: ConfidenceLevel;
  };
  rule_impacts: RuleImpactDetail[];
  score_fusion: {
    base_score: number;
    rule_delta: number;
    final_score: number;
    fusion_logic: string;
  };
}
```

`dimension_results` 中的新增 dimension 级字段应由同一维度下的 `ScoreFusionDetail[]` 聚合得到。

## 分数融合规则

融合原则：

```text
final score = rubric base score + rule modifiers
```

规则不能生成独立的第二套总分。

### 基础分

当 `rubricAgentRunStatus === "success"`：

- 汇总 `rubricScoringResult.item_scores`。
- 按 dimension 聚合分数。
- 使用 rubric agent 的 rationale 和 evidence 作为初始 submetric details。

当 rubric scoring 失败：

- 降级为规则预检评分路径。
- 添加 human review item，说明当前分数是 agent 失败后的规则预检结果。
- 视情况标记低置信度。

### 规则修正

使用 `mergedRuleAuditResults` 调整 rubric item 分数：

- `must_rule` 违规：对映射到的 rubric item 做中等到较重扣分。
- `forbidden_pattern` 违规：重扣，加入风险项，并可能触发 hard gate。
- `should_rule` 违规：轻扣或降低 confidence。
- `case_rule` P0 违规：触发 hard gate candidate，并强制进入人工复核。
- `待人工复核`：默认不直接重扣，但降低 confidence 并加入 review item。

首版可以复用现有 rule-to-metric mapping，但它应修改 rubric agent 的基础分，而不是从满分开始扣。

### 硬门槛

硬门槛来源：

- rubric agent 输出的中高置信度 hard gate candidates。
- 当前已实现的确定性规则触发条件。
- P0 case rule 违规。

如果多个硬门槛同时触发，应用最严格的 score cap。

### 人工复核

以下情况应增加 review item：

- rubric agent 失败或返回非法输出。
- rule agent 失败或返回非法输出。
- 任一 item confidence 为 low。
- 任一规则结果为 `待人工复核`。
- 触发 hard gate。
- 最终分数落入配置的临界分数带。
- bug fix 或 continuation 缺少 patch 上下文。

## Feature Extraction 移除

从 workflow edges 中移除 `featureExtractionNode`。

当前链路：

```text
inputClassification -> featureExtraction -> ruleAudit
```

目标链路：

```text
inputClassification -> rubricPreparation
inputClassification -> ruleAudit
```

同时移除或更新：

- `src/workflow/scoreWorkflow.ts` 中的 import、node 注册和 edge。
- `src/workflow/state.ts` 中的 `featureExtraction` annotation。
- `src/scoring/scoringEngine.ts` 中的 `featureExtraction` 输入字段。
- `src/nodes/persistAndUploadNode.ts` 中写入 `intermediate/feature-extraction.json` 的逻辑。
- `src/workflow/observability` 中 feature extraction 的 node label、node id 和 summary。
- README 和设计文档中把 `featureExtractionNode` 列为活跃节点的内容。
- 仅用于 summarizing 或传递 placeholder feature extraction data 的测试。

不保留 `feature-extraction.json` 兼容产物。该节点本身就是占位实现，继续写占位 artifact 会误导后续排查。

## 持久化产物变更

分别持久化两个 agent 的产物：

- `inputs/rubric-scoring-prompt.txt`
- `inputs/rubric-scoring-payload.json`
- `inputs/rule-agent-prompt.txt`
- `inputs/rule-agent-bootstrap-payload.json`
- `intermediate/rubric-agent-result.json`
- `intermediate/rubric-agent-turns.json`
- `intermediate/rubric-agent-tool-trace.json`
- `intermediate/rule-agent-result.json`
- `intermediate/rule-agent-turns.json`
- `intermediate/rule-agent-tool-trace.json`
- `intermediate/rule-audit-merged.json`
- `intermediate/score-fusion.json`
- `intermediate/report-schema-version.json`

旧的 `inputs/agent-prompt.txt` 不保留，新产物命名必须区分 rubric agent 和 rule agent。

## 测试策略

新增或更新单元测试：

- `featureExtractionNode` 已从 workflow 顺序中移除。
- rubric agent 输出校验接受完整合法输出。
- rubric agent 输出校验拒绝缺少 rubric item 的结果。
- rubric agent 输出校验拒绝超出声明分档的分数。
- score fusion 使用 rubric agent scores 作为基础分。
- score fusion 能应用 `must_rule` 和 `forbidden_pattern` modifiers。
- score fusion 能应用 hard gate caps。
- `report_result_schema.json` 要求每个 dimension result 包含 agent 评价摘要和规则违规摘要。
- `report_result_schema.json` 要求每个 item result 包含 `agent_evaluation`、`rule_impacts` 和 `score_fusion`，且不再接受旧的 `rationale/evidence` item 字段。
- `reportGenerationNode` 能把 score fusion 明细映射成扩展后的 `dimension_results`。
- rubric agent 失败时降级到规则预检评分。
- rule agent 失败时仍能产出基于 rubric 的分数，并加入 review items。
- 两个 agent 都失败时返回规则预检评分，并标记低置信度复核项。

新增集成测试：

- 没有 assisted rule candidates 时，rubric scoring 仍运行，规则分支快速 skip。
- 存在 assisted rule candidates 时，rubric 分支和规则分支都贡献最终输出。
- 远程任务流程仍能生成 `result.json` 和 `report.html`。

## 首版实施计划

1. 引入 rubric scoring 类型和校验逻辑。
2. 新增 rubric scoring prompt builder 和 agent node。
3. 用 `ruleAgentPromptBuilderNode` 和 `ruleAssessmentAgentNode` 替换现有泛化 agent 节点命名。
4. 实现以 rubric scores 为基础分的 score fusion。
5. 将 workflow 改造成 rubric 与规则双分支并联。
6. 从 workflow edges 和 scoring inputs 中移除 `featureExtractionNode`。
7. 扩展 `report_result_schema.json`，在维度和子项评分中加入 agent 评价逻辑、rules 违规影响和 score fusion 明细。
8. 更新 `reportGenerationNode`，生成扩展后的 `dimension_results`。
9. 更新持久化产物名称。
10. 更新文档和测试。
11. 运行 build 和评分相关测试。
12. 用代表性本地 case 对比改造前后的耗时与分数分布。

## 实现默认决策

- 不保留 `feature-extraction.json` 兼容产物。被移除的节点不应继续写入 placeholder data。
- 不保留现有泛化 agent state 名称作为迁移别名，首版直接使用明确的 rubric agent 和 rule agent state。
- 首版必须扩展 `report_result_schema.json`。维度评分和子项评分必须结构化展示 agent 评价逻辑、rules 违规情况和最终分数融合过程。
- 不保留 `item_results[].rationale` 和 `item_results[].evidence` 作为兼容字段；新报告只使用 `agent_evaluation`、`rule_impacts` 和 `score_fusion` 表达子项评分逻辑。

## 建议

在同一个改造批次中实现双 agent 并联 workflow，并从必需路径移除 `featureExtractionNode`。当前 feature extraction 输出没有评分价值，把它继续作为依赖只会让新的并联图更复杂，不会改善评分结果。

最终架构应以 rubric agent scoring 作为主评分来源。合并后的规则审计结果只作为 modifiers、hard gate triggers、risks 和 human review signals 使用。这样更符合 rubric-first 的目标架构，也能通过重叠两个模型调用降低评分耗时。
