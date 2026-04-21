# Case-Aware Agent 协议收敛与硬化设计

## 1. 背景

当前 case-aware agent 辅助评分链路已经跑通，但最近几轮问题暴露出三个结构性缺陷：

1. 协议定义分散在 `prompt`、`runner`、`merge`、`report` 多处，字段语义和兜底策略不一致。
2. 解析器过于宽松，会从模型输出中扫描任意 JSON 片段并尝试接受“看起来能用”的对象，容易把示例、回显或畸形输出误判成真实结果。
3. agent 运行状态、原始输出、解析结果、最终可消费结果分散在多个 state 字段里，下游节点需要重复推断“这次结果到底能不能用”。

最近为修复“只输出总体判断、没有分条规则结论”的问题，已经在 runner 中加入了 `final_answer` 完整性校验和 repair prompt。这说明链路的真实问题不是单个提示词缺失，而是协议中心线不够稳定，导致每次异常都只能继续打补丁。

本轮目标不是继续增加 provider-specific 兼容分支，而是把 case-aware agent 交互协议收敛成一个单一、严格、可演进的实现中心。

## 2. 目标

本轮设计目标如下：

1. 以单一模块定义 case-aware agent 的 canonical protocol，作为 prompt、parser、runner、merge、persist 的唯一事实来源。
2. 解析阶段只接受一个顶层 JSON object，不再扫描任意片段，不再兼容旧字段和变体结构。
3. 运行阶段返回一个统一的结构化结果对象，下游只通过该对象判断结果是否可用。
4. `final_answer` 必须逐条覆盖全部候选规则，最终报告必须保留 agent 给出的逐条判断，而不是退化成“未能提供有效判定”。
5. 中间产物持久化改为“业务结果”和“调试轨迹”分离，便于调试、回放和后续扩展。

## 3. 非目标

本轮明确不做以下事项：

- 不重构 `caseTools` 的工具执行逻辑和预算策略
- 不改变整体评分引擎、分数计算和 HTML 报告的业务结构
- 不为历史 provider 输出变体或非 canonical 结构保留兼容层
- 不继续引入新的“解析失败后猜测修复” heuristics
- 不新增 provider-specific prompt hack

由于当前为首版本开发，本轮允许直接替换旧协议，不考虑向后兼容。

## 4. 核心问题

### 4.1 解析器接受面过宽

当前 `src/agent/caseAwarePrompt.ts` 既承担 prompt 渲染，又承担解析和兼容归一化。它会扫描模型输出中的所有 `{ ... }` 候选，再逐个尝试 schema 校验。这会带来两个高风险问题：

- prompt 中本身带有 JSON 示例时，模型回显示例就可能被误解析成真实 action
- 一个包含废话、多个对象、半截对象或旧版结构的输出，可能仍然被“捞出一个能过 schema 的片段”并继续执行

这种宽松容错在 agent 协议里会掩盖真实错误，也让问题定位变得困难。

### 4.2 协议定义重复

当前至少存在以下重复定义：

- prompt 中要求的 `tool_call` / `final_answer` 结构
- parser 中的 schema
- merge 层重新定义的 `final_answer` schema
- runner 对 `final_answer` 完整性的补充约束

协议重复意味着任何字段变更都需要同时修改多处，而且很容易只修一半，形成新的不一致。

### 4.3 结果语义分散

当前 state 同时保存：

- `agentRunStatus`
- `agentRawOutputText`
- `agentTurns`
- `agentToolTrace`
- `forcedFinalizeReason`
- `agentAssistedRuleResults`
- `mergedRuleAuditResults`

其中“这次 agent 是否给出了可消费的最终判定”并不是一个单点事实，而需要由多个字段组合推断。这直接导致 merge、report、persist 各自实现一套判定逻辑。

## 5. 设计原则

### 5.1 协议单点定义

case-aware agent 协议必须由一个模块定义，其他层只能消费该模块暴露的类型、schema 和 helper，不能自行复制结构。

### 5.2 失败显式暴露

如果模型没有遵守协议，应明确落为 `protocol_error` 或其他失败 outcome，而不是尝试“猜它想表达什么”。

### 5.3 可消费结果单点判断

是否存在可消费的 agent 结果，只由统一 runner result 中的 `final_answer` 是否存在决定；不再让下游通过原始文本和状态字段猜测。

### 5.4 轨迹与业务结果分离

调试需要保留完整 turns 和 tool trace，但业务消费只依赖结构化 final result；这两者必须分离持久化。

## 6. 总体方案

### 6.1 新增协议中心模块

新增单一协议模块：

- `src/agent/caseAwareProtocol.ts`

该模块负责定义：

- canonical `tool_call` schema
- canonical `final_answer` schema
- planner output union schema
- `final_answer` 完整性校验
- runner result/outcome 类型
- 严格解析入口
- 供 prompt 层复用的协议说明常量

其他文件的职责调整如下：

- `caseAwarePrompt.ts` 只负责渲染 prompt，不再负责解析或兼容旧结构
- `caseAwareAgentRunner.ts` 只负责驱动循环、调用模型、执行工具、返回 runner result
- `ruleAssistance.ts` / `ruleMergeNode.ts` 不再自行定义 `final_answer` schema，而是消费 canonical final answer

