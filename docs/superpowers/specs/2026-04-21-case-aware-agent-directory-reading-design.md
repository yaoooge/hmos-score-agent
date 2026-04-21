# Case-Aware Agent Directory Reading Design

## Goal

在保持现有 `/chat/completions` 兼容方式和主评分 workflow 基本不变的前提下，为 agent 辅助判定阶段增加“受限只读 case 目录”能力。agent 不再只能依赖一次性塞入 prompt 的截断片段，而是可以在单次评测内按需补读 `effective.patch`、目标文件和关联上下文文件，从而对 case rule 和弱规则做更稳定的辅助判断。

## Current State

- 当前主 workflow 已包含 `ruleAuditNode -> rubricPreparationNode -> agentPromptBuilderNode -> agentAssistedRuleNode -> ruleMergeNode` 的链路。
- 当前 `agentPromptBuilderNode` 将任务理解摘要、rubric 摘要、确定性规则结果和候选规则片段打包成一次性 prompt。
- 当前 `agentAssistedRuleNode` 只会调用一次 `agentClient.evaluateRules()`，模型无法继续补读 case 目录中的文件。
- 当前 `AgentPromptPayload` 中只有 `has_patch` 和项目路径，不包含完整 patch 正文，也不具备任何真实本地文件访问能力。
- 当前 `ruleEngine` 传给 agent 的 `evidence_snippets` 主要来自文件内容前 200 字截断，容易只暴露注释和 import，导致“上下文不足 -> 待人工复核”。
- 当前 `ChatModelClient` 是一个纯文本 `/chat/completions` 调用器，不依赖供应商原生 tool calling 协议。

## Scope

### In Scope

- 为 agent 辅助判定引入“只读 case 目录”的本地工具能力。
- 保持现有主 workflow 节点顺序基本不变，只改造 `agentAssistedRuleNode` 内部实现。
- 保持现有 `result.json`、`case_rule_results`、callback 上传结构不变。
- 保持现有 `/chat/completions` 兼容优先，不要求供应商原生 function/tool calling。
- 在本地落盘 agent 工具调用轨迹、轮次记录和 bootstrap payload，便于调试。

### Out of Scope

- 不将整个评分 workflow 重构成通用对话 agent。
- 不开放任意本地命令执行或仓库根目录读写能力。
- 不让 agent 直接生成最终 `result.json`。
- 不改变 `mergeRuleAuditResults()` 的最终输入输出契约。
- 不引入数据库、缓存服务或外部检索系统。

## Non-Goals

- 不实现开放式多代理或长会话规划。
- 不实现供应商专有 tool-calling 适配。
- 不实现自动代码修复或自动 patch 生成。
- 不实现跨 case 的知识记忆或经验回流。

## Design Principles

### 1. 主 workflow 保持稳定

当前 workflow 已经承担输入准备、规则审计、评分和报告生成职责。本轮只增强 agent 辅助判定的取证能力，不改变主评分链路的责任边界。

### 2. 兼容现有模型接入方式

agent 增强必须继续兼容当前 `ChatModelClient` 对 `/chat/completions` 的纯文本 JSON 输出模式，不要求模型端支持原生工具协议。

### 3. 工具只读且强限制

agent 可读的内容必须严格绑定到当前 `caseRoot`，并受限于轮次、字节数、文件数和文件类型，防止模型变成通用本地文件代理。

### 4. 分阶段读取优先

agent 不从空白开始探索。系统先注入基础上下文，再允许有限工具补查，最后强制收敛。这样能兼顾自主性、稳定性和成本。

### 5. 结果契约不变

agent 最终输出仍然要落回现有 `summary + rule_assessments` 结构，再由本地 `mergeRuleAuditResults()` 合并。增强的是“如何取证”，不是“如何记分”。

### 6. 全链路可回放

必须落盘：

- bootstrap payload
- 每轮模型输入输出
- 工具调用参数与结果
- 最终结构化判定

这样后续才能分析 agent 为什么得出某个结论，或为什么仍然需要人工复核。

## Why Not Directly Use LangGraph Prebuilt Agents

LangGraph 当前确实提供了 `ToolNode`、`toolsCondition` 以及基于工具循环的 agent 构建能力，但不建议直接将当前辅助判定改造成预置 agent 风格，原因如下：

1. 当前模型接入不是 LangChain chat model + 原生 tool call 协议，而是自定义的 `/chat/completions` 文本 JSON 调用。
2. 当前主 workflow 是强约束业务流程，agent 只是一个辅助节点，不应变成整个评分流程的主控制器。
3. 当前结果合并层依赖严格的现有 JSON 契约，直接替换为预置 agent 会引入大量不必要的消息协议和兼容适配。
4. 当前最重要的问题不是“如何搭一个通用工具 agent”，而是“如何让受限 case 目录补读能力稳定接入现有评分链路”。

