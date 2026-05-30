# Agent Trace Step 耗时口径修正设计

日期：2026-05-29

## 背景

当前评测任务详情中的 `Agent Trace` tab 会展示每个 OpenCode agent run 的总耗时，以及按 step 分组后的每轮耗时。用户在查看用例评测列表时，会自然地把每轮 step 耗时相加并与 run 总耗时对比。但在真实任务中，两者可能相差很大，容易让人误判为 trace 数据丢失、页面计算错误或 agent 卡顿不可解释。

已用线上任务 `taskId=1933` 验证，任务名称为“博物馆元服务新增个人资料编辑页面的功能”，最终评分 `97`，状态 `completed`。该任务的 trace 现象如下：

| Agent | run 总耗时 | 当前页面 step 合计 | 当前差值 | 用 raw timestamp 重算 step 合计 | 剩余差值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `hmos-rule-assessment` | `364.4s` | `107.3s` | `257.1s` | `315.1s` | `49.2s` |
| `hmos-rubric-scoring` | `609.8s` | `5.8s` | `604.0s` | `366.5s` | `243.3s` |

进一步检查 raw event 后确认：

- OpenCode raw event 中已有顶层 `timestamp` 字段，例如 `timestamp: 1780044437015`。
- 当前 `src/agentTrace/opencodePartParser.ts` 的 `readTimestampMs()` 没有读取 `timestamp`。
- 前端 `web/src/components/AgentTracePanel.vue` 的 `stepDuration()` 在拿不到 `timestampMs` 时，退回到累计 event `elapsedMs`。
- event `elapsedMs` 主要来自 tool/text part，自身不覆盖完整 step 生命周期，所以当前页面 step 耗时被明显低估。
- 即使用 raw timestamp 重算 step-start 到 step-finish，step 合计仍不会等于 run 总耗时，因为 run 总耗时是整次 OpenCode 调用墙钟时间，包含 Step 间模型处理、启动、收尾和 OpenCode 内部等待。

因此，本问题的最小修正不是新增完整 timing 模型，而是把现有 raw 数据中的 `timestamp` 正确解析出来，并把 UI 文案讲清楚。

## 目标

- 修正 OpenCode raw event 的 `timestamp` 解析，让 step 耗时优先使用 `step-start` 到 `step-finish` 的墙钟区间。
- 兼容历史 trace artifact：旧 artifact 即使没有 `event.timestampMs`，也能从 `event.rawPayload.timestamp` 在接口响应时补齐。
- 前端继续使用现有 step 分组结构，但避免把 tool/text part 的 `elapsedMs` 合计误当成完整 step 耗时。
- 前端在相邻 step 之间显示可计算的 `Step 间模型处理`，即前一个 `step-finish.timestampMs` 到后一个 `step-start.timestampMs` 的时间差。
- 前端展示每个 step 可取得的 token usage，并在 `Step 间模型处理` 行展示相邻 step 之间 assistant message / 下一 step-finish 可取得的 token usage，说明这段时间不是空白等待。
- 在页面上明确说明：run 总耗时和 step 耗时不是同一口径，step 合计不保证等于 run 总耗时。
- 用 `taskId=1933` 的数据形态建立回归测试，防止再次出现 `rubric-scoring` step 合计只有几秒的低估问题。

## 非目标

- 不新增 `AgentTraceTimingSummary`、timing segments 或新的 trace 数据模型。
- 不新增 SQLite 字段或表。
- 不做 stacked bar 或复杂耗时可视化；本次只做相邻 step 之间的轻量模型处理行。
- 不新增 token 差分模型，也不把 OpenCode 提供的累计 token 强行拆成严格增量。
- 不把 step 耗时强行补齐到 run 总耗时。
- 不重跑历史任务或批量改写旧 artifact。
- 不在本次设计中做 agent 性能优化。

## 已有数据口径

### Run 总耗时

来源：`AgentTraceRun.elapsedMs` / `AgentTraceAttempt.elapsedMs`。

当前由 `src/opencode/opencodeCliRunner.ts` 在 OpenCode 调用完成时计算：

```ts
const elapsedMs = Date.now() - startedAt;
```

含义：一次 OpenCode CLI 调用的完整墙钟时间，从 runner 开始调用到 OpenCode 输出完成、runner 读取输出文件并返回结果。

