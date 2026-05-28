# Agent 调用链分析看板设计

日期：2026-05-27

## 背景

当前评分服务对用例执行结果的评价主要围绕最终生成代码、规则检查、rubric 评分和报告产物展开。实际执行过程中，评分结果由多个 agent 和 workflow 节点共同产生，例如任务理解、rubric 评分 agent、规则判定 agent、官方代码检查、规则合并和分数融合。仅看最终结果很难解释 agent 是如何得到结论的，也难以定位评分异常、协议重试、工具失败、输出格式修复、token 成本和耗时瓶颈。

项目已经具备几个基础：

- 使用 LangGraph 编排评分流程，主图在 `src/workflow/scoreWorkflow.ts`。
- 使用 OpenCode 执行部分 agent，`OpencodeRunResult` 已包含 `elapsedMs`、`tokenUsage`、`sessionId` 等摘要信息。
- OpenCode runtime 自身也保存 session、message、part，可通过 HTTP API 或 runtime SQLite 反查更完整的 agent 内部调用链。
- 已有 dashboard API 和 Vue/Element Plus 前端看板。
- 已有 SQLite 存储任务摘要，并以 `caseDir` artifact 保存运行产物。

本设计目标是在不接入 LangSmith 的前提下，自建一个轻量 Agent 调用链分析能力，把关键 agent run 和关键 event 展示到现有前端看板中。

## 目标

首版本只保留关键 run 和关键 event，不追求完整 tracing 平台。

目标包括：

- 在每次 OpenCode agent 调用结束后，关联 OpenCode session，解析 session messages/parts，生成结构化 trace artifact。
- 将 agent run 摘要和关键事件摘要写入 SQLite，便于看板查询和后续过程评价。
- 在任务详情 Drawer 中增加 `Agent Trace` tab，展示单个 task 的 agent 调用链。
- 支持完整查看 prompt、assistant output、tool output 和 OpenCode session 原始内容。
- trace 失败不影响评分主流程。

非目标：

- 不做实时流式 trace 展示。
- 不做 OpenTelemetry / OpenInference 通用 tracing 平台。
- 不做 LangSmith、Langfuse、Phoenix 等外部平台接入。
- 不做复杂过程评分，只为后续过程评价沉淀数据。
- 不在第一版完整展开每个 OpenCode 内部事件；只抽取关键事件。

## 设计选择

已确认的设计边界：

- 架构：SQLite 索引 + artifact 原文。
- 数据可见性：首版本完整可见，不默认脱敏。
- 前端入口：嵌入任务详情 Drawer，作为 `Agent Trace` tab。
- 入库粒度：摘要入库，完整 trace 和 raw payload 保存在 artifact。
- 采集方式：OpenCode run 完成后后处理，以 OpenCode Session 作为单一数据源；HTTP API 优先，runtime SQLite 仅作为同源 fallback。

## 实测观察

本设计基于一次真实远端任务运行验证，样本为 `taskId=1747`、`testCaseId=110`，caseDir 为：

```text
.local-cases/20260527T033647_case_1747_f067fe1e
```

### 当前任务目录可见数据

任务目录里的业务日志只记录 workflow 和 OpenCode 调用摘要：

- `logs/run.log`：包含节点开始/完成、OpenCode requestTag、agent 名、耗时、token 摘要、最终回调状态。
- `opencode-sandbox/metadata/opencode-prompts/*.md`：保存实际 prompt。
- `opencode-sandbox/metadata/agent-output/*.json`：保存部分最终 agent 输出。
- `outputs/result.json`、`outputs/report.html`：保存评分结果。

不足：

- 当前 caseDir 没有持久保存 CLI stdout JSONL。
- 当前 caseDir 没有保存 OpenCode message/part 级别结构化事件。
- `task-understanding.json` 在 run 过程中曾由 OpenCode write tool 写入，但任务结束后的 `agent-output` 目录只保留了 rubric/rule 输出；因此不能依赖最终 agent-output 目录反推所有 agent 过程。

### OpenCode runtime 可见数据

本次 API 服务启动了 3 个 OpenCode serve 进程，端口为 `4096`、`4097`、`4098`。任务 `1747` 实际落在 worker-0：

```text
.opencode/runtime/worker-0/xdg-data/opencode/opencode.db
```

worker-0 的 OpenCode 数据库中能看到三条 session：

