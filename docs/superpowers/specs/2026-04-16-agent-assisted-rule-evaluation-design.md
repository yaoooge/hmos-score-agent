# 规则引擎优先的 Agent 辅助判定设计

## 1. 背景

当前评分工作流已经具备以下能力：

- 基于 `input.txt`、`original/`、`workspace/`、`diff/changes.patch` 加载评分用例
- 基于本地规则映射与静态证据完成一批确定性规则判定
- 基于 repo 内 `references/scoring/` 中的 `rubric.yaml`、规则文档和 schema 生成评分结果
- 产出统一的 `result.json`、`report.html`、`run.log`、输入快照等本地产物

但当前工作流仍有两个明显不足：

1. `input.txt` 只是上一步生成代码时的原始 prompt，它适合作为用例事实保存，不适合作为评分阶段直接发给 agent 的输入。
2. 本地规则引擎擅长做确定性、文本模式型判定，但对于“弱规则”“上下文相关规则”“需要语义理解的候选项”能力不足。

因此，本轮需要在“规则引擎优先”的前提下，引入 agent 辅助判定能力。agent 不直接主导最终评分，而是仅在本地规则引擎无法稳定定性的规则上提供结构化辅助意见。

## 2. 目标

本轮实现目标如下：

1. 保留原始 `input.txt` 作为评分用例事实，不再把它直接视为评分阶段的 agent prompt。
2. 在任务理解和 rubric 加载完成后，组织新的评分 prompt，并据此与 agent 交互。
3. 本地规则引擎优先完成确定性规则判定，只把弱规则和不确定规则作为候选项交给 agent。
4. agent 采用“单次批量评审”模式，对候选规则列表输出结构化辅助判定结果。
5. 最终规则审计结果仍由本地代码归一化、合并和兜底，评分引擎只消费合并后的统一结果。
6. 将 agent prompt、prompt payload、候选规则、agent 返回、合并结果完整落盘，便于调试和后续引入人工复审闭环。

## 3. 非目标

本轮明确不做以下事项：

- 不让 agent 直接生成最终 `result.json`
- 不让 agent 覆盖本地已经确定的规则判定结果
- 不引入多轮 agent 对话或逐条规则调用
- 不实现人工复审回收、知识库存储和检索增强
- 不重构为 AST 级规则引擎
- 不改变现有 `result.json` schema 的字段名

## 4. 设计原则

### 4.1 原始输入与评分提示词分离

原始 `input.txt` 是“生成任务事实”，不是“评分任务指令”。评分阶段必须基于任务理解、rubric 摘要、规则候选与证据片段重新组织 agent prompt。

### 4.2 本地确定性优先

任何本地规则引擎已能稳定判断的规则，都不应交给 agent 二次裁决。agent 只处理不确定范围，避免把稳定逻辑变成不稳定逻辑。

### 4.3 Agent 只输出结构化辅助意见

agent 当前版本不是最终评分器，只返回规则级辅助判定。最终结论、分数计算、报告落盘都仍由本地代码完成。

### 4.4 全链路可回放

后续需要接人工复审与知识回流，因此必须保留：

- 原始 prompt
- 评分 prompt
- prompt payload
- 待辅助规则候选
- agent 原始结构化结果
- 合并后的规则审计结果

这样才能形成未来的 `candidate -> agent -> merged -> human` 链路。

### 4.5 快速落地优先

当前版本优先使用单次批量调用的简单模型，不提前引入逐条规则编排、复杂会话管理或高成本的上下文切片框架。

## 5. 总体方案

### 5.1 双层判定架构

评分流程拆为两层：

#### 第一层：本地规则引擎

负责：

- 扫描 `workspace`、`original`、`patch`
- 产出确定性规则结果
- 识别待辅助判定的规则候选
- 为候选规则收集证据文件、代码片段和不确定原因

#### 第二层：Agent 辅助判定

负责：

- 接收评分阶段新组装的 prompt
- 对候选规则给出结构化辅助意见
- 明确输出置信度、原因、是否需要人工复核

#### 合并层：本地规则结果归一化

负责：

- 合并本地确定性结果与 agent 辅助结果
- 拒绝 agent 改写本地已确定的规则结论
- 将结果映射回统一的 `满足 / 不满足 / 不涉及 / 待人工复核` 语义体系

### 5.2 调用粒度

当前版本固定采用“单次批量评审”：

- 一次调用中传入所有候选规则
- 一次返回整批结构化辅助判定

这样能在当前阶段以最小编排成本快速落地，并控制延迟、成本和失败面。