包含：

- OpenCode CLI 启动和连接 runtime。
- 模型等待和推理。
- tool 调用。
- step 之间的等待或 OpenCode 内部调度。
- 最终写 output file。
- runner 读取 output file、解析 stdout、返回结果。

这个字段不是所有 step 耗时之和。

### Event / Tool / Text 耗时

来源：单个 event 的 `elapsedMs`。

示例：

```json
{
  "type": "tool",
  "elapsedMs": 14,
  "toolName": "read"
}
```

```json
{
  "type": "text",
  "elapsedMs": 98179
}
```

含义：单个 OpenCode part 自己的局部耗时。tool 的 `elapsedMs` 通常只是文件读取、grep、write 等工具实际执行时间；text 的 `elapsedMs` 是某段文本输出耗时。

这个字段可以作为 step 内事件明细展示，但不应作为 step 总耗时的首选来源。

### Raw Event Timestamp

来源：`AgentTraceEvent.rawPayload.timestamp`。

示例：

```json
{
  "type": "step_start",
  "timestamp": 1780044437015,
  "part": {
    "id": "prt_e72ea96150019GbCw12R0LO45L",
    "type": "step-start"
  }
}
```

含义：OpenCode raw event 的墙钟时间戳，单位为毫秒。现有 artifact 已经保存这个字段，只是当前 parser 没有读入 `AgentTraceEvent.timestampMs`。

它可以直接用于计算完整 step 的耗时：

```text
step-finish.timestamp - step-start.timestamp
```

## 现有数据能算出的 step 耗时

对每个 run，按事件顺序配对：

```text
step-start.timestamp -> step-finish.timestamp
```

即可得到每个完整 step 的墙钟耗时。

`taskId=1933` 的 `hmos-rule-assessment` 可重算结果：

| Step | finish reason | step-start 到 step-finish |
| ---: | --- | ---: |
| 1 | tool-calls | `2.526s` |
| 2 | tool-calls | `1.216s` |
| 3 | tool-calls | `12.753s` |
| 4 | tool-calls | `185.424s` |
| 5 | tool-calls | `113.017s` |
| 6 | stop | `0.190s` |
| 合计 | | `315.126s` |

该 run 总耗时是 `364.369s`，剩余约 `49.243s` 主要来自 step 之间的间隔和启动/收尾。

`taskId=1933` 的 `hmos-rubric-scoring` 可重算结果：

| Step | finish reason | step-start 到 step-finish |
| ---: | --- | ---: |
| 1 | tool-calls | `2.705s` |
| 2 | tool-calls | `1.553s` |
| 3 | tool-calls | `5.774s` |
| 4 | tool-calls | `2.788s` |
| 5 | tool-calls | `8.895s` |
| 6 | tool-calls | `3.926s` |
| 7 | tool-calls | `2.124s` |
| 8 | tool-calls | `1.990s` |
| 9 | tool-calls | `4.648s` |
| 10 | tool-calls | `4.307s` |
| 11 | tool-calls | `315.918s` |
| 12 | tool-calls | `11.815s` |
| 13 | tool-calls | `0.061s` |
| 合计 | | `366.504s` |

该 run 总耗时是 `609.847s`，剩余约 `243.343s`。从现有 timestamp 还能看出，这部分主要来自 step-finish 到下一次 step-start 的间隔，其中最大一段约 `152.077s`。这段不属于任何完整 step，但属于 run 总耗时。

另外，`hmos-rubric-scoring` 最后有一个 `step-start`，但没有对应 `step-finish`。这类未闭合 step 不应被强算成完整 step，只能标记为缺少完整耗时。

## 推荐方案

采用最小闭环方案：

1. 后端 parser 补读 OpenCode raw event 顶层 `timestamp`。
2. Dashboard 读取历史 artifact 时，从 `rawPayload.timestamp` 补齐 `event.timestampMs`。
3. 前端 `stepDuration()` 优先使用同一 step 内的 `step-start.timestampMs` 和 `step-finish.timestampMs`。
4. 前端保留 event `elapsedMs` 合计作为最后 fallback，并在缺少 timestamp 时显示“估算”。
5. 前端在相邻 step 之间插入轻量 `Step 间模型处理` 行，显示 `前一 step-finish -> 后一 step-start` 的时间差。
6. 前端从已有 `tokens` 字段读取 token usage：step 使用 `step-finish.tokenUsage`，step 间模型处理优先使用夹在两个 step 之间的 assistant message token usage，缺少 message 时使用下一 step-finish 上相同模型回合的 token usage。
7. 前端增加一句口径说明，并可显示简单差值：