| agent | session id | created | updated |
| --- | --- | --- | --- |
| task-understanding | `ses_1987e4d07ffecAw4YWrvAyY8HS` | 2026-05-27 03:36:53 | 2026-05-27 03:37:27 |
| rubric-scoring | `ses_1987d90bdffeHTt2F52NavzgUO` | 2026-05-27 03:37:41 | 2026-05-27 03:43:24 |
| rule-assessment | `ses_1987d903dffeMVDUjYQzgI6RSN` | 2026-05-27 03:37:42 | 2026-05-27 03:41:29 |

OpenCode HTTP API 可直接读取这些数据：

```text
GET /global/health
GET /session
GET /session/:sessionId
GET /session/:sessionId/message
```

其中 `/session/:sessionId/message` 返回 `info + parts`，已经接近前端调用链展示所需结构。

### task-understanding 关键链路样本

`task-understanding` session 中有 4 条 message、15 条 part：

| part type | tool | status | count |
| --- | --- | --- | --- |
| reasoning | | | 3 |
| step-finish | | | 3 |
| step-start | | | 3 |
| text | | | 3 |
| tool | skill | completed | 1 |
| tool | read | completed | 1 |
| tool | write | completed | 1 |

可还原的过程：

1. 用户 message 发出 run 指令，要求读取 prompt 并写 `metadata/agent-output/task-understanding.json`。
2. assistant step 1 加载 `hmos-understanding` skill，并读取 prompt 文件。
3. assistant step 2 推理任务约束，调用 `write` 写入最终 JSON。
4. assistant step 3 回复 `{"output_file":"metadata/agent-output/task-understanding.json"}`。

step-finish token 样本：

| reason | total | input | output | reasoning | cacheRead |
| --- | ---: | ---: | ---: | ---: | ---: |
| tool-calls | 2177 | 2058 | 100 | 19 | 0 |
| tool-calls | 7302 | 4217 | 572 | 465 | 2048 |
| stop | 7344 | 1103 | 15 | 18 | 6208 |

这说明首版“关键 event”至少可以稳定覆盖：

- `step-start`
- `reasoning`
- `tool` 调用及输入输出
- `step-finish` token/finish reason
- assistant 最终 `text`
- message 级 agent、model、cwd、created/completed 时间

### 两个评分 agent 的事件分布

`rubric-scoring` session 有 8 条 message、36 条 part：

- `read completed` 9 次
- `read error` 1 次
- `glob completed` 1 次
- `skill completed` 1 次
- `write completed` 1 次
- `step-finish` 7 次

`rule-assessment` session 有 7 条 message、32 条 part：

- `read completed` 8 次
- `skill completed` 1 次
- `write completed` 1 次
- `step-finish` 6 次

这说明过程评价可用的数据已经超过业务日志：不仅能看到 token 和总耗时，还能看到读了哪些文件、是否出现工具错误、写入了哪个输出文件、每轮 step 为什么结束。

### 设计影响

原设计中“只解析 CLI stdout JSONL”不够稳妥，因为当前任务目录没有持久保存这份 stdout，而且最终 agent-output 目录也不是完整过程记录。

首版应改为单一数据源：

1. **唯一逻辑数据源：OpenCode Session**  
   从 session title 或 requestTag 关联当前 agent run，读取 message/part，构造关键 event。
2. **读取路径：API 优先，runtime SQLite 降级**  
   正常情况下通过 OpenCode HTTP API 读取 session；API 不可用时读取同一 runtime 下的 `opencode.db`。这两条路径读取的是同一份 OpenCode session 数据，不视为两套数据源。

`OpencodeRunResult.rawEvents` 不进入 Agent Trace 设计，不作为 artifact 或前端展示数据。它只保留在 runner 内部，用于现有 token 摘要提取、错误诊断和 OpenCode CLI 协议排障。

落盘策略仍保持“摘要入库 + 完整 artifact”，artifact 内容保存 OpenCode session snapshot、规范化事件和必要的 prompt/output 摘要。

## 总体架构

```text
LangGraph workflow
  ├─ taskUnderstandingNode
  ├─ rubricScoringAgentNode
  └─ ruleAssessmentAgentNode
        │
        ▼
OpenCode runPrompt
        │
        ▼
OpencodeRunResult(sessionId, tokenUsage, elapsedMs, outputFileText)
        │
        └─ resolve OpenCode session by sessionId
                │
                ├─ GET /session/:sessionId/message
                └─ same-source fallback: read runtime SQLite message/part
        │
        ▼
AgentTraceNormalizer
        │
        ├─ write artifact: metadata/agent-trace/<baseRequestTag>.json
        ├─ update aggregate artifact: outputs/agent-trace.json
        └─ write SQLite summary:
             agent_trace_run
             agent_trace_event
        │
        ▼
Dashboard API
        │
        ▼
Task Drawer / Agent Trace tab
```

