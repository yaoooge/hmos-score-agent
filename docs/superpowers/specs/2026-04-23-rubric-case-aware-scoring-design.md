# Rubric Case-Aware 评分设计

## 背景

当前评分流程已经把 rubric 分支和 rule 分支并行拆开，但两条分支的 agent 构造方式不同。

rule agent 已经是 case-aware 模式：先收到精简的 bootstrap payload，再在受限预算内通过 `read_patch`、`read_file`、`grep_in_files` 等只读工具补查上下文，最后输出结构化判定。

rubric agent 仍是一次性 JSON prompt 模式：`rubricScoringPromptBuilderNode` 会把 `case_context`、`task_understanding`、完整 `rubric_summary` 和输出协议一起序列化成单个长 prompt，`rubricScoringAgentNode` 再用 `completeJsonPrompt()` 发起一次模型请求。该模式有三个问题：

- prompt 容易超过 25k 字符，远端模型可能长时间卡住或连接被关闭。
- `case_context` 中的 `original_project_path`、`generated_project_path`、`effective_patch_path` 只是路径字符串，rubric agent 不能真正读取文件或 patch 内容。
- agent 被要求给出逐项分数，但缺少可验证代码证据，容易在无充分负面证据时产生不稳定扣分。

本设计目标是参考 rule agent 的构造，把 rubric agent 改造成受限 case-aware 工具读取模式，避免一次性长上下文，并强化“默认满分、证据驱动扣分”的稳定性原则。

## 目标

- 将 rubric agent 从一次性长 prompt 调用改为 case-aware 多轮工具模式。
- 首轮 prompt 只包含最小评分上下文、rubric item 摘要、初始目标文件和工具协议。
- agent 需要代码证据时，通过只读工具按需读取 patch、目录和文件片段。
- 扣分前必须读取到明确负面证据；证据不足时保持满分。
- 最终仍输出现有 `RubricScoringResult` 结构，尽量不改 score fusion、报告和 callback 的下游契约。
- runner 失败、协议失败或预算耗尽时不阻塞主流程，继续按现有“满分待复核”语义降级。
- 降低 rubric agent 单次请求上下文长度，避免长时间卡顿。

## 非目标

- 不把 rubric 评分完全改造成确定性规则引擎。
- 不改变 rule agent 的现有 case-aware 协议和合并逻辑。
- 不开放任意本地命令执行或仓库根目录访问能力。
- 不让 rubric agent 直接生成最终 `result.json` 或 HTML 报告。
- 不引入供应商专用 tool calling 协议，继续使用当前文本 JSON 协议。
- 不要求满分项输出长解释，只对扣分项强制完整证据链。

## 设计原则

### 1. Prompt 瘦身

rubric agent 首轮 prompt 不再携带完整工程内容，也不携带大段 patch 正文。首轮只说明任务、rubric、可用工具、输出协议和初始目标文件。

### 2. 工具取证优先

扣分必须建立在工具读取到的代码证据上。模型不能只根据路径名、任务描述或主观猜测降档。

### 3. 默认满分

每个 rubric item 的默认结论是该 item 最高分 band。只有负面证据完整时才能降档。

### 4. 失败不阻塞

rubric agent 是增强评分稳定性的辅助能力，不应成为主流程的单点卡死点。失败时继续走 `rubricAgentRunStatus=invalid_output` 或 `failed`，由 `scoreFusion` 兜底为满分待复核。

### 5. 下游契约保持稳定

最终可消费结果仍是 `RubricScoringResult`。`scoreFusionOrchestrationNode`、`scoreFusion.ts`、`reportGenerationNode` 尽量只消费同一个结构，不感知 rubric agent 是单轮还是多轮。

### 6. 能复用就直接复用

只要 rule agent 现有模块已经满足 rubric agent 的通用能力需求，就直接复用，不再复制一份同构实现。只有当协议结构与业务语义确实不同，才新增 rubric 专用薄封装或 schema。

## 当前链路

当前 rubric 分支如下：

```text
rubricPreparationNode
  -> rubricScoringPromptBuilderNode
  -> rubricScoringAgentNode
  -> scoreFusionOrchestrationNode
```