因此，本轮采用混合方案：

- 保留现有主 workflow
- 保留现有 `ChatModelClient`
- 在 `agentAssistedRuleNode` 内部引入一个小型 case-aware 子图或等价 runner
- 仅借用 LangGraph 进行工具循环和节点路由

## Architecture

### High-Level Flow

外层主 workflow 保持如下：

```text
remoteTaskPreparationNode
-> taskUnderstandingNode
-> inputClassificationNode
-> featureExtractionNode
-> ruleAuditNode
-> rubricPreparationNode
-> agentPromptBuilderNode
-> agentAssistedRuleNode
-> ruleMergeNode
-> scoringOrchestrationNode
-> reportGenerationNode
-> artifactPostProcessNode
-> persistAndUploadNode
```

其中 `agentAssistedRuleNode` 内部新增一个“小型 case-aware agent runner”，负责多轮补读和最终结构化判定。

### Runner Composition

运行时拆为两层：

#### Outer Layer: Existing Workflow

负责：

- 组织候选规则
- 生成 bootstrap payload
- 调用 case-aware runner
- 接收最终 agent JSON
- 写回现有状态字段

#### Inner Layer: Case-Aware Runner

负责：

- 生成第一轮 agent 指令
- 执行有限轮次工具调用
- 维护读取预算
- 最终产出结构化辅助判定

### LangGraph Usage

LangGraph 仅用于内部工具循环编排：

- `planner` 节点：调用现有 `ChatModelClient`
- `tool_executor` 节点：执行本地只读工具
- `should_continue` 路由：决定继续补读还是收敛
- `forced_finalize` 节点：非法输出、预算耗尽时强制进入最终判定

不将整个评分主流程重写为消息型 agent graph。

## Tool Surface

agent 可用工具固定为 6 个，全部绑定到当前 `caseRoot`。

### 1. `read_patch`

用途：读取 `effective.patch` 或指定条件下的 patch 片段。

支持参数：

- `path_glob?`
- `max_hunks?`
- `max_chars?`

### 2. `list_dir`

用途：列出 case 目录内某个相对路径下的目录项。

返回字段：

- `name`
- `relative_path`
- `kind`

### 3. `read_file`

用途：读取单个文件全文。

限制：

- 单文件默认最大 `12000` 字符
- 超出时截断并显式标记 `truncated=true`

### 4. `read_file_chunk`

用途：读取文件局部上下文。

支持参数：

- `path`
- `start_line?`
- `end_line?`
- `around_keyword?`
- `context_lines?`

### 5. `grep_in_files`

用途：在 case 目录内按 glob 搜关键字。

支持参数：

- `pattern`
- `path_glob?`
- `max_results?`

返回字段：

- `path`
- `line`
- `snippet`

### 6. `read_json`

用途：读取并解析 JSON / JSON5 风格配置文件。

支持文件：

- `*.json`
- `*.json5`

返回字段：

- `raw_text`
- `parsed`
- `parse_error?`

## Safety Boundaries

### Path Constraints

- 所有工具入参只接受相对 `caseRoot` 路径
- 调用前统一做 `normalize`
- 禁止绝对路径
- 禁止 `..`
- 禁止符号链接逃逸
- 最终通过 `realpath` 确认目标仍位于 `caseRoot` 内

### Read Constraints

- 一次辅助判定最多 6 轮工具调用
- 最多读取 20 个文件
- 累计最多返回 60KB 文本
- 超预算时返回受控错误，不中断整个 workflow

### File-Type Constraints

默认允许：

- `*.ets`
- `*.ts`
- `*.json`
- `*.json5`
- `*.yaml`
- `*.yml`
- `*.md`

默认拒绝：

- 图片
- 压缩包
- 二进制
- 构建产物
- 缓存目录
- `node_modules`

### Tool Failure Policy

工具错误统一返回结构化失败结果，不抛出全局 workflow 异常。

## Phase-Based Reading Strategy

### Phase A: Bootstrap

系统自动注入基础上下文：

- 任务描述摘要
- `constraintSummary`
- `rubricSnapshot`
- 候选规则列表
- 初始目标文件列表
- `effective.patch` 摘要或关键 hunk

目标：避免 agent 从空白上下文开始无效探索。

### Phase B: Guided Expansion

agent 可有限补读：