### 6.2 Canonical Protocol

#### Tool Call

唯一合法的工具调用结构：

```json
{
  "action": "tool_call",
  "tool": "read_file",
  "args": {
    "path": "entry/src/main/ets/pages/Index.ets"
  },
  "reason": "需要确认页面中是否存在硬编码字符串"
}
```

要求：

- 只允许一个顶层对象
- `action` 必须为 `tool_call`
- `tool` 必须来自允许工具集合
- `args` 必须为对象
- `reason` 必须为字符串

#### Final Answer

唯一合法的最终结果结构：

```json
{
  "action": "final_answer",
  "summary": {
    "assistant_scope": "本次仅辅助候选规则判定",
    "overall_confidence": "medium"
  },
  "rule_assessments": [
    {
      "rule_id": "ARKTS-SHOULD-001",
      "decision": "pass",
      "confidence": "high",
      "reason": "相关文件中未发现该规则对应问题",
      "evidence_used": [
        "entry/src/main/ets/pages/Index.ets"
      ],
      "needs_human_review": false
    }
  ]
}
```

要求：

- 只允许一个顶层对象
- `action` 必须为 `final_answer`
- `summary` 必须完整
- `rule_assessments` 必须是非空数组
- 每个 assessment 都必须满足 canonical schema
- `rule_assessments` 必须覆盖当前全部 `assisted_rule_candidates.rule_id`
- 允许顺序不同，但不允许缺失或重复 rule_id

### 6.3 严格解析策略

新增 `parseCaseAwarePlannerOutputStrict(rawText)`，约束如下：

1. 输入必须整体是一个合法 JSON object
2. 去除首尾空白后，不能存在 JSON 对象之外的任何前后缀文本
3. 不扫描第二个对象，不提取片段，不尝试局部修复
4. 只按 canonical schema 校验
5. 解析失败时返回明确的协议错误原因

明确移除所有非 canonical 兼容逻辑：

- 非 canonical 顶层字段别名
- 非 canonical assessment 字段别名
- numeric/string 混合 confidence 归一化
- 任意嵌套业务结果结构
- 对任意 JSON 片段的扫描和拾取

### 6.4 Prompt 约束收紧

`caseAwarePrompt.ts` 保留 prompt 生成，但收紧表达方式：

- 保留必要的结构说明
- 删除大段可被模型原样回显并被误判的完整 JSON 示例
- 如需示例，只保留最小说明或将示例放入不可被 parser 误接收的自然语言描述中
- 明确要求“只输出一个 JSON object，且不能包含额外文本”

修复 prompt 的目标不是靠示例引导兼容，而是让模型更稳定地输出 canonical protocol。

### 6.5 Runner 结果语义统一

`runCaseAwareAgent` 返回值改为单一结果对象，例如：

```ts
type CaseAwareRunnerOutcome =
  | "success"
  | "request_failed"
  | "protocol_error"
  | "tool_budget_exhausted";

type CaseAwareRunnerResult = {
  outcome: CaseAwareRunnerOutcome;
  final_answer?: CaseAwareAgentFinalAnswer;
  final_answer_raw_text?: string;
  failure_reason?: string;
  turns: CaseAwareAgentTurn[];
  tool_trace: CaseToolTraceItem[];
};
```

关键语义：

- `outcome === "success"` 时必须存在 `final_answer`
- 是否存在“可消费结果”，只看 `final_answer`
- `failure_reason` 只用于调试和日志，不再让下游据此拼业务语义
- 不再对外暴露 `status + raw + parsed + forcedFinalizeReason` 这种分散组合
- `skipped`、`not_enabled` 这类“没有启动 runner”的状态保留在工作流节点分支里处理，不属于 runner outcome

### 6.6 Final Answer 完整性校验前移

`final_answer` 的逐条覆盖校验进入协议模块，作为 canonical validation 的一部分。runner 的行为改为：

1. 解析出 canonical object
2. 若是 `tool_call`，继续执行
3. 若是 `final_answer`，调用 `validateCaseAwareFinalAnswerAgainstCandidates`
4. 缺失 rule_id、重复 rule_id 或空数组，统一视为 `protocol_error`

是否保留 repair prompt：

- 保留一次有限重试能力，但它属于 runner 编排策略，不属于协议兼容层
- repair prompt 只能要求“按 canonical schema 重发完整 final_answer”
- 若重试后仍不满足协议，则直接失败，不再继续猜测修复

### 6.7 Merge 层简化

`ruleMergeNode` 和 `mergeRuleAuditResults` 的输入改为 canonical final answer，而不是原始文本。

目标改造：

- 删除 merge 层自带的 `agentResponseSchema`
- 删除 merge 层对原始 `agentOutputText` 的再解析
- 合并逻辑只做业务映射：
  - `violation -> 不满足`
  - `pass -> 满足`
  - `not_applicable -> 不涉及`
  - `uncertain -> 待人工复核`
- 报告中保留每条 `reason`、`confidence`、`needs_human_review` 和 `evidence_used`