## 6. 工作流改造

### 6.1 当前链路

```text
taskUnderstandingNode
-> inputClassificationNode
-> featureExtractionNode
-> ruleAuditNode
-> scoringOrchestrationNode
-> reportGenerationNode
-> persistAndUploadNode
```

### 6.2 目标链路

```text
taskUnderstandingNode
-> inputClassificationNode
-> featureExtractionNode
-> ruleAuditNode
-> rubricPreparationNode
-> agentPromptBuilderNode
-> agentAssistedRuleNode
-> ruleMergeNode
-> scoringOrchestrationNode
-> reportGenerationNode
-> persistAndUploadNode
```

### 6.3 节点职责

#### `ruleAuditNode`

改为输出两类结果：

- `deterministicRuleResults`
- `assistedRuleCandidates`

同时产出候选规则的证据材料。

#### `rubricPreparationNode`

负责读取当前 `taskType` 对应的 rubric，并裁剪成评分阶段和 agent 都需要的统一摘要。

#### `agentPromptBuilderNode`

负责组装：

- `agentPromptPayload`
- `agentPromptText`

它不调用模型，只负责把评分上下文压缩成可控输入。

#### `agentAssistedRuleNode`

负责：

- 调用 agent
- 校验返回结构
- 输出标准化的辅助判定结果或失败状态

#### `ruleMergeNode`

负责：

- 合并本地确定性规则结果与 agent 辅助结果
- 生成 `mergedRuleAuditResults`
- 供后续评分和报告节点统一消费

## 7. 状态模型设计

建议在工作流状态中新增以下字段：

- `originalPromptText`
- `rubricSnapshot`
- `deterministicRuleResults`
- `assistedRuleCandidates`
- `agentPromptPayload`
- `agentPromptText`
- `agentAssistedRuleResults`
- `mergedRuleAuditResults`
- `agentRunStatus`

各字段语义如下：

### `originalPromptText`

保留原始 `input.txt` 内容，仅表示上一步生成任务的事实背景。

### `rubricSnapshot`

保存为当前 `taskType` 裁剪后的 rubric 摘要，避免评分和 prompt 组装读取不同版本或不同范围的 rubric。

### `deterministicRuleResults`

保存本地规则引擎已经确定的规则结果。

### `assistedRuleCandidates`

保存待 agent 辅助判定的候选规则列表，每条至少应包含：

- `rule_id`
- `rule_source`
- `why_uncertain`
- `local_preliminary_signal`
- `evidence_files`
- `evidence_snippets`

### `agentPromptPayload`

保存组装 agent prompt 时使用的结构化输入，便于调试、裁剪和回放。

### `agentPromptText`

保存真正发送给 agent 的最终 prompt 文本。

### `agentAssistedRuleResults`

保存 agent 返回且通过本地 schema 校验后的结构化辅助结果。

### `mergedRuleAuditResults`

保存最终供评分引擎消费的统一规则审计结果。

### `agentRunStatus`

标记本轮 agent 调用状态，建议枚举值包含：

- `not_enabled`
- `success`
- `failed`
- `invalid_output`
- `skipped`

## 8. Prompt 组织方式

### 8.1 输入载荷结构

`agentPromptPayload` 建议由以下部分组成：

- `case_context`
- `task_understanding`
- `rubric_summary`
- `deterministic_rule_results`
- `assisted_rule_candidates`
- `response_contract`

### 8.2 `case_context`

包含：

- `case_id`
- `task_type`
- 原始 prompt 摘要
- 是否有 patch
- `original/workspace` 路径摘要

### 8.3 `task_understanding`

直接来自 `taskUnderstandingNode` 的结构化输出，包括：

- 显式约束
- 上下文约束
- 隐式约束
- 分类提示

### 8.4 `rubric_summary`

只保留当前任务类型评分真正需要的内容，不直接塞整份 `rubric.yaml`。建议包括：

- 评分维度与子项摘要
- 硬门槛列表
- 人工复核规则摘要

### 8.5 `deterministic_rule_results`

仅作为背景输入给 agent，不要求 agent 重判这些规则。

### 8.6 `assisted_rule_candidates`

这是本轮 agent 的主任务对象。每条候选规则需要带：

- 规则标识
- 不确定原因
- 本地信号
- 证据文件路径
- 截断后的代码片段

### 8.7 自然语言 Prompt 约束

最终发送给 agent 的 prompt 需要明确：

1. 你不是最终评分器
2. 你只对候选弱规则做辅助判断
3. 必须优先依据提供的证据
4. 不确定时必须返回 `needs_human_review: true`
5. 所有描述型文案必须使用中文
6. 只能输出 JSON，不允许输出额外说明性文本