- `effective.patch`
- case rule 命中的目标文件
- 与目标文件同层或相邻的 `viewmodel/component/util/model`
- `grep` 命中的关联文件

### Phase C: Finalization

以下任一情况发生时必须收敛：

- 模型主动返回 `final_answer`
- 工具预算耗尽
- 出现连续非法工具调用
- 出现连续非法 JSON 输出

## Subgraph Runtime Protocol

### Node Layout

子图包含以下节点：

1. `bootstrap`
2. `planner`
3. `tool_executor`
4. `should_continue`
5. `forced_finalize`

### Bootstrap Node

输入：

- `caseId`
- `caseRoot`
- `taskType`
- `constraintSummary`
- `rubricSnapshot`
- `assistedRuleCandidates`
- `effectivePatchPath`

输出：

- 初始 `conversation`
- `toolBudget`
- `readBudget`
- `selectedCandidates`

### Planner Node

职责：调用现有模型，并要求它只返回两类 JSON 之一。

#### Tool Call Shape

```json
{
  "action": "tool_call",
  "tool": "read_file",
  "args": {
    "path": "entry/src/main/ets/home/viewmodels/HomePageVM.ets"
  },
  "reason": "需要确认首页 ViewModel 是否实际驱动本地资讯与权限状态"
}
```

#### Final Answer Shape

```json
{
  "action": "final_answer",
  "summary": {
    "assistant_scope": "本次仅辅助候选规则判定",
    "overall_confidence": "medium"
  },
  "rule_assessments": [
    {
      "rule_id": "HM-REQ-010-03",
      "decision": "uncertain",
      "confidence": "low",
      "reason": "虽然已读取 LocalNewsHeader 和 HomePageVM，但尚未确认定位结果是否实际驱动首页内容更新。",
      "evidence_used": [
        "entry/src/main/ets/home/components/LocalNewsHeader.ets",
        "entry/src/main/ets/home/viewmodels/HomePageVM.ets"
      ],
      "needs_human_review": true
    }
  ]
}
```

### Tool Executor Node

职责：

- 校验工具名
- 校验路径范围
- 扣减预算
- 返回结构化结果

成功结果示例：

```json
{
  "tool": "read_file",
  "ok": true,
  "result": {
    "path": "entry/src/main/ets/home/viewmodels/HomePageVM.ets",
    "truncated": false,
    "content": "..."
  }
}
```

失败结果示例：

```json
{
  "tool": "read_file",
  "ok": false,
  "error": {
    "code": "tool_budget_exceeded",
    "message": "本次辅助判定已达到最大读取预算"
  }
}
```

### Continue Routing

路由规则：

- `final_answer` -> 结束子图
- 合法 `tool_call` 且预算未超 -> `tool_executor`
- 非法工具 / 非法 JSON / 连续失败 -> `forced_finalize`

### Forced Finalize Node

职责：

- 进行最后一轮只允许 `final_answer` 的收敛尝试
- 如仍失败，则本地直接回退为人工复核结果

## Data Contracts

### Bootstrap Payload

bootstrap payload 包含：

- `case_context`
- `task_understanding`
- `assisted_rule_candidates`
- `tool_contract`
- `budget_contract`
- `response_contract`

不再要求把大段代码全文一次性塞入 bootstrap payload。

### Final Merge Contract

最终产出的 `summary + rule_assessments` 必须继续兼容现有 `mergeRuleAuditResults()` 使用的结构。

这样可以保证：

- `ruleMergeNode` 不需要整体重写
- `result.json` schema 不需要改
- 现有 callback 结构不需要改

## File Mapping

### Keep As-Is

以下文件保持主职责不变：

- `src/workflow/scoreWorkflow.ts`
- `src/nodes/ruleAuditNode.ts`
- `src/nodes/rubricPreparationNode.ts`
- `src/nodes/ruleMergeNode.ts`
- `src/nodes/scoringOrchestrationNode.ts`
- `src/nodes/reportGenerationNode.ts`

### Add

#### `src/agent/caseTools.ts`

职责：提供只读工具实现和预算控制。

#### `src/agent/caseToolSchemas.ts`

职责：集中定义工具参数和返回结构 schema。

#### `src/agent/caseAwarePrompt.ts`

职责：生成 bootstrap prompt 和工具回合 prompt。

#### `src/agent/caseAwareAgentRunner.ts`

职责：驱动整个 case-aware agent 运行过程。

#### `src/agent/caseAwareAgentGraph.ts`

职责：封装 LangGraph 子图定义。

如果最终发现单文件实现更稳，该文件可合并回 `caseAwareAgentRunner.ts`，但逻辑边界仍按子图组织。