## 后端设计

### 1. Trace 数据模型

首版本将 trace 分为四层，但字段只保留看板展示、任务关联和后续过程评价真正需要的最小集合：

- `AgentTraceReport`：一个 task 的完整 trace 聚合视图。
- `AgentTraceRun`：一次逻辑 agent 执行，对应一个 OpenCode session，例如一次 rubric scoring agent 执行。
- `AgentTraceAttempt`：同一个 session 内的一次 `runOpencodePrompt` 调用；retry 会追加到同一 session，但仍保留独立 requestTag、耗时和 token 摘要。
- `AgentTraceEvent`：一次关键 OpenCode message/part，例如 `reasoning`、`tool`、`step-finish`。

字段取舍原则：

- 能从 `opencodeMessages` 原文稳定推导、且不是列表查询条件的字段，不重复落 SQLite。
- run 级只保存耗时、token、session 关联、attempt 列表和 artifact 路径。
- attempt 级保存每次 `runOpencodePrompt` 调用的 requestTag、retryIndex、耗时、token 和失败摘要。
- event 级只保存排序、attempt 关联、OpenCode 原生命名、状态、工具名和短摘要。
- prompt/output 原文保存在 artifact，SQLite 不保存大文本。

建议类型：

```ts
export type AgentTraceRunStatus = "success" | "failed" | "session_missing" | "skipped";

export type OpenCodeTraceEventType =
  | "message"
  | "step-start"
  | "reasoning"
  | "tool"
  | "step-finish"
  | "text"
  | "unknown";

export type AgentTraceEvent = {
  id: string;
  sequence: number;
  attemptId?: string;
  retryIndex?: number;
  type: OpenCodeTraceEventType;
  title: string;
  status?: "completed" | "error" | "running" | "unknown";
  timestampMs?: number;
  elapsedMs?: number;
  toolName?: string;
  messageId?: string;
  partId?: string;
  summary?: string;
  rawPayload?: unknown;
};

export type AgentTraceAttempt = {
  id: string;
  sequence: number;
  retryIndex: number;
  requestTag: string;
  startedAtMs?: number;
  endedAtMs?: number;
  elapsedMs: number;
  status: AgentTraceRunStatus;
  tokenUsage?: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  warnings: string[];
};

export type AgentTraceRun = {
  id: string;
  taskId?: number;
  caseId?: string;
  baseRequestTag: string;
  agentName: string;
  nodeId?: string;
  status: AgentTraceRunStatus;
  startedAtMs?: number;
  endedAtMs?: number;
  elapsedMs: number;
  tokenUsage?: {
    total: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  attempts: AgentTraceAttempt[];
  prompt?: string;
  assistantText?: string;
  outputFile?: string;
  outputFileText?: string;
  opencodeSession?: {
    id: string;
    title: string;
    directory: string;
    createdAtMs?: number;
    updatedAtMs?: number;
    source: "api" | "sqlite";
  };
  opencodeMessages?: unknown[];
  events: AgentTraceEvent[];
  warnings: string[];
};

export type AgentTraceReport = {
  schemaVersion: 1;
  taskId?: number;
  caseId?: string;
  generatedAt: string;
  traceAvailable: boolean;
  runs: AgentTraceRun[];
  summary: {
    runCount: number;
    eventCount: number;
    toolEventCount: number;
    errorCount: number;
    attemptCount: number;
    totalElapsedMs: number;
    totalTokens?: number;
  };
  warnings: string[];
};

export type AgentTraceSummaryReport = Omit<AgentTraceReport, "runs"> & {
  runs: Array<
    Omit<AgentTraceRun, "prompt" | "assistantText" | "outputFileText" | "opencodeMessages" | "events"> & {
      events: Array<Omit<AgentTraceEvent, "rawPayload"> & { hasRawPayload: boolean }>;
      rawAvailable: boolean;
    }
  >;
};
```

### 2. 关键事件命名与抽取

第一版不需要把 OpenCode session 的所有 message/part 原样变成页面事件。解析器只抽取高价值事件。

事件命名直接采用 OpenCode 的 message/part 命名，不再自造一套 `tool_call`、`step_finished`、`agent_started` 之类的 trace 名称。原因是：