```text
Step 耗时为可观测 step-start 到 step-finish 区间；Run 总耗时包含 Step 间模型处理、启动和收尾，因此不保证相等。
```

这个方案不新增数据模型，不改 SQLite，不需要批量迁移历史产物；token 只展示现有 OpenCode token usage，不做重新归因。

## 后端设计

### 1. Parser 读取 timestamp

修改 `src/agentTrace/opencodePartParser.ts`：

```ts
function readTimestampMs(record: Record<string, unknown> | undefined): number | undefined {
  if (!record) {
    return undefined;
  }
  return (
    readFiniteNumber(record.timestampMs) ??
    readFiniteNumber(record.createdAtMs) ??
    readFiniteNumber(record.created_at_ms) ??
    readFiniteNumber(record.timestamp) ??
    readFiniteNumber(record.created) ??
    readFiniteNumber(record.time)
  );
}
```

字段优先级说明：

- `timestampMs` 是内部规范字段，优先保留。
- `createdAtMs` / `created_at_ms` 保持已有兼容。
- `timestamp` 是当前 OpenCode raw event 的关键字段。
- `created` / `time` 保持旧逻辑。

### 2. Dashboard 响应补齐旧 artifact timestampMs

修改 `src/dashboard/dashboardDataStore.ts` 的 `summarizeAgentTraceReport()`。

当前逻辑会在返回前删除 `event.rawPayload`，但历史 artifact 中的 timestamp 只在 rawPayload 里。因此需要先补齐 `timestampMs`：

```ts
function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readRawTimestampMs(eventRecord: Record<string, unknown>): number | undefined {
  const rawPayload = asMutableRecord(eventRecord.rawPayload);
  return readFiniteNumber(rawPayload?.timestamp);
}
```

在 event summary 处理中增加：

```ts
if (eventRecord.timestampMs === undefined) {
  const rawTimestampMs = readRawTimestampMs(eventRecord);
  if (rawTimestampMs !== undefined) {
    eventRecord.timestampMs = rawTimestampMs;
  }
}
```

约束：

- 只补接口响应，不写回 artifact。
- `rawPayload` 仍按现有逻辑从普通响应中删除。
- `hasRawPayload` 逻辑保持不变。

## 前端设计

修改 `web/src/components/AgentTracePanel.vue`。

### 1. Step 耗时优先使用 step-start / step-finish

当前 `stepDuration()` 逻辑会在没有 `step-finish.elapsedMs` 时使用当前分组里所有 timestamp 的最大值减最小值。建议改成更明确的顺序：

```ts
function stepDuration(events: AgentTraceEvent[]): number | undefined {
  const stepFinishElapsedMs = [...events]
    .reverse()
    .find((event) => event.type === "step-finish" && event.elapsedMs !== undefined)?.elapsedMs;
  if (stepFinishElapsedMs !== undefined) {
    return stepFinishElapsedMs;
  }

  const stepStartTimestampMs = events.find((event) => event.type === "step-start")?.timestampMs;
  const stepFinishTimestampMs = [...events]
    .reverse()
    .find((event) => event.type === "step-finish")?.timestampMs;
  if (stepStartTimestampMs !== undefined && stepFinishTimestampMs !== undefined) {
    return Math.max(0, stepFinishTimestampMs - stepStartTimestampMs);
  }

  const timestamps = events
    .map((event) => event.timestampMs)
    .filter((value): value is number => value !== undefined);
  if (timestamps.length >= 2) {
    return Math.max(0, Math.max(...timestamps) - Math.min(...timestamps));
  }

  const elapsedTotal = events.reduce((sum, event) => sum + (event.elapsedMs ?? 0), 0);
  return elapsedTotal > 0 ? elapsedTotal : undefined;
}
```

说明：