当前关键实现：

- `src/agent/rubricScoring.ts` 构建 `RubricScoringPayload` 并渲染长 prompt。
- `src/nodes/rubricScoringPromptBuilderNode.ts` 只负责生成 `rubricScoringPayload` 和 `rubricScoringPromptText`。
- `src/nodes/rubricScoringAgentNode.ts` 只调用 `agentClient.completeJsonPrompt(promptText)`，没有工具循环。
- `src/agent/caseTools.ts` 已有可复用只读工具执行器，但 rubric agent 当前没有接入。

## 推荐架构

改造后 rubric 分支如下：

```text
rubricPreparationNode
  -> rubricScoringPromptBuilderNode
  -> rubricScoringAgentNode
       -> runRubricCaseAwareAgent
            -> planner
            -> tool_executor
            -> planner
            -> final_answer
  -> scoreFusionOrchestrationNode
```

外层 workflow 节点顺序不变，只替换 `rubricScoringAgentNode` 内部实现。

## 可复用代码清单

### 可直接复用

- `src/agent/caseTools.ts`
  - 直接复用只读工具执行器 `createCaseToolExecutor(...)`。
  - rubric agent 和 rule agent 使用同一套路径约束、预算约束、patch 读取和文件读取逻辑。
- `src/agent/caseToolSchemas.ts`
  - 直接复用 `caseToolNameSchema`、`readPathArgsSchema`、`listDirArgsSchema`、`readFileChunkArgsSchema`、`grepInFilesArgsSchema`。
  - rubric agent 不重新定义工具参数 schema。
- `src/types.ts`
  - 直接复用 `CaseToolName`、`CaseToolTraceItem`、`CaseAwareAgentTurn`、`CaseToolBudgetSnapshot`。
  - 这些类型不带 rule 语义，可以直接作为 rubric runner 的轨迹类型。
- `src/agent/caseAwareProtocol.ts` 的严格 JSON 解析思路
  - `CaseAwareProtocolError`
  - `findTopLevelJsonObjectEnd(...)`
  - `formatSchemaValidationError(...)`
  - 单顶层 JSON object 校验逻辑
  - 这些适合抽成共享 helper，rubric 协议直接复用，不要再写第二套同逻辑代码。
- `src/agent/caseAwarePrompt.ts` 的重试策略模式
  - single-action repair prompt
  - tool_call repair prompt
  - final_answer repair prompt
  - rubric agent 直接复用这套“有限一次修复重试”的交互模式，只替换 final answer 的业务 schema 和文案。

### 复用思路，但不直接复用业务结构

- `src/agent/caseAwareAgentRunner.ts`
  - runner 的循环骨架、turn/tool trace 记录、预算耗尽处理、工具观察写回都可以复用。
  - 但 `final_answer` 的业务结构不能直接复用，因为 rule agent 的 final answer 是 `rule_assessments`，rubric agent 需要的是 `RubricScoringResult`。
  - 推荐做法是抽一层通用 runner 骨架，或在 rubric runner 中直接复用相同控制流实现，而不是复制整份文件后再改。
- `src/agent/ruleAssistance.ts`
  - `buildRubricSnapshot(...)` 已经是通用能力，可以直接复用现有 `LoadedRubricSnapshot`。
  - `normalizeGeneratedProjectPathForTools(...)`、`initial_target_files` 构造思路也可以直接复用。
  - 但 `assisted_rule_candidates`、`rule_id` 覆盖校验、`rule_assessments` prompt 文案不能直接带到 rubric agent。

### 不应直接复用

- `AgentBootstrapPayload`
  - 当前结构带有 `assisted_rule_candidates`，这是 rule agent 专用。
  - rubric agent 应单独定义 payload，但字段布局尽量对齐，方便共享 prompt/runner 骨架。
- `CaseAwareAgentFinalAnswer`
  - 当前绑定 `rule_assessments`，不适合 rubric agent。
- `validateCaseAwareFinalAnswerAgainstCandidates(...)`
  - 当前是按 rule candidate 覆盖校验；rubric agent 需要按 rubric item 全覆盖校验。

## 新增协议与模块