- 避免维护 OpenCode schema 到自定义 schema 的二次翻译表。
- 前端看到的事件类型和 OpenCode session 原文一致，排查时更容易对应。
- OpenCode 版本升级后，未知 part 可以按 `unknown` 保留，不需要先设计新枚举。
- `write` 输出文件、`read` 文件、`glob` 搜索都天然是 `tool` part，只需用 `toolName` 区分，不需要改名成业务事件。

解析 OpenCode session message/part：

- message info：生成 `message` event，记录 role、agent、model、cwd、created/completed、finish、token。
- `step-start`：生成 `step-start` event。
- `reasoning`：生成 `reasoning` event，首版本完整可见。
- `tool`：生成 `tool` event，记录 tool name、callID、status、input、output、metadata、title。
- `step-finish`：生成 `step-finish` event，记录 finish reason、token 和 cost。
- `text`：生成 `text` event，同时可汇总为 run 的 `assistantText`。

事件必须尽量绑定到 attempt。绑定策略：

- 首选使用 attempt 的 `startedAtMs` / `endedAtMs` 时间窗口，把 OpenCode message/part 归到对应 attempt。
- 如果时间戳缺失，则用 requestTag/title、message 创建顺序和 retryIndex 做 best-effort 归属。
- 仍无法归属时，event 的 `attemptId` 留空，但保留在 run 时间线中，并在 run warnings 记录 `event_attempt_unresolved`。
- 前端默认展示 run 全量时间线，同时允许按 attempt 过滤。

如果 OpenCode session schema 出现未知 part：

- 保留在 `opencodeMessages`。
- 可选抽样生成 `unknown` event，最多保留前 N 条未知事件摘要。
- 不阻塞 trace 生成。

### 3. Trace 生成时机

在以下三个 agent 调用链结束后生成 run trace：

- `runOpencodeTaskUnderstanding`
- `runOpencodeRubricScoring`
- `runOpencodeRuleAssessment`

其中 rubric 和 rule assessment 存在 retry 逻辑。根据提交 `1036a70 Continue opencode retries in existing session`，当前 retry 不再创建新的 OpenCode session，而是通过 `continueSessionId` / `opencode run --session <sessionId>` 继续首轮 session，同时保留 retry requestTag/title 用于日志和调用区分。因此 trace 模型应表达“一个 session 内的多次 attempt”。

- 每一个 OpenCode session 生成一个 `AgentTraceRun`。
- 首轮和后续 retry 作为同一个 run 内的 `attempts[]`。
- `baseRequestTag` 使用首轮 requestTag，retry attempt 保留自己的 `requestTag`，例如 `<base>-retry-1`。
- `retryIndex` 只存在于 attempt：首轮为 `0`，第一次 retry 为 `1`。
- trace 采集点必须能观察到每一次 `runOpencodePrompt` 调用，而不是只观察最终业务结果。推荐在 OpenCode agent wrapper 内注入 `AgentTraceRecorder`，在每次 attempt 开始、成功、请求失败、协议失败时记录 attempt summary。
- retry 失败原因和修复提示不建成 event，作为对应 attempt 的 `warnings` 或 summary 保存；因为它不是 OpenCode session 内部 part。
- 最终 `outputs/agent-trace.json` 聚合整个 task 的所有 run。

当前 `runOpencodeRubricScoring` / `runOpencodeRuleAssessment` 会在内部处理 retry，并且只把最终业务结果返回给节点。实现时不能只在节点外层根据最终结果建 trace，否则会丢失中间失败 attempt。首版本采用以下边界：

- 不强制扩展业务 result 类型来携带全部 retry 过程。
- 新增可选 `traceRecorder` 参数或用 `runPrompt` wrapper 注入 recorder。
- recorder 在每次 attempt 周围测量 `startedAtMs` / `endedAtMs`，保存 `runResult.sessionId`、token、elapsed、outputFileText 和失败原因。
- trace builder 在 agent 调用链结束后，根据 recorder 中的 attempts 读取同一个 OpenCode session，生成 run artifact 和 SQLite 摘要。

### 3.1 OpenCode session 关联策略

`runOpencodePrompt` 当前会从 OpenCode stdout JSONL 中提取 `sessionId` 并返回。trace 关联优先使用这个 `sessionId`，不要再依赖 requestTag/title 做主路径。

推荐顺序：

1. 在 `runOpencodePrompt` 成功后，读取 `runResult.sessionId`。
2. 如果存在 sessionId，调用 `GET ${serverUrl}/session/${sessionId}/message` 获取完整 message/part。
3. 如果 sessionId 缺失，才调用 `GET ${serverUrl}/session`，用 `title/requestTag + directory/sandboxRoot + time window` 反查。
4. 如果 HTTP API 失败，读取同一 runtime 的 data DB：