- 如果 OpenCode 后续提供 `step-finish.elapsedMs`，仍尊重明确字段。
- 当前数据主要走 `step-start.timestampMs` 到 `step-finish.timestampMs`。
- `max(timestamp) - min(timestamp)` 保留为兼容 fallback。
- event `elapsedMs` 合计只作为最后 fallback。

### 2. 简单显示未归入 step 的耗时

不新增复杂分解，只在当前 run 顶部或 step 列表上方展示一个简单汇总：

```ts
const selectedRunStepElapsedMs = computed(() => {
  return stepGroups.value.reduce((sum, step) => sum + (step.elapsedMs ?? 0), 0);
});

const selectedRunStepGapElapsedMs = computed(() => {
  return stepGaps.value.reduce((sum, gap) => sum + gap.elapsedMs, 0);
});

const selectedRunUnattributedElapsedMs = computed(() => {
  const runElapsedMs = selectedRun.value?.elapsedMs;
  if (runElapsedMs === undefined) {
    return undefined;
  }
  return Math.max(
    0,
    runElapsedMs - selectedRunStepElapsedMs.value - selectedRunStepGapElapsedMs.value,
  );
});
```

展示文案：

```text
Run 总耗时 609.8s，Step 合计 366.5s，Step 间模型处理 237.4s，未归入 5.9s
```

如果没有任何可计算的模型处理区间，则省略该项或显示 `-`。如果 `未归入` 很小，可以仍展示，保持口径一致。

### 3. 在 step 之间显示模型处理行

相邻两个完整 step 之间的模型处理耗时可以直接从 timestamp 计算：

```ts
type TraceStepGap = {
  id: string;
  afterStepId: string;
  beforeStepId: string;
  elapsedMs: number;
};

function stepStartTimestamp(step: TraceStepGroup): number | undefined {
  return step.events.find((event) => event.type === "step-start")?.timestampMs;
}

function stepFinishTimestamp(step: TraceStepGroup): number | undefined {
  return [...step.events].reverse().find((event) => event.type === "step-finish")?.timestampMs;
}

const stepGaps = computed<TraceStepGap[]>(() => {
  const gaps: TraceStepGap[] = [];
  for (let index = 0; index < stepGroups.value.length - 1; index += 1) {
    const current = stepGroups.value[index];
    const next = stepGroups.value[index + 1];
    if (!current || !next) {
      continue;
    }
    const finish = stepFinishTimestamp(current);
    const start = stepStartTimestamp(next);
    if (finish === undefined || start === undefined || start < finish) {
      continue;
    }
    gaps.push({
      id: `${current.id}:gap:${next.id}`,
      afterStepId: current.id,
      beforeStepId: next.id,
      elapsedMs: start - finish,
    });
  }
  return gaps;
});
```

展示方式：

```text
Step 11 · 区间 315.9s · tokens 12345 / out 456
↓ Step 间模型处理 152.1s · tokens 8192 / out 512 / reasoning 0
Step 12 · 区间 11.8s · tokens 8192 / out 512 / reasoning 0
```

UI 约束：

- 模型处理行只在两个 step 卡片之间显示，不作为可点击 step。
- 模型处理行使用弱视觉样式，例如细线、灰底或小号文字，避免喧宾夺主。
- 模型处理行文案固定为 `Step 间模型处理 ${formatDuration(gap.elapsedMs)}`。
- 模型处理区间为 `0ms` 时可以不显示。
- 如果任一侧 step 缺少完整 timestamp，则不显示该模型处理行。
- token usage 使用现有 `tokens` 字段展示 `tokens / out / reasoning`；没有 token usage 时不显示 token 占位。

### 4. 增加口径说明

在 step 列表上方增加一行弱提示：

```text
Step 耗时为可观测 step-start 到 step-finish 区间；Step 间模型处理为相邻 step-finish 到下一 step-start 的时间，通常包含模型生成下一条 assistant message 和决定下一次工具调用；Run 总耗时还包含启动和收尾，因此不保证与 Step 合计完全相等。
```

如果后续想更轻，可以放到 tooltip 中，但首版建议直接可见，避免用户继续误解。

### 5. 缺少 timestamp 时标记估算

首版可以不新增复杂 `durationSource` 字段。前端可用简单判断：