### 新增 `src/agent/rubricCaseAwareProtocol.ts`

该模块定义 rubric 专用 canonical protocol：

- `RubricCaseAwareToolCall`
- `RubricCaseAwareFinalAnswer`
- `RubricCaseAwarePlannerOutput`
- `RubricCaseAwareRunnerResult`
- `parseRubricCaseAwarePlannerOutputStrict(rawText)`
- `validateRubricFinalAnswerAgainstSnapshot(finalAnswer, rubricSnapshot)`

#### Tool Call

唯一合法工具调用结构：

```json
{
  "action": "tool_call",
  "tool": "read_patch",
  "args": {},
  "reason": "先读取补丁以定位可能影响评分的文件。"
}
```

要求：

- 顶层必须是单个 JSON object。
- `action` 必须是 `tool_call`。
- `tool` 必须来自允许工具集合。
- `args` 必须是对象。
- `reason` 必须是中文短句。

#### Final Answer

最终输出仍包装现有 `RubricScoringResult`，避免直接改变下游：

```json
{
  "action": "final_answer",
  "summary": {
    "overall_assessment": "整体达到基础要求，个别项存在明确问题。",
    "overall_confidence": "medium"
  },
  "item_scores": [
    {
      "dimension_name": "风险控制与稳定性",
      "item_name": "安全与边界意识",
      "score": 3,
      "max_score": 3,
      "matched_band_score": 3,
      "rationale": "未读取到足够负面证据，按满分保留。",
      "evidence_used": [],
      "confidence": "medium",
      "review_required": false
    }
  ],
  "hard_gate_candidates": [],
  "risks": [],
  "strengths": [],
  "main_issues": []
}
```

扣分项必须带 `deduction_trace`：

```json
{
  "dimension_name": "风险控制与稳定性",
  "item_name": "稳定性风险",
  "score": 2,
  "max_score": 4,
  "matched_band_score": 2,
  "rationale": "存在多处空值或异步时序风险。",
  "evidence_used": [
    "workspace/entry/src/main/ets/pages/Index.ets:42"
  ],
  "confidence": "high",
  "review_required": false,
  "deduction_trace": {
    "code_locations": [
      "workspace/entry/src/main/ets/pages/Index.ets:42"
    ],
    "impact_scope": "影响页面初始化失败场景的稳定性。",
    "rubric_comparison": "未命中更高档，因为存在明确空值风险；命中当前档，因为问题集中在单一页面且可修补。",
    "deduction_reason": "工具读取到具体代码位置存在未防御访问，因此降到当前档。",
    "improvement_suggestion": "在访问前增加空值保护，并将失败路径显式收敛到兜底状态。"
  }
}
```

约束补充：

- 只要 `score < max_score`，除了说明扣分依据，还必须给出可执行的 `improvement_suggestion`。
- `improvement_suggestion` 必须是针对当前问题点的修复建议，不能写空泛建议，例如“优化代码质量”“加强测试”。
- 建议优先说明最小修复方向，而不是要求大规模重构。

### 新增 `src/agent/rubricCaseAwarePrompt.ts`

该模块只负责 prompt 渲染，不负责解析。

包含：

- `renderRubricCaseAwareSystemPrompt(payload)`
- `renderRubricCaseAwareBootstrapPrompt(payload)`
- `renderRubricCaseAwareSingleActionRetryPrompt(...)`
- `renderRubricCaseAwareFinalAnswerRetryPrompt(...)`

prompt 必须强调：

- 只能输出 `tool_call` 或 `final_answer`。
- 一次只能输出一个 JSON object。
- 如果需要扣分，必须先用工具读取代码证据。
- 未找到足够负面证据必须保持满分。
- `item_scores` 必须覆盖 rubric 中所有 item。
- `score` 和 `matched_band_score` 必须相等且来自该 item 声明过的 band。
- 扣分项必须给 `deduction_trace`。
- 扣分项的 `deduction_trace` 中必须同时给出改进建议 `improvement_suggestion`。
- 满分项不需要编造证据。

### 新增 `src/agent/rubricCaseAwareRunner.ts`

该模块参考 `caseAwareAgentRunner.ts` 实现独立 runner。