```text
<runtimeDir>/xdg-data/opencode/opencode.db
```

对于 worker pool，需要从当前 `OpencodeRuntimeConfig.runtimeDir` 定位，例如：

```text
.opencode/runtime/worker-0/xdg-data/opencode/opencode.db
```

5. 如果 session 仍无法关联，本次 run 不生成内部事件，只保留 run/attempt 摘要，并在 warnings 中记录 `opencode_session_not_found`。

不要为了 trace 继续扩展 `OpencodeRunResult` 返回值。当前已有 `sessionId`、`elapsedMs`、`tokenUsage`、`assistantText`、`outputFileText` 已足够；`startedAtMs` / `endedAtMs` 由 trace wrapper 或 recorder 在 `runPrompt` 外层测量并作为 attempt 元数据保存。这样避免改变 runner 的业务契约，同时让 retry attempt 有清晰时间边界。

### 4. Artifact 形态

每个 caseDir 内新增：

```text
metadata/
  agent-trace/
    <baseRequestTag>.json
outputs/
  agent-trace.json
```

`metadata/agent-trace/<baseRequestTag>.json` 保存单次 agent run 的完整信息，包括 prompt、assistant text、output file text、OpenCode session snapshot、attempt 列表和关键 events。

`outputs/agent-trace.json` 保存任务级聚合报告，供 dashboard API 快速读取。

单 run artifact 建议形态：

```json
{
  "schemaVersion": 1,
  "baseRequestTag": "task-understanding-remote-task-1747-20260527T033647_case_1747_f067fe1e",
  "agentName": "hmos-understanding",
  "status": "success",
  "elapsedMs": 34941,
  "tokenUsage": {
    "total": 7302,
    "input": 4217,
    "output": 572,
    "reasoning": 465,
    "cacheRead": 2048,
    "cacheWrite": 0
  },
  "opencodeSession": {
    "id": "ses_1987e4d07ffecAw4YWrvAyY8HS",
    "title": "task-understanding-remote-task-1747-20260527T033647_case_1747_f067fe1e",
    "directory": ".local-cases/20260527T033647_case_1747_f067fe1e/opencode-sandbox",
    "source": "api"
  },
  "attempts": [
    {
      "id": "atr_rubric_0",
      "sequence": 0,
      "retryIndex": 0,
      "requestTag": "task-understanding-remote-task-1747-20260527T033647_case_1747_f067fe1e",
      "startedAtMs": 1779824213000,
      "endedAtMs": 1779824247941,
      "elapsedMs": 34941,
      "status": "success",
      "warnings": []
    }
  ],
  "prompt": "...",
  "assistantText": "...",
  "outputFile": "metadata/agent-output/task-understanding.json",
  "outputFileText": "...",
  "opencodeMessages": [],
  "events": [],
  "warnings": []
}
```

### 5. SQLite 表

新增三张表。

```sql
CREATE TABLE IF NOT EXISTS agent_trace_run (
  trace_run_id TEXT PRIMARY KEY,
  task_id INTEGER,
  case_id TEXT,
  base_request_tag TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  node_id TEXT,
  status TEXT NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  elapsed_ms INTEGER NOT NULL,
  total_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  opencode_session_id TEXT,
  opencode_server_url TEXT,
  attempt_count INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  tool_event_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  artifact_path TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES remote_task(task_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_run_task_id
  ON agent_trace_run(task_id);

CREATE INDEX IF NOT EXISTS idx_agent_trace_run_agent_name
  ON agent_trace_run(agent_name);

CREATE INDEX IF NOT EXISTS idx_agent_trace_run_session
  ON agent_trace_run(opencode_session_id);

CREATE TABLE IF NOT EXISTS agent_trace_attempt (
  trace_attempt_id TEXT PRIMARY KEY,
  trace_run_id TEXT NOT NULL,
  task_id INTEGER,
  sequence INTEGER NOT NULL,
  retry_index INTEGER NOT NULL,
  request_tag TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at_ms INTEGER,
  ended_at_ms INTEGER,
  elapsed_ms INTEGER NOT NULL,
  total_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  warning_count INTEGER NOT NULL,
  FOREIGN KEY (trace_run_id) REFERENCES agent_trace_run(trace_run_id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES remote_task(task_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_attempt_run_sequence
  ON agent_trace_attempt(trace_run_id, sequence);

CREATE TABLE IF NOT EXISTS agent_trace_event (
  trace_event_id TEXT PRIMARY KEY,
  trace_run_id TEXT NOT NULL,
  trace_attempt_id TEXT,
  task_id INTEGER,
  sequence INTEGER NOT NULL,
  retry_index INTEGER,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  timestamp_ms INTEGER,
  elapsed_ms INTEGER,
  tool_name TEXT,
  summary TEXT,
  has_raw_payload INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (trace_run_id) REFERENCES agent_trace_run(trace_run_id) ON DELETE CASCADE,
  FOREIGN KEY (trace_attempt_id) REFERENCES agent_trace_attempt(trace_attempt_id) ON DELETE SET NULL,
  FOREIGN KEY (task_id) REFERENCES remote_task(task_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_event_run_sequence
  ON agent_trace_event(trace_run_id, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_trace_event_task_id
  ON agent_trace_event(task_id);

CREATE INDEX IF NOT EXISTS idx_agent_trace_event_attempt_sequence
  ON agent_trace_event(trace_attempt_id, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_trace_event_type
  ON agent_trace_event(event_type);
```