```ts
function hasCompleteStepTimestamp(events: AgentTraceEvent[]): boolean {
  return (
    events.some((event) => event.type === "step-start" && event.timestampMs !== undefined) &&
    events.some((event) => event.type === "step-finish" && event.timestampMs !== undefined)
  );
}
```

若某个 step 没有完整 timestamp，但仍通过 event `elapsedMs` 算出耗时，则展示：

```text
Step 3 · 估算 1.2s
```

如果没有完整 timestamp 且没有 event `elapsedMs`，仍展示 `-`。

## API 设计

现有接口保持不变：

```text
GET /dashboard/tasks/:taskId/agent-trace
```

响应结构不新增字段，只保证 `report.runs[].events[].timestampMs` 在以下场景尽量存在：

- 新运行：parser 从 raw event `timestamp` 读出 `timestampMs`。
- 旧 artifact：dashboard summarizer 从 `event.rawPayload.timestamp` 补出 `timestampMs`。

同时在现有 event 结构上透传可取得的 `tokenUsage`：

- parser 从 OpenCode `info.tokens` 或 `part.tokens` 读取。
- 旧 artifact summary 在删除 `rawPayload` 前，从 `rawPayload.tokens`、`rawPayload.part.tokens` 或 `rawPayload.info.tokens` 补齐。
- 前端只展示这些已有 token usage，不承诺它们是严格增量；其中 step 间模型处理行表示该段模型回合的可观测 token usage。

SQLite fallback 响应可能没有 rawPayload，因此无法补 timestamp。该场景继续展示 SQLite 摘要，并保留现有提示：

```text
完整 trace artifact 不存在，仅展示 SQLite 摘要
```

## 测试方案

### 后端测试

修改 `tests/agent-trace.test.ts` 或 `tests/agent-trace-dashboard-api.test.ts`。

测试 1：parser 读取顶层 timestamp。

输入 raw event：

```json
{"type":"step_start","timestamp":1780044437015,"part":{"id":"p1","type":"step-start"}}
```

断言：

- parsed event `timestampMs === 1780044437015`
- event type 为 `step-start`
- event 有 `part.tokens` 时读出 `tokenUsage`

测试 2：dashboard summary 从旧 rawPayload 补 timestampMs。

构造 artifact event：

```json
{
  "type": "step-start",
  "rawPayload": {
    "timestamp": 1780044437015,
    "part": { "type": "step-start" }
  }
}
```

断言 `/dashboard/tasks/:taskId/agent-trace` 响应：

- event 不包含 `rawPayload`
- event `hasRawPayload === true`
- event `timestampMs === 1780044437015`
- event rawPayload 中有 `tokens` 时补出 `tokenUsage`

### 前端测试

修改组件测试或新增最小纯函数测试。

测试 1：stepDuration 使用 step-start 到 step-finish。

输入：

```ts
[
  { type: "step-start", timestampMs: 1000 },
  { type: "tool", elapsedMs: 5, timestampMs: 1200 },
  { type: "step-finish", timestampMs: 3100 },
]
```

断言：

```text
stepDuration = 2100
```

不是 `5`。

测试 1.1：完整 timestamp 优先级高于 `step-finish.elapsedMs`。

输入：

```ts
[
  { type: "step-start", timestampMs: 1000 },
  { type: "step-finish", timestampMs: 11000, elapsedMs: 5 },
]
```

断言：

```text
stepDuration = 10000
```

测试 2：缺少 timestamp 时仍 fallback 到 event elapsed。

输入：

```ts
[
  { type: "step-start" },
  { type: "tool", elapsedMs: 5 },
  { type: "text", elapsedMs: 95 },
  { type: "step-finish" },
]
```

断言：

```text
stepDuration = 100
```

测试 3：相邻 step 之间计算 gap。

输入：

```ts
const steps = [
  {
    id: "step-1",
    events: [
      { type: "step-start", timestampMs: 1000 },
      { type: "step-finish", timestampMs: 2000 },
    ],
  },
  {
    id: "step-2",
    events: [
      { type: "step-start", timestampMs: 7000 },
      { type: "step-finish", timestampMs: 9000 },
    ],
  },
];
```

断言：

```text
gap after step-1 before step-2 = 5000
```