职责：

- 调用模型 planner。
- 解析 `tool_call` 或 `final_answer`。
- 执行 `caseTools`。
- 维护工具预算和轮次。
- 对 final answer 做严格校验。
- 返回统一 runner result。

推荐返回结构：

```ts
type RubricCaseAwareRunnerOutcome =
  | "success"
  | "request_failed"
  | "protocol_error"
  | "tool_budget_exhausted";

type RubricCaseAwareRunnerResult = {
  outcome: RubricCaseAwareRunnerOutcome;
  final_answer?: RubricScoringResult;
  final_answer_raw_text?: string;
  failure_reason?: string;
  turns: CaseAwareAgentTurn[];
  tool_trace: CaseToolTraceItem[];
};
```

是否存在可消费 rubric 结果，只看 `final_answer` 是否存在。

## Payload 设计

### `RubricCaseAwarePayload`

新增或扩展现有 `RubricScoringPayload`，建议命名为 `RubricCaseAwarePayload`：

```ts
type RubricCaseAwarePayload = {
  case_context: {
    case_id: string;
    case_root: string;
    task_type: TaskType;
    original_prompt_summary: string;
    original_project_path: string;
    generated_project_path: string;
    effective_patch_path?: string;
  };
  task_understanding: ConstraintSummary;
  rubric_summary: LoadedRubricSnapshot;
  initial_target_files: string[];
  tool_contract: {
    allowed_tools: CaseToolName[];
    max_tool_calls: number;
    max_total_bytes: number;
    max_files: number;
  };
  response_contract: {
    action_enum: ["tool_call", "final_answer"];
    output_language: "zh-CN";
    json_only: true;
  };
};
```

### `initial_target_files`

来源优先级：

1. `evidenceSummary.changedFiles`，转成 `workspace/...` 路径。
2. `effectivePatchPath` 中解析出的 changed files。
3. 若无 patch，列出 `workspace` 下少量入口文件，例如 `entry/src/main/ets`、`oh-package.json5`、`module.json5`、`build-profile.json5`。

数量限制：

- 首版最多 20 个路径。
- 只传路径，不传文件内容。

## 工具预算

首版预算建议比 rule agent 更保守：

```ts
tool_contract: {
  allowed_tools: [
    "read_patch",
    "list_dir",
    "read_file",
    "read_file_chunk",
    "grep_in_files",
    "read_json"
  ],
  max_tool_calls: 4,
  max_total_bytes: 40960,
  max_files: 12
}
```

理由：

- rubric 最终需要覆盖全部 item，不能把大量 token 花在开放式探索上。
- 默认满分原则允许在证据不足时快速收敛，不需要强行读完整工程。
- 预算受控可以减少长时间卡顿和工具回合膨胀。

## 节点改造

### `rubricScoringPromptBuilderNode`

改造职责：

- 构建 `rubricCaseAwarePayload`。
- 构建 `rubricScoringPromptText`，但该 prompt 是精简 bootstrap prompt，不再是完整长评分 prompt。
- 记录日志时输出 `promptLength`、`initialTargetFiles.length`、`toolBudget`。
- 生成 payload 时优先复用 `ruleAssistance.ts` 中已有的路径规范化和 rubric snapshot 表达方式，不重复实现一套结构映射。

保留字段：

- `rubricScoringPayload` 可以继续存在，用于兼容持久化和调试。
- `rubricScoringPromptText` 继续存在，用于日志和中间产物，不再代表一次性完整评分 prompt。

### `rubricScoringAgentNode`

改造职责：

- 有 `agentClient` 时调用 `runRubricCaseAwareAgent`。
- runner 成功时写入：
  - `rubricAgentRunStatus: "success"`
  - `rubricAgentRawText`
  - `rubricScoringResult`
  - `rubricAgentTurns`
  - `rubricAgentToolTrace`
  - `rubricAgentRunnerResult`
- runner 无 final answer 时写入：
  - `rubricAgentRunStatus: "invalid_output"` 或 `"failed"`
  - `rubricScoringResult: undefined`
  - 保留 turns 和 tool trace 便于调试。