## 9. Agent 返回 Schema

建议使用如下结构：

```json
{
  "summary": {
    "assistant_scope": "本次仅辅助弱规则判定",
    "overall_confidence": "medium"
  },
  "rule_assessments": [
    {
      "rule_id": "ARKTS-SHOULD-001",
      "decision": "violation|pass|not_applicable|uncertain",
      "confidence": "high|medium|low",
      "reason": "中文说明",
      "evidence_used": [
        "entry/src/main/ets/pages/Index.ets"
      ],
      "needs_human_review": true
    }
  ]
}
```

本地代码在消费前必须执行：

1. JSON 解析校验
2. schema 校验
3. `rule_id` 白名单校验
4. decision 到本地结论体系的映射

## 10. 合并规则

### 10.1 决策优先级

1. 本地确定性结果优先级最高
2. agent 只能覆盖候选弱规则
3. 低置信度或 `uncertain` 结果映射为“待人工复核”
4. 未返回或非法返回的候选规则按本地默认策略回退

### 10.2 回退原则

如果 agent 不可用或输出非法：

- 整条评分工作流不能失败
- 本地记录失败状态
- 仍输出完整 `result.json` 和 `report.html`
- 仅对候选规则采用本地兜底结果

## 11. 落盘设计

### 11.1 输入目录

建议新增或调整以下文件：

- `inputs/original-prompt.txt`
- `inputs/agent-prompt.txt`
- `inputs/agent-prompt-payload.json`

其中：

- `original-prompt.txt` 保存原始 `input.txt`
- `agent-prompt.txt` 保存真正发送给 agent 的评分 prompt
- `agent-prompt-payload.json` 保存 prompt 组装前的结构化上下文

### 11.2 中间目录

建议新增：

- `intermediate/rubric-snapshot.json`
- `intermediate/agent-assisted-rule-candidates.json`
- `intermediate/agent-assisted-rule-result.json`
- `intermediate/rule-audit-merged.json`

### 11.3 `case-info.json`

建议增加字段：

- `original_prompt_file`
- `agent_prompt_file`
- `agent_assistance_enabled`
- `agent_model`
- `agent_run_status`

### 11.4 `run.log`

至少增加以下关键日志：

- rubric 加载完成
- agent prompt 组装完成
- agent 调用开始
- agent 调用完成
- agent 辅助判定合并完成
- agent 调用失败或输出非法

## 12. 失败处理

### 12.1 Agent 不可用

如果模型未配置、SDK 初始化失败或请求失败：

- 记录 `agentRunStatus=failed|skipped`
- 工作流继续执行
- 对候选规则采用本地兜底逻辑

### 12.2 Agent 返回不合法

如果返回不是合法 JSON 或未通过 schema：

- 记录 `agentRunStatus=invalid_output`
- 工作流继续执行
- 本轮 agent 辅助结果视为无效

### 12.3 Agent 返回部分缺项

只对缺失的规则项回退，不废弃整批合法结果。

## 13. 测试策略

### 13.1 单元测试

覆盖：

- 候选规则筛选逻辑
- rubric 摘要裁剪
- agent prompt 组装
- agent 返回 schema 校验
- 规则合并策略

### 13.2 工作流测试

覆盖：

- agent 成功返回时，合并结果进入评分链路
- agent 失败时，工作流仍能输出完整结果
- 相关落盘文件齐全且内容可读

### 13.3 集成测试

使用 stub agent client 固定返回 JSON，验证整条链路：

- prompt 组织
- 调用
- 合并
- 报告输出
- 日志记录

## 14. 后续扩展

本设计为后续引入人工复审和知识增强预留以下演进路径：

```text
candidate
-> agent result
-> merged result
-> human review
-> knowledge base
```

后续版本可在不推翻当前架构的前提下继续扩展：

- 将人工复审结论回收为样本
- 用规则候选与人工结论构建知识库
- 对 agent prompt 注入相似历史案例
- 逐步从文本规则过渡到 AST 规则

## 15. 实现范围建议

为了快速落地，当前第一版实现范围建议控制为：

1. 保留现有文本规则引擎主体
2. 只把弱规则和未覆盖规则纳入 agent 辅助链路
3. 先使用单次批量 agent 调用
4. 先落完整输入、中间态和日志证据
5. 先保证失败可回退，再逐步增强判定精度

该范围能够在不推翻当前实现的前提下，为后续人工复审闭环和 AST 升级打下稳定基础。