完整 `rawPayload` 不进 SQLite，只在 artifact 中保存。SQLite 仅用于列表、筛选、摘要和时间线。

### 6. Store 接口

新增 `src/agentTrace/` 或 `src/trace/` 模块，建议命名为 `src/agentTrace/`，包含：

```text
src/agentTrace/types.ts
src/agentTrace/opencodeSessionClient.ts
src/agentTrace/opencodeSessionReader.ts
src/agentTrace/opencodePartParser.ts
src/agentTrace/agentTraceBuilder.ts
src/agentTrace/agentTraceArtifactStore.ts
src/agentTrace/agentTraceSqliteStore.ts
```

核心接口：

```ts
export type AgentTraceStore = {
  upsertRun(run: AgentTraceRun, artifactPath: string): Promise<void>;
  listRunsByTaskId(taskId: number): Promise<AgentTraceRunSummary[]>;
  listAttemptsByRunId(traceRunId: string): Promise<AgentTraceAttemptSummary[]>;
  listEventsByRunId(traceRunId: string, options?: { retryIndex?: number }): Promise<AgentTraceEventSummary[]>;
};
```

OpenCode session 读取接口：

```ts
export type OpencodeSessionReader = {
  findSession(input: {
    serverUrl: string;
    runtimeDir: string;
    sessionId?: string;
    requestTag: string;
    sandboxRoot: string;
    startedAtMs: number;
    endedAtMs: number;
  }): Promise<OpencodeSessionSnapshot | undefined>;
};
```

实现建议：

- `opencodeSessionClient.ts`：调用 HTTP API，优先使用 `/session` 和 `/session/:id/message`。
- `opencodeSessionReader.ts`：封装 API + 同源 SQLite fallback。
- `opencodePartParser.ts`：把 OpenCode message/part 转为 `AgentTraceEvent[]`。

Trace builder 由 agent wrapper 或 `runPrompt` wrapper 调用，不再继续修改 `runOpencodePrompt` 的返回类型。调用方负责传入 requestTag、agentName、sandboxRoot、runtime、prompt/output 文件路径，以及 recorder 捕获到的 attempt 元数据。每个 attempt 的 `startedAtMs` / `endedAtMs` 由 wrapper 在调用 `runPrompt` 前后测量。

### 7. Dashboard API

新增 API：

```text
GET /dashboard/tasks/:taskId/agent-trace
GET /dashboard/tasks/:taskId/agent-trace/runs/:traceRunId/raw
GET /dashboard/tasks/:taskId/agent-trace/events/:traceEventId/raw
```

响应：

```ts
type AgentTraceResponse = {
  success: true;
  taskId: number;
  traceAvailable: boolean;
  source: "artifact" | "sqlite" | "mixed";
  report?: AgentTraceSummaryReport;
  rawAvailable?: boolean;
  message?: string;
};

type AgentTraceRunRawResponse = {
  success: true;
  taskId: number;
  traceRunId: string;
  prompt?: string;
  assistantText?: string;
  outputFileText?: string;
  opencodeMessages?: unknown[];
};

type AgentTraceEventRawResponse = {
  success: true;
  taskId: number;
  traceEventId: string;
  rawPayload?: unknown;
};
```

读取优先级：