- 没有 `agentClient` 时继续返回 `skipped`。

### `scoreFusionOrchestrationNode`

首版不改业务行为。

当 `rubricAgentRunStatus !== "success"` 或 `rubricScoringResult` 缺失时，继续由 `scoreFusion.ts` 的 fallback item 逻辑按满分待复核处理。

## 状态与持久化

### `ScoreGraphState`

建议新增：

- `rubricAgentRunnerMode: "case_aware"`
- `rubricAgentRunnerResult`
- `rubricAgentTurns`
- `rubricAgentToolTrace`

保留：

- `rubricAgentRunStatus`
- `rubricAgentRawText`
- `rubricScoringResult`
- `rubricScoringPromptText`
- `rubricScoringPayload`

### 中间产物

`persistAndUploadNode` 建议新增或扩展落盘：

- `intermediate/rubric-agent-bootstrap-payload.json`
- `intermediate/rubric-agent-turns.json`
- `intermediate/rubric-agent-tool-trace.json`
- `intermediate/rubric-agent-runner-result.json`

这些文件只用于调试，不进入最终 callback 的业务结构。

## 解析与校验

### 严格 JSON

parser 只接受一个顶层 JSON object：

- 不接受 markdown。
- 不接受代码块。
- 不从文本中扫描 JSON 片段。
- 不接受多个 JSON object 串联。

实现要求：

- 优先抽取并复用 `caseAwareProtocol.ts` 中的通用严格解析 helper，不再新写一份近似逻辑。

### Final Answer 校验

必须满足：

- `item_scores` 覆盖 `rubric_summary.dimension_summaries` 中所有 item。
- 不允许遗漏、重复或新增未知 item。
- `score` 和 `matched_band_score` 必须相等。
- `score` 必须来自该 item 的 `scoring_bands`。
- `max_score` 必须等于该 item 的 `weight`。
- `score < max_score` 时必须有完整 `deduction_trace`。
- `deduction_trace.code_locations` 至少一条。
- `deduction_trace.rubric_comparison` 必须同时说明高档不成立和当前档成立。
- `deduction_trace.improvement_suggestion` 必须存在且为非空中文短句。

### 失败重试

runner 可以保留有限 repair：

- tool_call 结构错误时，每轮最多重试一次，要求返回合法 `tool_call`。
- final_answer 结构错误时，最多重试一次，要求返回完整合法 `final_answer`。
- 重试后仍失败，runner 返回 `protocol_error`，外层降级。

不做宽松兼容，不猜测模型意图。

## 卡顿控制

### Prompt 层

- 首轮不传完整 patch 正文。
- 首轮不传文件内容。
- rubric summary 使用现有 `LoadedRubricSnapshot`，不传完整 markdown rubric。
- 输出说明保持短句，避免长示例。

### Runner 层

- 限制 `max_tool_calls=4`。
- 限制 `max_total_bytes=40960`。
- 限制 `max_files=12`。
- 超预算直接收敛为 `tool_budget_exhausted`，外层降级。

### Agent 语义层

- 允许证据不足时立即 final answer 满分。
- 不要求为了每个 item 主动读文件。
- 只在发现可能影响扣分的线索时继续读文件。

## 与 rule agent 的关系

rubric case-aware runner 复用以下基础能力：

- `caseTools`
- `caseToolSchemas`
- `CaseToolTraceItem`
- `CaseAwareAgentTurn` 或等价 turn 结构
- 严格 JSON single-action 思路

但不复用 rule agent 的业务 final answer，因为 rubric 输出是 `RubricScoringResult`，rule 输出是 `rule_assessments`。

两者可以共享底层工具执行器，但保留各自协议模块：

```text
caseAwareProtocol.ts          rule agent protocol
rubricCaseAwareProtocol.ts    rubric agent protocol
```

这样避免把 rule 的候选规则语义泄漏到 rubric 评分里。

## 测试策略

### 协议测试

新增 `tests/rubric-case-aware-protocol.test.ts`：

