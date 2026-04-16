# LangGraph `streamMode` 节点级流式观测设计

## 1. 背景

当前工程已经具备完整的评分工作流，运行时会在控制台和 `logs/run.log` 中输出一些关键阶段日志，例如：

- 启动评分流程
- `rubric` 加载完成
- `agent prompt` 组装完成
- `agent` 调用开始/完成
- 工作流执行完成

但这些日志仍然偏“流程大阶段”，缺少对工作流内部节点执行过程的连续观测，导致在以下场景中排障效率较低：

1. 不能快速判断当前卡在哪个工作流节点。
2. 看不到各节点的执行结果摘要，只能看到最终结果或少数阶段性日志。
3. 节点名只存在于代码中，用户在控制台中无法直接看到可读的中文流程说明。

经过需求澄清，本轮真正需要的不是“模型响应体内部 chunk 级流式输出”，而是：

- 基于 `LangGraph` 工作流节点边界输出实时日志
- 使用 `LangGraph` 自身的 `streamMode` 能力获取节点事件
- 能看到每个节点的开始、完成、失败
- 节点完成时输出摘要版结果
- 节点名称要带中文描述，便于阅读

## 2. 目标

本轮设计目标如下：

1. 在工作流执行期间，实时输出节点级日志到控制台。
2. 将相同节点级日志同步落盘到当前 case 的 `logs/run.log`。
3. 基于 `LangGraph` 的 `streamMode: ["updates", "custom"]` 实现节点级流式观测。
4. 对每个工作流节点输出：
   - 开始
   - 完成
   - 失败
5. 节点完成时输出摘要版结果，而不是完整状态。
6. 每个节点日志都同时包含：
   - 英文 `node id`
   - 中文节点描述
7. 保持现有评分结果、工作流节点职责和 `CaseLogger` 的基本用法不被破坏。
8. 结构上拆分“节点中文名”“节点摘要”“流事件解释器”，避免把所有逻辑堆在 `scoreWorkflow.ts` 中。

## 3. 非目标

本轮明确不做以下事项：

- 不把 Agent 响应体内部 token/chunk 作为主流式输出对象
- 不提供 HTTP/SSE/WebSocket 对外实时订阅接口
- 不把节点完整 state 输出到控制台或日志
- 不把中间态写入 `result.json` 或 HTML 报告
- 不改变评分工作流的节点顺序
- 不用自定义 wrapper 作为主观测机制

## 4. 设计原则

### 4.1 节点级观测优先

本轮可观测性的主边界是“节点”，而不是“模型响应体”或“最终产物”。用户最关心的是工作流执行到了哪一步，以及该步产出了什么摘要结果。

### 4.2 `streamMode` 原生能力优先

节点流式观测的主实现必须建立在 `LangGraph` 自身的流式执行能力之上，而不是通过外部包装器模拟。这样可以保证观测机制与图执行生命周期对齐，并减少重复埋点。

### 4.3 摘要优先，不输出完整状态

日志应服务于阅读和排障，因此每个节点只输出 2 到 5 个关键指标。完整状态中包含大量长文本、证据片段、prompt 和报告内容，不适合直接流到控制台或 `run.log`。

### 4.4 英文 `node id` 与中文描述并存

中文描述用于提高可读性，英文 `node id` 用于排障和代码定位。两者必须同时出现在日志中，不能只保留一种。

### 4.5 `updates` 与 `custom` 分工明确

- `updates` 负责节点完成后的结果流
- `custom` 负责节点开始、节点失败等自定义事件

两者组合后，才能完整覆盖“开始 / 完成 / 失败”三类节点观测诉求。

## 5. 方案比较

### 方案 A：继续沿用现有阶段日志

做法：

- 只在 workflow 外层补更多“开始/完成”日志
- 不细化到单个节点

优点：

- 实现最简单
- 改动最小

缺点：

- 仍然无法回答“当前卡在哪个节点”
- 无法满足“节点流和节点结果摘要”的核心诉求

### 方案 B：只使用 `streamMode: "updates"`

做法：

- 仅订阅节点完成后的 state updates
- 根据 update 输出节点完成摘要

优点：

- 直接使用 LangGraph 原生能力
- 能拿到节点完成后的结果流

缺点：