1. 首屏接口优先读 SQLite 摘要，返回 run、attempt、event summary 和 `rawAvailable`。
2. 如果 SQLite 摘要不存在但 `outputs/agent-trace.json` 存在，从 artifact 生成摘要视图返回。
3. 如果都不存在，返回 `traceAvailable=false`。
4. 如果 artifact 损坏，返回错误摘要，并尝试返回 SQLite 摘要。
5. raw endpoint 按需读取 `outputs/agent-trace.json` 或单 run artifact，返回指定 run/event 原文。

首屏接口不直接返回完整 `prompt`、`outputFileText`、`opencodeMessages` 和每个 event 的 `rawPayload`。前端只有在用户展开 run 原文或点击 event 详情时才调用 raw endpoint。这样仍保留完整可见能力，但避免打开 Drawer 时传输过大的 session payload。

### 8. 删除与清理

任务删除时：

- SQLite 通过 foreign key 级联删除 `agent_trace_run`、`agent_trace_attempt` 和 `agent_trace_event`。
- caseDir artifact 跟随现有 case artifact 清理逻辑删除。

如果 trace 生成失败：

- 写入 workflow 日志 warning。
- 不抛出影响评分主流程的错误。
- 如果部分 run 已生成，聚合 artifact 仍可展示 partial trace。

## 前端设计

### 1. 入口

在 `TaskDashboard.vue` 中，用户点击任务名后打开任务详情 Drawer。首版本将原本的 `CaseReportDrawer` 扩展为带 tab 的任务详情：

```text
报告 | 日志 | Agent Trace
```

为减少一次性重构，也可以新增 `TaskDetailDrawer.vue`，内部复用现有报告内容，并承载日志和 Agent Trace。

### 2. Agent Trace tab 布局

采用三段式布局：

```text
顶部摘要条：
run 数、attempt 数、event 数、tool 数、error 数、总耗时、总 token

左侧：
Agent run 列表
- agent 名称
- 状态
- session id
- attempt 数
- 耗时
- token
- event/tool/error 数

中间：
当前 run 的关键事件时间线
- event type
- title
- status
- tool name
- elapsed

右侧：
选中事件详情
- summary
- rawPayload
- run prompt
- assistantText
- outputFileText
- opencodeMessages
```

### 3. 交互

首版本支持：

- 按 agent run 切换。
- 按 attempt 切换或过滤，默认展示当前 run 的全部 attempt。
- 按 event type 快速过滤：全部、message、reasoning、tool、step-finish、text、unknown。
- 点击事件时按需加载完整 rawPayload。
- 展开 run 级别原文时按需加载 prompt、assistantText、outputFileText、opencodeMessages。
- JSON payload 使用 `<pre>` 展示，后续可替换为 JSON viewer。

不做：

- 多任务对比。
- 全局 agent trace 分析页。
- 实时刷新流。
- 复杂图谱/火焰图。

### 4. 前端类型与 API

在 `web/src/api/dashboard.ts` 增加：

```ts
export async function fetchTaskAgentTrace(taskId: number): Promise<AgentTraceResponse>
```

在 `web/src/api/dashboard.ts` 或独立 `web/src/api/agentTrace.ts` 定义前端类型。为了和 dashboard 聚合保持一致，首版本可放在 `dashboard.ts`。

新增组件：

```text
web/src/components/AgentTracePanel.vue
```

如果重构任务详情：

```text
web/src/components/TaskDetailDrawer.vue
```

## 数据安全

首版本确认采用完整可见策略：

- 看板可以展示 prompt、assistant output、tool output、OpenCode session message/part。
- 看板可以展示 OpenCode reasoning、tool input/output、write file content 和 session message/part 原文。
- 适用前提是服务运行在内网或受控环境。
- 不做默认脱敏。

为了后续演进，接口和 artifact 字段保留扩展点：

```ts
visibility: "full" | "redacted";
redactionApplied?: boolean;
```

后续可通过环境变量增加：

```text
AGENT_TRACE_VISIBILITY=full|redacted|summary
```

## 错误处理

### Trace 解析失败

- 不影响评分主流程。
- 在 run artifact 中记录 `warnings`。
- API 返回 `traceAvailable=true` 但带 warning，或在完全失败时返回 `traceAvailable=false`。

### OpenCode session 无法关联

- artifact warnings 写入 `opencode_session_not_found`。
- SQLite run 的 `opencode_session_id` 为空。
- 前端仍展示 run 摘要、token、prompt 和 outputFileText，但不展示内部调用链。

### OpenCode API 不可用

- 尝试读取同一 runtime 下的 SQLite。
- 如果 runtime SQLite 被锁或不存在，本次 run 只保留摘要事件并记录 warning。
- 不影响评分主流程。

### artifact 损坏