这样 merge 层不再承担协议容错责任，只承担规则语义归一化责任。

### 6.8 State 与持久化收敛

工作流 state 调整为以 runner result 为中心，而不是散字段拼装。

建议新增或替换为：

- `agentRunnerResult`
- `agentTurns`
- `agentToolTrace`

建议移除或停止作为主业务输入使用：

- `agentRawOutputText`
- `forcedFinalizeReason`
- `agentRunStatus` 作为下游业务判断主依据

其中：

- `agentRunnerResult` 保存结构化 outcome、final answer、failure reason
- `agentTurns` 和 `agentToolTrace` 作为独立调试字段保留

持久化文件改为：

- `intermediate/agent-runner-result.json`
- `intermediate/agent-turns.json`
- `intermediate/agent-tool-trace.json`

业务结果和调试轨迹分离后，下游不需要再从多个文件拼接“这次到底发生了什么”。

### 6.9 报告输出原则

报告层不展示规则 YAML 内容，目录保持 `references/rules/` 不变。

对于 agent 辅助规则的报告输出，遵循以下原则：

- 如果存在 canonical `final_answer`，必须输出分条规则结论
- 每条规则至少展示：
  - 规则标识
  - agent 判定结论
  - reason
  - confidence
  - 是否需要人工复核
- 只有在 runner 没有产出 `final_answer` 时，才允许退化为“agent 未产出有效判定”

这可以避免“模型其实给了逐条判断，但最终报告只显示总体失败文案”的信息损失。

## 7. 文件级改造范围

### 7.1 新增文件

- `src/agent/caseAwareProtocol.ts`

### 7.2 重点修改文件

- `src/agent/caseAwarePrompt.ts`
  - 删除解析与旧结构兼容逻辑
  - 仅保留 prompt 渲染
- `src/agent/caseAwareAgentRunner.ts`
  - 改为返回统一 runner result
  - 使用协议模块完成解析和 final answer 校验
- `src/agent/ruleAssistance.ts`
  - 删除重复 schema
  - merge helpers 改为接收 canonical final answer
- `src/nodes/agentAssistedRuleNode.ts`
  - state 写入方式改为围绕 runner result
- `src/nodes/ruleMergeNode.ts`
  - 不再读取原始文本做解析
- `src/nodes/persistAndUploadNode.ts`
  - 输出新的中间文件
- `src/nodes/reportGenerationNode.ts`
  - 优先消费 canonical per-rule assessments 生成分条结论
- `src/workflow/state.ts`
  - 收敛 agent 相关状态字段

## 8. 迁移策略

由于本项目当前视为首版本开发，本轮采用直接替换策略：

1. 删除旧兼容解析分支
2. 删除重复 schema
3. 让所有下游节点统一切到 canonical final answer 和 runner result
4. 不保留旧 `agentRawOutputText` 驱动的业务流程

这样可以避免“新旧协议并行”导致的复杂度反弹。

## 9. 测试策略

测试覆盖以下层次：

### 9.1 协议单元测试

覆盖：

- 单一合法 `tool_call` 解析成功
- 单一合法 `final_answer` 解析成功
- 前后带废话文本时解析失败
- 多个 JSON object 时解析失败
- 旧字段变体输入时解析失败
- 缺失候选规则时 final answer 校验失败
- 重复 rule_id 时校验失败

### 9.2 Runner 测试

覆盖：

- 正常 tool_call -> final_answer 成功路径
- 模型请求失败落为 `request_failed`
- 非法输出落为 `protocol_error`
- 预算耗尽落为 `tool_budget_exhausted`
- repair prompt 后仍缺 rule_id 时最终失败

### 9.3 Merge 与报告测试

覆盖：

- merge 直接消费 canonical final answer
- 报告保留分条判断、reason、confidence
- 没有 final answer 时正确回退为待人工复核或失败说明
- 报告不展示 `references/rules/` 下的规则 YAML 内容

## 10. 风险与权衡

### 10.1 更严格后，短期失败率可能上升

移除兼容逻辑后，一些原本“勉强能过”的模型输出会直接失败。这是预期内的，因为这些输出并不稳定，也不应该继续被接受。

### 10.2 Prompt 需要与严格协议同步优化

如果 prompt 仍然保留大量示例或模糊措辞，严格 parser 会更容易暴露模型不遵守协议的问题。因此 prompt 收紧和 parser 硬化必须一起落地。

### 10.3 Runner result 一旦成为中心事实，后续扩展要通过协议模块进行

这会抬高新增字段的门槛，但这是有意为之。agent 协议属于系统边界，应该慢而明确地演进，而不是在各层随意加字段。

## 11. 结论

本轮不是修某一个报告字段或某一个 prompt 文案，而是把 case-aware agent 从“能跑但易漂移”的多点协议，收敛成“单点定义、严格解析、统一结果语义”的中心化协议实现。

完成后，链路会获得三项直接收益：

1. parser 不再误吃示例和畸形输出
2. report 能稳定保留 agent 的逐条判定结论
3. 后续新增规则、扩展字段或更换模型时，只需要围绕一个协议中心演进