- 接受合法 `tool_call`。
- 接受合法 `final_answer`。
- 拒绝 markdown 包裹 JSON。
- 拒绝多个 JSON object。
- 拒绝缺少 item 的 final answer。
- 拒绝未知 item。
- 拒绝非声明 band 分数。
- 拒绝扣分但缺少 `deduction_trace`。
- 拒绝扣分但缺少 `improvement_suggestion`。
- 拒绝 `rubric_comparison` 未说明“未命中高分档”和“命中当前档”的扣分项。

### Prompt 测试

扩展 `tests/rubric-scoring.test.ts`：

- builder 输出包含工具协议。
- builder 输出不再内嵌 patch 正文。
- prompt 明确写入“默认满分、证据不足保持满分、扣分前必须读取证据”。
- prompt length 相比旧长 prompt 明显降低。

### Runner 测试

新增 `tests/rubric-case-aware-runner.test.ts`：

- 模型先输出 `read_patch`，runner 执行工具后接受 final answer。
- 模型直接输出满分 final answer，runner 成功。
- 模型输出扣分项时，final answer 中会同时包含扣分依据和改进建议。
- 模型输出非法 JSON，runner 返回 `protocol_error`。
- 模型持续 tool_call 超预算，runner 返回 `tool_budget_exhausted`。
- 工具读取路径越界时记录 tool error，不崩溃。

### 节点测试

扩展 `tests/score-agent.test.ts`：

- `rubricScoringAgentNode` 成功时写入 `rubricScoringResult`。
- runner 失败时 `rubricAgentRunStatus` 为失败状态，下游 score fusion 仍 fallback 满分待复核。
- 中间产物落盘包含 rubric turns 和 tool trace。

### 回归测试

继续保留：

- `npm test`
- `npm run build`

如果实现过程中修改报告 schema，再补充对应 schema validator 测试。

## 受影响文件

主要新增：

- `src/agent/rubricCaseAwareProtocol.ts`
- `src/agent/rubricCaseAwarePrompt.ts`
- `src/agent/rubricCaseAwareRunner.ts`
- `tests/rubric-case-aware-protocol.test.ts`
- `tests/rubric-case-aware-runner.test.ts`

主要修改：

- `src/agent/rubricScoring.ts`
- `src/nodes/rubricScoringPromptBuilderNode.ts`
- `src/nodes/rubricScoringAgentNode.ts`
- `src/workflow/state.ts`
- `src/nodes/persistAndUploadNode.ts`
- `tests/rubric-scoring.test.ts`
- `tests/score-agent.test.ts`

可能修改：

- `src/types.ts`
- `src/workflow/observability/nodeSummaries.ts`
- `src/workflow/observability/types.ts`

## 实施步骤

1. 新增 rubric case-aware 协议模块和协议测试。
2. 新增 rubric prompt 模块，补 prompt 稳定性测试。
3. 新增 rubric case-aware runner，复用 `caseTools`，补 runner 测试。
4. 改造 `rubricScoringPromptBuilderNode` 生成 bootstrap payload。
5. 改造 `rubricScoringAgentNode` 调用 runner 并保留失败降级。
6. 扩展 `ScoreGraphState` 和中间产物落盘。
7. 跑相关测试、全量测试和 build。

## 风险与取舍

- 多轮工具模式会增加模型调用次数，但单次 prompt 显著变短，且工具预算可控，整体更不容易因超长上下文卡死。
- rubric agent 可能因为预算不足无法覆盖所有代码上下文；这时按业务规则保持满分并待复核，比凭空扣分更稳定。
- 新增 rubric 专用协议会带来少量业务 schema 差异，但底层工具、轨迹、解析和 repair 逻辑优先复用，避免重复造轮子。
- 如果模型不会主动使用工具，仍可以直接输出满分 final answer；这符合“证据不足保持满分”的原则。

## 成功标准

- rubric 首轮 prompt 不再携带完整 patch 或文件正文。
- rubric agent 可以通过工具读取 patch 和必要文件。
- 同一用例重复评分时，没有足够负面证据的 item 保持满分。
- 扣分项都能追溯到工具读取到的代码位置和 rubric band 比对。
- rubric runner 卡住或失败时，主流程不会长时间阻塞，最终走满分待复核降级。
- `npm run build` 和 `npm test` 通过。