- API 尝试回退 SQLite 摘要。
- 前端展示“完整 trace artifact 损坏，仅展示摘要”。

### SQLite 写入失败

- 不影响评分主流程。
- artifact 仍然写入。
- dashboard API 可从 artifact 读取完整 trace。

## 测试策略

### 后端单测

新增测试覆盖：

- `opencodeSessionReader` 能优先通过 `sessionId` 读取正确 session，并在 sessionId 缺失时通过 requestTag/sandboxRoot/time window 反查。
- `opencodePartParser` 能解析 message、reasoning、tool、step finish、token usage。
- retry 场景下能把同一个 OpenCode session 内的多次调用归到同一个 run 的 `attempts[]`，并按 `retryIndex` 排序。
- retry 场景下 event 能根据 attempt 时间窗口归属到对应 `traceAttemptId`；无法归属时不抛出，并记录 warning。
- trace recorder 能记录每一次 `runPrompt` 调用，包括请求失败、协议失败和最终成功 attempt，而不是只记录最终业务结果。
- parser 遇到未知 part 或不完整 session 数据不会抛出。
- `agentTraceBuilder` 能生成 run summary、event summary、tool/error/attempt 统计。
- artifact store 能写入单 run artifact 和聚合 report。
- SQLite store 能 upsert run/attempt/event，并按 taskId 查询。
- dashboard API 在 trace 存在、缺失、artifact 损坏、SQLite 摘要存在时返回正确结果。
- dashboard raw endpoints 能按需返回 run/event 原文，首屏接口不携带大 payload。

### 前端验证

首版本以人工验收为主，配合轻量数据映射测试：

- 任务详情中能切到 Agent Trace tab。
- 无 trace 时显示空状态。
- 有 trace 时展示 run 列表、事件时间线和原文详情。
- retry run 可以按 attempt 过滤事件，且失败 attempt 的 warning 可见。
- 大 payload 不撑破布局，使用滚动容器展示。

## 迁移与兼容

- SQLite schema 在 `src/storage/sqliteDatabase.ts` 初始化时新增表。
- 老任务没有 trace，API 返回 `traceAvailable=false`。
- 历史任务如果 OpenCode runtime DB 仍存在对应 session，可后续批量回填；首版本不做自动回填。
- 后续可增加 `scripts/backfillAgentTrace.ts` 读取历史 caseDir 生成 trace。

## 实施顺序

1. 定义 agent trace 类型、OpenCode session snapshot 类型和 parser。
2. 增加 OpenCode session API client，并实现同源 SQLite fallback。
3. 增加 attempt-aware trace recorder，在 OpenCode agent 每次 `runPrompt` 调用前后记录 attempt。
4. 在 OpenCode agent 调用链结束后生成单 run trace，保存 session snapshot 和规范化事件。
5. 写 artifact store，生成任务级 `outputs/agent-trace.json`。
6. 增加 SQLite 表和 store，写入 run/attempt/event 摘要。
7. 增加 dashboard summary API 和 raw endpoints。
8. 增加前端 `AgentTracePanel`。
9. 将 panel 接入任务详情 Drawer。
10. 补充测试和人工验收。

## 验收标准

- 完成一次评分任务后，caseDir 中存在 `outputs/agent-trace.json`。
- dashboard 任务详情中可以打开 `Agent Trace` tab。
- 至少能看到 task understanding、rubric scoring、rule assessment 中实际发生的 OpenCode agent run。
- 每个 run 展示状态、session id、attempt 列表、耗时、token 和关键事件。
- retry run 的事件可以按 attempt 过滤，失败 attempt 的 warning、失败原因和 token/耗时摘要可见。
- 用户展开详情后，可以按需查看原始 prompt/output/session message 和 event rawPayload。
- 对任务 `1747` 这种样本，能展示 task-understanding 的 skill/read/write、rubric-scoring 的 read/glob/write 和 read error、rule-assessment 的 read/write。
- trace 生成失败不会导致评分任务失败。
- 老任务没有 trace 时页面展示清晰空状态。

## 后续演进

首版本稳定后，可以继续扩展：

- 从关键事件扩展到完整事件树。
- 增加过程评价规则，例如无效重试、工具失败未恢复、协议错误次数过多。
- 增加全局 Agent Trace 分析页，按 agent、case 类型、失败原因聚合。
- 增加 trace diff，用于模型或 prompt 升级后的行为漂移分析。
- 增加脱敏/权限模式。
- 接入 OpenTelemetry/OpenInference exporter，兼容外部观测平台。