- 无法原生拿到“节点开始”
- 失败场景信息不完整
- 不能完整覆盖节点生命周期

### 方案 C：使用 `streamMode: ["updates", "custom"]`

做法：

- 通过 `updates` 获取节点完成后的结果流
- 通过 `custom` 获取节点开始、节点失败等自定义事件
- 两类流统一解释后输出中文日志

优点：

- 完整覆盖“开始 / 完成 / 失败”
- 严格建立在 LangGraph 原生流式能力之上
- 结果摘要和事件语义边界清晰
- 易于测试与扩展

缺点：

- 需要在节点内部补充少量 `custom` 事件发射逻辑

本轮采用方案 C。

## 6. 总体方案

本轮采用“`LangGraph streamMode: ["updates", "custom"]` + 节点摘要函数 + 统一日志输出”的组合方案。

### 6.1 高层流程

1. `scoreWorkflow.ts` 继续创建并编译 `StateGraph`。
2. workflow 执行时，不再只使用 `invoke()`，而是通过 `graph.stream()` 或等价的流式执行方式读取图事件。
3. 订阅 `streamMode: ["updates", "custom"]`：
   - `updates` 提供节点完成后的 state update
   - `custom` 提供节点开始、节点失败等自定义事件
4. 流事件统一交给 workflow 观测层解释：
   - 节点中文名映射
   - 节点摘要生成
   - 中文日志输出
5. 所有节点日志统一写入：
   - 控制台
   - `logs/run.log`
6. 流结束后，仍返回最终 `resultJson`，保持外部调用方式不变。

### 6.2 输出目标

本轮仅输出到：

- 控制台标准输出
- 当前 case 目录下的 `logs/run.log`

不新增第二套日志文件。

## 7. `streamMode` 使用设计

### 7.1 `updates`

`updates` 用于接收每个节点完成后的结果更新。

在当前需求中，`updates` 负责：

- 标识哪个节点已经完成
- 提供该节点的返回 patch 或 update 数据
- 作为节点结果摘要的输入

本轮不直接把 `updates` 的原始对象写入日志，而是先通过摘要函数转换为可读文本。

### 7.2 `custom`

`custom` 用于补充 `updates` 不能自然表达的节点事件。

在当前需求中，`custom` 负责：

- `node_started`
- `node_failed`

这些事件由节点在执行过程中通过 `LangGraph` 提供的自定义写入能力发出，供上层统一消费。

### 7.3 为什么不用 `values`

`values` 会流出完整 state。对于当前需求来说：

- 数据量过大
- 包含大量不适合直接打印的长文本
- 不符合“摘要版结果”的目标

因此本轮不采用 `streamMode: "values"` 作为主方案。

### 7.4 为什么不用 `debug`

`debug` 会输出大量底层执行信息，更适合框架级调试，不适合作为用户可读的节点流日志主通道。因此本轮不采用 `debug` 作为主方案。

## 8. 代码结构设计

为了避免把所有观测逻辑塞进 `scoreWorkflow.ts`，建议新增 `workflow/observability/` 目录。

### 8.1 `src/workflow/observability/types.ts`

职责：

- 定义内部节点观测事件类型
- 定义节点摘要函数与流事件解释器的类型签名

### 8.2 `src/workflow/observability/nodeLabels.ts`

职责：

- 维护 `node id -> 中文描述` 映射

要求：

- 所有进入日志流的节点都必须在此声明中文描述

### 8.3 `src/workflow/observability/nodeSummaries.ts`

职责：

- 为每个节点提供稳定的摘要生成函数
- 输入为 `updates` 流中对应节点的 update 数据
- 输出为摘要字符串

### 8.4 `src/workflow/observability/workflowStreamInterpreter.ts`

职责：

- 解释 `updates` 与 `custom` 两类流事件
- 将原始流事件转换为统一的内部节点观测事件

### 8.5 `src/workflow/observability/workflowEventLogger.ts`

职责：

- 把内部节点观测事件翻译成中文日志
- 复用 `CaseLogger`

### 8.6 现有文件改造点

需要改造但不增加业务职责的文件：

- `src/workflow/scoreWorkflow.ts`
- `src/io/caseLogger.ts`
- 各个需要发出 `custom` 事件的节点文件

其中：