测试 4：缺少 step-finish 或下一 step-start 时不显示 gap。

输入：

```ts
const steps = [
  {
    id: "step-1",
    events: [
      { type: "step-start", timestampMs: 1000 },
    ],
  },
  {
    id: "step-2",
    events: [
      { type: "step-start", timestampMs: 7000 },
      { type: "step-finish", timestampMs: 9000 },
    ],
  },
];
```

断言：

```text
gap count = 0
```

测试 5：step token 从 `step-finish.tokenUsage` 读取。

测试 6：Step 间模型处理 token 优先读取相邻两个 step 中间的 assistant message token usage，缺少时才使用下一 step-finish 上同一模型回合的 token usage。

### 回归样本

使用 `taskId=1933` 的数据形态建立 fixture，不依赖生产接口：

- 两个 run：
  - `hmos-rule-assessment`
  - `hmos-rubric-scoring`
- event rawPayload 中保留顶层 `timestamp`。
- rubric run 包含最后一个未闭合 `step-start`。

断言：

- rule run step 合计约 `315126ms`。
- rubric run step 合计约 `366504ms`。
- rubric run Step 间模型处理合计约 `237409ms`。
- rubric run 最大 Step 间模型处理约 `152077ms`，应显示在对应两个 step 之间。
- rubric run 不再回退成约 `5841ms` 的 event elapsed 合计。

允许 `±10ms` 误差。

## 迁移与兼容

历史 artifact 分三类处理：

1. **已有 event.timestampMs**
   直接使用。

2. **没有 event.timestampMs，但 rawPayload 有 timestamp**
   在 dashboard 读取时补充 timestamp。补充只作用于响应，不写回 artifact。

3. **没有 timestamp，也没有 rawPayload**
   使用旧的 event elapsed fallback，页面显示“估算”。

不做 SQLite schema migration。

## 部署与回滚

部署步骤：

1. 后端 parser 随服务部署。
2. Dashboard summary 补 timestamp 逻辑随服务部署。
3. 前端 stepDuration 和文案随 dashboard 构建部署。
4. 部署后打开 `taskId=1933` 验证：
   - `hmos-rubric-scoring` step 合计不再约 `5.8s`，应接近 `366.5s`。
   - 页面显示 run 总耗时约 `609.8s`，step 合计约 `366.5s`，Step 间模型处理约 `237.4s`，未归入约 `5.9s`。
   - step 列表中能看到最大约 `152.1s` 的 Step 间模型处理行。
   - 页面能看到 step token 和 Step 间模型处理 token。
   - 页面有口径说明，解释 step、Step 间模型处理和 run 总耗时的关系。

回滚策略：

- 如果 parser 修改有问题，移除 `timestamp` 读取即可回到旧行为。
- 如果 dashboard 补 timestamp 有问题，关闭补齐逻辑；前端仍能 fallback 到 event elapsed。
- 不改变评分主流程和 result.json，因此回滚不影响历史评分结果。

## 验收标准

- `taskId=1933` 的 `hmos-rubric-scoring` 不再展示 step 合计约 `5.8s` 这种明显低估结果。
- step 耗时优先使用 `step-start.timestampMs` 到 `step-finish.timestampMs`。
- 相邻完整 step 之间显示可计算的 `Step 间模型处理` 行。
- 老 artifact 中 rawPayload 有 timestamp 时，接口响应能补出 `timestampMs`。
- 页面明确展示 run 总耗时、step 合计、Step 间模型处理合计和未归入耗时。
- 页面展示每个 step 的可取得 token usage，以及相邻 step 间模型处理的可取得 token usage。
- 页面说明 run 总耗时、step 耗时和 Step 间模型处理不是同一口径。
- SQLite fallback、缺少 timestamp 的历史数据仍可展示，不报错。

## 后续扩展

- 如果需要跨任务耗时瓶颈分析，再设计正式的 `AgentTraceTimingSummary` 或 SQLite 聚合字段。
- 如果 OpenCode 后续提供更明确的 step duration 或调度事件，再替换当前 timestamp 差分口径。
- 如果用户需要跨任务定位长时间模型处理，再增加 Step 间模型处理聚合排行或可视化，不纳入本次最小修正。