### Modify

#### `src/agent/agentClient.ts`

调整方向：

- 保留 `ChatModelClient`
- 提供底层 `completeJsonPrompt(prompt: string)` 风格能力
- `understandTask()` 继续复用底层文本 JSON 调用
- `caseAwareAgentRunner` 也复用同一底层能力

不要求 `ChatModelClient` 自身变成原生工具模型。

#### `src/nodes/agentPromptBuilderNode.ts`

调整方向：

- 当前 `agentPromptText` 从“最终完整判定 prompt”转为“bootstrap 文本”
- `agentPromptPayload` 从“一次性大上下文”转为“初始上下文 + 工具协议”

#### `src/nodes/agentAssistedRuleNode.ts`

调整方向：

- 从直接调用 `agentClient.evaluateRules()` 改为调用 `CaseAwareAgentRunner.run()`
- 返回值仍然写回：
  - `agentRunStatus`
  - `agentRawOutputText`

#### `src/nodes/persistAndUploadNode.ts`

新增落盘产物：

- `inputs/agent-bootstrap-payload.json`
- `intermediate/agent-tool-trace.json`
- `intermediate/agent-turns.json`

#### `src/types.ts`

新增类型：

- `CaseToolName`
- `CaseToolCall`
- `CaseToolResult`
- `CaseAwareAgentTurn`
- `CaseAwareAgentState`
- `CaseAwareAgentFinalAnswer`

## Observability and Logging

本轮 agent 交互必须同时产出两类日志：

1. 面向人阅读的 `logs/run.log`
2. 面向回放和调试的结构化轨迹文件

两者都需要，但职责不同：

- `run.log` 用于快速看链路走到了哪里、为什么停下
- 结构化轨迹用于复现 agent 每一轮到底读了什么、为什么做出最终判断

### Runtime Log Goals

必须能快速回答以下问题：

1. 这轮 agent 判定有没有进入 case-aware runner
2. agent 一共跑了几轮
3. 每轮是继续读文件还是已经收敛
4. 读了哪些工具、哪些文件、是否命中预算上限
5. 为什么进入 `forced_finalize`
6. 最终哪些规则被判为人工复核，原因是什么

### Required `run.log` Events

建议新增以下日志事件，全部沿用现有中文风格。

#### 1. Runner 启动

示例：

```text
[INFO] case-aware agent 判定开始 candidates=4 caseId=remote-task-3 hasPatch=true
```

#### 2. Bootstrap 完成

示例：

```text
[INFO] case-aware bootstrap 完成 targetFiles=14 initialPatch=true toolBudget=6 byteBudget=61440
```

#### 3. Planner 轮次开始

示例：

```text
[INFO] case-aware planner 开始 turn=1 remainingTools=6 remainingBytes=61440
```

#### 4. Planner 决策

若返回工具调用：

```text
[INFO] case-aware planner 决策 turn=1 action=tool_call tool=read_file reason=需要确认首页 ViewModel 是否驱动本地资讯状态
```

若返回最终答案：

```text
[INFO] case-aware planner 决策 turn=3 action=final_answer confidence=medium
```

#### 5. 工具执行开始

示例：

```text
[INFO] case-aware 工具执行开始 turn=1 tool=read_file path=entry/src/main/ets/home/viewmodels/HomePageVM.ets
```

#### 6. 工具执行结果

成功：

```text
[INFO] case-aware 工具执行完成 turn=1 tool=read_file bytes=8421 truncated=false
```

失败：

```text
[WARN] case-aware 工具执行失败 turn=2 tool=read_file code=path_out_of_scope
```

#### 7. 预算状态变化

示例：

```text
[INFO] case-aware 预算更新 turn=2 usedTools=2 usedBytes=16384 remainingTools=4 remainingBytes=45056
```

#### 8. 强制收敛

示例：

```text
[WARN] case-aware 强制收敛 reason=tool_budget_exceeded
```

或：

```text
[WARN] case-aware 强制收敛 reason=invalid_model_output retryExhausted=true
```

#### 9. 最终判定摘要

示例：

```text
[INFO] case-aware 判定完成 turns=3 reviewedRules=4 humanReview=2 status=success
```

### Structured Trace Files

除 `run.log` 外，还必须落盘以下结构化产物。

#### `intermediate/agent-turns.json`

用途：记录每一轮模型交互概览。

每轮至少包含：

- `turn`
- `action`
- `tool?`
- `reason`
- `remaining_tool_budget`
- `remaining_byte_budget`
- `status`
- `final_answer_summary?`

#### `intermediate/agent-tool-trace.json`