- `scoreWorkflow.ts` 负责发起 `streamMode: ["updates", "custom"]` 的图执行
- `CaseLogger` 继续只负责输出到控制台和 `run.log`
- 节点文件仅在必要时发出 `custom` 事件，不承担日志拼接职责

## 9. 节点中文描述设计

日志中的节点信息统一包含：

- `node=<英文 node id>`
- `label=<中文描述>`

建议固定如下映射：

- `taskUnderstandingNode` -> `任务理解`
- `inputClassificationNode` -> `任务分类`
- `featureExtractionNode` -> `特征提取`
- `ruleAuditNode` -> `规则审计`
- `rubricPreparationNode` -> `评分基线准备`
- `agentPromptBuilderNode` -> `Agent 提示组装`
- `agentAssistedRuleNode` -> `Agent 辅助判定`
- `ruleMergeNode` -> `规则结果合并`
- `scoringOrchestrationNode` -> `评分编排`
- `reportGenerationNode` -> `报告生成`
- `persistAndUploadNode` -> `结果落盘与上传`

约束：

- 新增节点时必须同步补充中文描述
- 不允许出现部分节点有中文、部分节点只有英文的状态

## 10. 节点摘要设计

### 10.1 摘要原则

每个节点摘要必须满足：

- 稳定：字段不依赖临时实现细节
- 精简：只输出 2 到 5 个关键指标
- 可排障：看到摘要能快速判断该节点结果是否异常

### 10.2 节点摘要规则

建议按以下方式固定：

- `任务理解`
  - `explicit=<n> contextual=<n> implicit=<n> classificationHints=<n>`

- `任务分类`
  - `taskType=<value>`

- `特征提取`
  - `basic=<n> structural=<n> semantic=<n> change=<n>`

- `规则审计`
  - `rules=<n> violations=<n> uncertain=<n>`

- `评分基线准备`
  - `dimensions=<n> hardGates=<n> reviewRules=<n>`

- `Agent 提示组装`
  - `deterministic=<n> candidates=<n> promptLength=<n>`

- `Agent 辅助判定`
  - `status=<value> outputLength=<n>`

- `规则结果合并`
  - `merged=<n> reviewRequired=<n>`

- `评分编排`
  - `totalScore=<n> hardGate=<true|false> risks=<n> reviewItems=<n>`

- `报告生成`
  - `resultReady=true htmlLength=<n>`

- `结果落盘与上传`
  - `upload=<success|skipped|failed>`

### 10.3 明确不输出的内容

以下内容不应直接写入节点摘要：

- 完整 `prompt`
- 完整 `agentRawOutputText`
- 证据片段全文
- HTML 报告全文
- `result.json` 全量内容
- 节点完整 state

## 11. 自定义事件设计

### 11.1 事件类型

本轮 `custom` 事件至少包括：

- `node_started`
- `node_failed`

### 11.2 事件字段

建议统一包含：

- `nodeId`
- `errorMessage`（仅失败事件）

必要时可以补充少量诊断字段，但不应把大段业务内容塞进 `custom` 事件。

### 11.3 事件发射原则

- 节点开始时立即发出 `node_started`
- 节点捕获到错误后发出 `node_failed`
- 节点完成事件不通过 `custom` 发出，而是交给 `updates` 承担

这样可以避免事件职责重复。

## 12. 日志格式设计

### 12.1 基本格式

沿用现有 `CaseLogger` 的单行文本格式：

```text
[2026-04-16T12:34:56.789Z] [INFO] 节点开始 node=taskUnderstandingNode label=任务理解
[2026-04-16T12:34:56.910Z] [INFO] 节点完成 node=taskUnderstandingNode label=任务理解 summary=explicit=2 contextual=1 implicit=3 classificationHints=1
[2026-04-16T12:34:57.050Z] [INFO] 节点完成 node=inputClassificationNode label=任务分类 summary=taskType=bug_fix
[2026-04-16T12:34:57.820Z] [ERROR] 节点失败 node=agentAssistedRuleNode label=Agent 辅助判定 error=Agent 调用失败，HTTP 400
```

### 12.2 日志要求

- `节点开始` 不带摘要
- `节点完成` 必带摘要
- `节点失败` 必带错误信息
- 所有节点日志必须同时带 `node` 和 `label`
- 摘要统一放在 `summary=` 字段中

## 13. 与现有工作流的集成

### 13.1 `scoreWorkflow.ts`

职责调整为：

- 创建 `CaseLogger`
- 创建 `workflowEventLogger`
- 通过 `graph.stream(..., { streamMode: ["updates", "custom"] })` 执行 workflow
- 消费流事件并转发给 `workflowStreamInterpreter`
- 在流结束后返回最终结果

### 13.2 各业务节点

各节点文件继续只负责：

- 接收状态
- 产出状态 patch

新增的唯一观测职责是：

- 在节点开始时发出 `node_started`
- 在节点失败时发出 `node_failed`

不在节点内部直接拼接日志文本。

### 13.3 `CaseLogger`

继续保持现有职责：

- 输出到控制台
- 写入 `logs/run.log`

不把节点摘要逻辑塞进 `CaseLogger`。

## 14. 测试策略

本轮测试按四层展开。

### 14.1 节点摘要单测

新增建议测试文件：

- `tests/workflow-node-summary.test.ts`

覆盖：

- 每个节点摘要函数输出稳定
- 关键节点摘要字段符合设计要求

### 14.2 流解释器单测

新增建议测试文件：

- `tests/workflow-stream-interpreter.test.ts`

覆盖：

- `updates` 事件能被正确解释为“节点完成”
- `custom` 的 `node_started` 能被正确解释为“节点开始”
- `custom` 的 `node_failed` 能被正确解释为“节点失败”

### 14.3 日志器单测

新增建议测试文件：

- `tests/workflow-event-logger.test.ts`

覆盖：

- 节点开始日志格式正确
- 节点完成日志格式正确
- 节点失败日志格式正确
- 日志包含 `node`、`label`、`summary`

### 14.4 工作流集成测试

扩展：

- `tests/score-agent.test.ts`

覆盖：

- `run.log` 中包含节点开始/完成日志
- 至少覆盖以下节点：
  - `任务理解`
  - `任务分类`
  - `规则审计`
  - `评分编排`
  - `结果落盘与上传`
- 若可稳定构造失败分支，则补充节点失败日志测试

## 15. 实施顺序

建议按以下顺序落地：

1. 先写节点摘要函数测试
2. 再写流解释器测试
3. 再写日志器测试
4. 实现 `workflow/observability/` 目录
5. 在各节点中补充 `custom` 事件发射
6. 在 `scoreWorkflow.ts` 中接入 `streamMode: ["updates", "custom"]`
7. 扩展集成测试验证 `run.log`
8. 运行 `npm test` 和 `npm run build`

## 16. 风险与约束

### 16.1 `custom` 事件覆盖不全会造成节点生命周期缺口

如果某些节点未正确发出 `node_started` 或 `node_failed`，日志会缺失对应生命周期信息。因此所有节点接入时必须统一遵守事件发射规范。

### 16.2 摘要字段过多会污染日志

如果节点摘要塞入过多字段，会破坏可读性。因此摘要字段必须严格控制在设计范围内，不能把“方便调试”的长文本直接塞进日志。

### 16.3 节点返回结构变化可能影响摘要稳定性

摘要函数依赖 `updates` 中节点结果的稳定结构，因此应尽量基于已有稳定字段，而不是依赖临时中间变量。

### 16.4 中英文命名映射必须维护一致

如果新增节点时忘记补中文描述，日志可读性会立刻下降。因此 `nodeLabels.ts` 必须成为接入新节点时的必改文件。

## 17. 推荐结论

本轮采用以下设计作为落地基线：

- 以 `LangGraph streamMode: ["updates", "custom"]` 作为节点流式观测主机制
- 使用 `updates` 产出节点完成后的结果摘要
- 使用 `custom` 产出节点开始与节点失败事件
- 每个节点日志同时包含英文 `node id` 与中文描述
- 节点完成时输出摘要版结果，不输出完整状态
- 代码结构拆分为 `nodeLabels`、`nodeSummaries`、`workflowStreamInterpreter`、`workflowEventLogger`
- 所有日志统一复用 `CaseLogger` 输出到控制台和 `logs/run.log`

这套方案能够直接满足“看节点流和节点结果摘要”的需求，并且严格建立在 `LangGraph` 原生流式能力之上。