用途：记录工具调用明细，便于复盘。

每条至少包含：

- `turn`
- `tool`
- `args`
- `ok`
- `error_code?`
- `paths_read`
- `bytes_returned`
- `truncated`
- `budget_after_call`

#### `intermediate/agent-assisted-rule-result.json`

当前文件已存在，后续继续保留，但需要补充：

- `runner_mode: "case_aware"`
- `turn_count`
- `tool_call_count`
- `forced_finalize_reason?`

### Logging Granularity Rules

为避免 `run.log` 噪音失控，日志粒度按下面规则控制：

- 不在 `run.log` 中打印完整文件内容
- 不在 `run.log` 中打印完整 patch 文本
- 文件路径允许打印
- 工具参数允许打印摘要，不打印大段正文
- 大段返回内容只进入结构化 trace 文件

### Failure Visibility

任何导致 agent 收敛失败的原因，都必须同时出现在：

- `run.log`
- `agent-tool-trace.json` 或 `agent-turns.json`
- `intermediate/agent-assisted-rule-result.json`

这样用户在只看 `run.log` 时能知道失败原因，在深入排查时又能看到结构化证据。

## Error Handling

### 1. Invalid Model Output

场景：

- 非 JSON
- 缺字段
- `action` 非法
- `tool` 不存在

处理：

- 记录 `invalid_output`
- 给一次纠正重试
- 若仍失败，进入 `forced_finalize`
- 无法稳定判断的规则统一转人工复核

### 2. Invalid Tool Call

场景：

- 越界路径
- 参数缺失
- 黑名单文件
- 行号非法

处理：

- 工具层返回受控错误
- 不直接中断主 workflow
- 连续两次非法调用后强制收敛

### 3. Budget Exhaustion

场景：

- 超轮次
- 超字节数
- 超文件数

处理：

- 返回 `tool_budget_exceeded`
- 不再允许继续探索
- 强制输出最终判断或进入人工复核

### 4. Local File Read Failure

场景：

- 文件不存在
- 编码异常
- JSON5 解析失败

处理：

- 返回工具级失败结果
- 原始错误写入 trace
- agent 可选择改读其他文件或结束

## Verification Strategy

### Unit Tests

必须覆盖：

- 路径越界被拒绝
- 6 个工具的成功和失败结果结构
- 超预算后的受控错误
- 非法 JSON 输出进入回退
- `final_answer` 可被现有 merge 层正确消费

### Integration Tests

必须覆盖：

- `agentAssistedRuleNode` 内发生多轮工具补读
- `persistAndUploadNode` 能写出工具 trace 和轮次记录
- `run.log` 中包含 case-aware runner 的关键生命周期日志
- `result.json` schema 不变
- callback 链路不受影响

### Real Replay Validation

使用当前真实远端定位资讯任务回放，重点检查：

- 是否读取了 `effective.patch`
- 是否读取了 `LocalNewsHeader.ets`
- 是否读取了 `HomePageVM.ets`
- 是否读取了 `PermissionUtil.ets`
- 是否读取了 `LocationUtil.ets`

## Acceptance Criteria

满足以下 6 条才算完成：

1. agent 能在 case 目录内执行只读补查，而不是只依赖一次性 prompt。
2. agent 至少能读取 `effective.patch` 和一个候选目标文件。
3. 真实回放中，agent 的证据不再仅来自文件头 200 字截断片段。
4. `result.json`、`case_rule_results`、callback 结构保持不变。
5. 工具越界、预算耗尽、非法 JSON 不会导致整个 workflow 失败。
6. 对当前远端定位资讯用例，至少有一条原本因上下文不足而人工复核的规则，能够获得更高置信度判断，或至少在 trace 和 `run.log` 中证明 agent 已读取足够上下文后再决定人工复核。

## Open Decisions Resolved

本设计已明确以下选择：

- 兼容优先：保持现有 `/chat/completions` 兼容，不依赖供应商原生 tool calling
- 读取策略：采用“系统 bootstrap + 有限自主补读 + 强制收敛”的分阶段模式
- 工具范围：只读、caseRoot 受限、专用工具面，不开放任意文件系统代理
- 图层策略：主 workflow 不重写，agent 内部使用小型子图或等价 runner

## Implementation Summary

本轮不是重做评分系统，而是在现有 agent 辅助判定节点内部增加一个“可补读 case 目录”的受限工具循环层。该层以当前 `ChatModelClient` 为底座，以受限只读工具为能力边界，以现有 `mergeRuleAuditResults()` 为结果并口，从而在最小改动下显著提升 agent 的上下文获取能力和 case rule 判定稳定性。
