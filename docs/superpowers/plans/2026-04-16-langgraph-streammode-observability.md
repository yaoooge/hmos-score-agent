# LangGraph StreamMode 节点观测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 `LangGraph streamMode: ["updates", "custom"]` 为评分工作流增加节点级实时日志，输出节点开始、完成、失败和摘要版结果到控制台与 `logs/run.log`。

**Architecture:** 保持现有 `StateGraph` 节点顺序不变，将节点级观测拆成独立的 `workflow/observability/` 目录。`updates` 流负责节点完成后的结果摘要，`custom` 流负责节点开始与失败事件，统一由流解释器和日志器转换为中文日志。

**Tech Stack:** TypeScript、@langchain/langgraph 1.2.8、node:test、tsx、现有 `CaseLogger`

---

### Task 1: 建立节点标签与摘要规则

**Files:**
- Create: `src/workflow/observability/types.ts`
- Create: `src/workflow/observability/nodeLabels.ts`
- Create: `src/workflow/observability/nodeSummaries.ts`
- Test: `tests/workflow-node-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { getNodeLabel } from "../src/workflow/observability/nodeLabels.js";
import { summarizeNodeUpdate } from "../src/workflow/observability/nodeSummaries.js";

test("getNodeLabel returns Chinese labels for workflow nodes", () => {
  assert.equal(getNodeLabel("taskUnderstandingNode"), "任务理解");
  assert.equal(getNodeLabel("persistAndUploadNode"), "结果落盘与上传");
});

test("summarizeNodeUpdate returns concise summaries for key node updates", () => {
  assert.equal(
    summarizeNodeUpdate("taskUnderstandingNode", {
      constraintSummary: {
        explicitConstraints: ["A", "B"],
        contextualConstraints: ["C"],
        implicitConstraints: ["D", "E", "F"],
        classificationHints: ["bug"],
      },
    }),
    "explicit=2 contextual=1 implicit=3 classificationHints=1",
  );

  assert.equal(
    summarizeNodeUpdate("inputClassificationNode", {
      taskType: "bug_fix",
    }),
    "taskType=bug_fix",
  );

  assert.equal(
    summarizeNodeUpdate("agentAssistedRuleNode", {
      agentRunStatus: "success",
      agentRawOutputText: "{\"ok\":true}",
    }),
    "status=success outputLength=11",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/workflow-node-summary.test.ts`
Expected: FAIL，提示缺少 `workflow/observability` 文件或导出不存在

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/workflow/observability/types.ts
export type WorkflowNodeId =
  | "taskUnderstandingNode"
  | "inputClassificationNode"
  | "featureExtractionNode"
  | "ruleAuditNode"
  | "rubricPreparationNode"
  | "agentPromptBuilderNode"
  | "agentAssistedRuleNode"
  | "ruleMergeNode"
  | "scoringOrchestrationNode"
  | "reportGenerationNode"
  | "persistAndUploadNode";

export type WorkflowNodeUpdate = Record<string, unknown>;

// src/workflow/observability/nodeLabels.ts
import type { WorkflowNodeId } from "./types.js";

const NODE_LABELS: Record<WorkflowNodeId, string> = {
  taskUnderstandingNode: "任务理解",
  inputClassificationNode: "任务分类",
  featureExtractionNode: "特征提取",
  ruleAuditNode: "规则审计",
  rubricPreparationNode: "评分基线准备",
  agentPromptBuilderNode: "Agent 提示组装",
  agentAssistedRuleNode: "Agent 辅助判定",
  ruleMergeNode: "规则结果合并",
  scoringOrchestrationNode: "评分编排",
  reportGenerationNode: "报告生成",
  persistAndUploadNode: "结果落盘与上传",
};

export function getNodeLabel(nodeId: WorkflowNodeId): string {
  return NODE_LABELS[nodeId];
}

// src/workflow/observability/nodeSummaries.ts
import type { WorkflowNodeId, WorkflowNodeUpdate } from "./types.js";

function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function summarizeNodeUpdate(nodeId: WorkflowNodeId, update: WorkflowNodeUpdate): string {
  switch (nodeId) {
    case "taskUnderstandingNode": {
      const summary = update.constraintSummary as {
        explicitConstraints?: string[];
        contextualConstraints?: string[];
        implicitConstraints?: string[];
        classificationHints?: string[];
      };
      return `explicit=${lengthOf(summary?.explicitConstraints)} contextual=${lengthOf(summary?.contextualConstraints)} implicit=${lengthOf(summary?.implicitConstraints)} classificationHints=${lengthOf(summary?.classificationHints)}`;
    }
    case "inputClassificationNode":
      return `taskType=${String(update.taskType ?? "")}`;
    case "agentAssistedRuleNode":
      return `status=${String(update.agentRunStatus ?? "")} outputLength=${String(String(update.agentRawOutputText ?? "").length)}`;
    default:
      return "summary=unavailable";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/workflow-node-summary.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/observability/types.ts src/workflow/observability/nodeLabels.ts src/workflow/observability/nodeSummaries.ts tests/workflow-node-summary.test.ts
git commit -m "test: define workflow node labels and summaries"
```

### Task 2: 实现流事件解释器与日志器

**Files:**
- Create: `src/workflow/observability/workflowStreamInterpreter.ts`
- Create: `src/workflow/observability/workflowEventLogger.ts`
- Modify: `src/io/caseLogger.ts`
- Test: `tests/workflow-stream-interpreter.test.ts`
- Test: `tests/workflow-event-logger.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { interpretStreamChunk } from "../src/workflow/observability/workflowStreamInterpreter.js";
import { WorkflowEventLogger } from "../src/workflow/observability/workflowEventLogger.js";

test("interpretStreamChunk maps custom and updates chunks into workflow events", () => {
  const started = interpretStreamChunk(["custom", { event: "node_started", nodeId: "taskUnderstandingNode" }]);
  const completed = interpretStreamChunk([
    "updates",
    { taskUnderstandingNode: { constraintSummary: { explicitConstraints: ["A"], contextualConstraints: [], implicitConstraints: [], classificationHints: [] } } },
  ]);

  assert.deepEqual(started, {
    level: "info",
    type: "node_started",
    nodeId: "taskUnderstandingNode",
    label: "任务理解",
  });
  assert.deepEqual(completed, {
    level: "info",
    type: "node_completed",
    nodeId: "taskUnderstandingNode",
    label: "任务理解",
    summary: "explicit=1 contextual=0 implicit=0 classificationHints=0",
  });
});

test("WorkflowEventLogger writes Chinese workflow event lines", async () => {
  const lines: string[] = [];
  const logger = new WorkflowEventLogger({
    info: async (message: string) => void lines.push(`INFO ${message}`),
    error: async (message: string) => void lines.push(`ERROR ${message}`),
  });

  await logger.log({
    level: "error",
    type: "node_failed",
    nodeId: "agentAssistedRuleNode",
    label: "Agent 辅助判定",
    errorMessage: "Agent 调用失败",
  });

  assert.deepEqual(lines, [
    "ERROR 节点失败 node=agentAssistedRuleNode label=Agent 辅助判定 error=Agent 调用失败",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/workflow-stream-interpreter.test.ts tests/workflow-event-logger.test.ts`
Expected: FAIL，提示解释器或日志器文件不存在

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/workflow/observability/workflowStreamInterpreter.ts
import { getNodeLabel } from "./nodeLabels.js";
import { summarizeNodeUpdate } from "./nodeSummaries.js";
import type { WorkflowNodeId } from "./types.js";

type StreamChunk = [string, unknown];

export function interpretStreamChunk(chunk: StreamChunk) {
  const [mode, payload] = chunk;
  if (mode === "custom") {
    const event = payload as { event: "node_started" | "node_failed"; nodeId: WorkflowNodeId; errorMessage?: string };
    return {
      level: event.event === "node_failed" ? ("error" as const) : ("info" as const),
      type: event.event,
      nodeId: event.nodeId,
      label: getNodeLabel(event.nodeId),
      errorMessage: event.errorMessage,
    };
  }

  if (mode === "updates") {
    const entries = Object.entries(payload as Record<string, Record<string, unknown>>);
    const [nodeId, update] = entries[0] as [WorkflowNodeId, Record<string, unknown>];
    return {
      level: "info" as const,
      type: "node_completed" as const,
      nodeId,
      label: getNodeLabel(nodeId),
      summary: summarizeNodeUpdate(nodeId, update),
    };
  }

  return undefined;
}

// src/workflow/observability/workflowEventLogger.ts
type BaseLogger = {
  info(message: string): Promise<void>;
  error(message: string): Promise<void>;
};

export class WorkflowEventLogger {
  constructor(private readonly logger: BaseLogger) {}

  async log(event: {
    level: "info" | "error";
    type: "node_started" | "node_completed" | "node_failed";
    nodeId: string;
    label: string;
    summary?: string;
    errorMessage?: string;
  }): Promise<void> {
    if (event.type === "node_started") {
      await this.logger.info(`节点开始 node=${event.nodeId} label=${event.label}`);
      return;
    }
    if (event.type === "node_completed") {
      await this.logger.info(`节点完成 node=${event.nodeId} label=${event.label} summary=${event.summary ?? ""}`.trimEnd());
      return;
    }
    await this.logger.error(`节点失败 node=${event.nodeId} label=${event.label} error=${event.errorMessage ?? "unknown"}`);
  }
}

// src/io/caseLogger.ts
export type LogWriter = {
  info(message: string): Promise<void>;
  error(message: string): Promise<void>;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/workflow-stream-interpreter.test.ts tests/workflow-event-logger.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/observability/workflowStreamInterpreter.ts src/workflow/observability/workflowEventLogger.ts src/io/caseLogger.ts tests/workflow-stream-interpreter.test.ts tests/workflow-event-logger.test.ts
git commit -m "feat: add workflow stream event interpretation"
```

### Task 3: 为节点补充 `custom` 事件发射

**Files:**
- Modify: `src/nodes/taskUnderstandingNode.ts`
- Modify: `src/nodes/inputClassificationNode.ts`
- Modify: `src/nodes/featureExtractionNode.ts`
- Modify: `src/nodes/ruleAuditNode.ts`
- Modify: `src/nodes/rubricPreparationNode.ts`
- Modify: `src/nodes/agentPromptBuilderNode.ts`
- Modify: `src/nodes/agentAssistedRuleNode.ts`
- Modify: `src/nodes/ruleMergeNode.ts`
- Modify: `src/nodes/scoringOrchestrationNode.ts`
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `src/nodes/persistAndUploadNode.ts`
- Test: `tests/workflow-custom-events.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { taskUnderstandingNode } from "../src/nodes/taskUnderstandingNode.js";

test("taskUnderstandingNode emits custom start and failure events through LangGraph writer", async () => {
  const events: Array<Record<string, unknown>> = [];
  const originalPrompt = "修复页面 bug";

  const result = await taskUnderstandingNode(
    {
      caseInput: {
        caseId: "case-1",
        promptText: originalPrompt,
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      originalPromptText: originalPrompt,
    } as never,
    {
      writer: (chunk: Record<string, unknown>) => events.push(chunk),
    } as never,
  );

  assert.equal(events[0]?.event, "node_started");
  assert.equal(events[0]?.nodeId, "taskUnderstandingNode");
  assert.ok(result.constraintSummary);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/workflow-custom-events.test.ts`
Expected: FAIL，提示节点函数不接受 writer/config 或未发出事件

- [ ] **Step 3: Write minimal implementation**

```typescript
// 以 taskUnderstandingNode 为模板，其余节点同样接入
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { getWriter } from "@langchain/langgraph";

function emitNodeStarted(nodeId: string, config?: LangGraphRunnableConfig): void {
  const writer = config ? getWriter(config) : undefined;
  writer?.({ event: "node_started", nodeId });
}

function emitNodeFailed(nodeId: string, error: unknown, config?: LangGraphRunnableConfig): void {
  const writer = config ? getWriter(config) : undefined;
  writer?.({
    event: "node_failed",
    nodeId,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

export async function taskUnderstandingNode(state: ScoreGraphState, config?: LangGraphRunnableConfig): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("taskUnderstandingNode", config);
  try {
    return {
      constraintSummary: extractConstraintSummary(state.originalPromptText),
    };
  } catch (error) {
    emitNodeFailed("taskUnderstandingNode", error, config);
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/workflow-custom-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/nodes/taskUnderstandingNode.ts src/nodes/inputClassificationNode.ts src/nodes/featureExtractionNode.ts src/nodes/ruleAuditNode.ts src/nodes/rubricPreparationNode.ts src/nodes/agentPromptBuilderNode.ts src/nodes/agentAssistedRuleNode.ts src/nodes/ruleMergeNode.ts src/nodes/scoringOrchestrationNode.ts src/nodes/reportGenerationNode.ts src/nodes/persistAndUploadNode.ts tests/workflow-custom-events.test.ts
git commit -m "feat: emit custom workflow node events"
```

### Task 4: 将工作流执行改成 `streamMode: ["updates", "custom"]`

**Files:**
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `src/workflow/observability/types.ts`
- Modify: `src/workflow/observability/workflowStreamInterpreter.ts`
- Modify: `src/workflow/observability/workflowEventLogger.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("runScoreWorkflow streams node lifecycle logs into run.log", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, { promptText: "请修复餐厅列表页中的 bug", withPatch: true });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  const logText = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");
  assert.match(logText, /节点开始 node=taskUnderstandingNode label=任务理解/);
  assert.match(logText, /节点完成 node=inputClassificationNode label=任务分类 summary=taskType=bug_fix/);
  assert.match(logText, /节点完成 node=scoringOrchestrationNode label=评分编排 summary=totalScore=/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/score-agent.test.ts`
Expected: FAIL，日志中缺少节点级开始/完成摘要

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/workflow/scoreWorkflow.ts
import { type StreamMode } from "@langchain/langgraph";
import { WorkflowEventLogger } from "./observability/workflowEventLogger.js";
import { interpretStreamChunk } from "./observability/workflowStreamInterpreter.js";

const STREAM_MODE: StreamMode[] = ["updates", "custom"];

const stream = await graph.stream(
  {
    caseInput: input.caseInput,
    caseDir: input.caseDir,
    originalPromptText: input.caseInput.promptText,
  },
  { streamMode: STREAM_MODE },
);

let finalState: Record<string, unknown> | undefined;
const workflowLogger = new WorkflowEventLogger(logger);

for await (const chunk of stream) {
  const interpreted = interpretStreamChunk(chunk as [string, unknown]);
  if (interpreted) {
    await workflowLogger.log(interpreted);
  }
  if (Array.isArray(chunk) && chunk[0] === "updates") {
    finalState = { ...(finalState ?? {}), ...(Object.values(chunk[1] as Record<string, Record<string, unknown>>)[0] ?? {}) };
  }
}

return finalState as Record<string, unknown>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/scoreWorkflow.ts src/workflow/observability/types.ts src/workflow/observability/workflowStreamInterpreter.ts src/workflow/observability/workflowEventLogger.ts tests/score-agent.test.ts
git commit -m "feat: stream workflow node observability logs"
```

### Task 5: 补全摘要规则与回归验证

**Files:**
- Modify: `src/workflow/observability/nodeSummaries.ts`
- Modify: `tests/workflow-node-summary.test.ts`
- Modify: `tests/score-agent.test.ts`
- Modify: `tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
test("summarizeNodeUpdate covers scoring and persistence nodes", () => {
  assert.equal(
    summarizeNodeUpdate("scoringOrchestrationNode", {
      scoreComputation: {
        totalScore: 78,
        hardGateTriggered: false,
        risks: [{ level: "medium", title: "x", description: "y", evidence: "z" }],
        humanReviewItems: [{ item: "A", current_assessment: "B", uncertainty_reason: "C", suggested_focus: "D" }],
      },
    }),
    "totalScore=78 hardGate=false risks=1 reviewItems=1",
  );

  assert.equal(
    summarizeNodeUpdate("persistAndUploadNode", {
      uploadMessage: "未配置 UPLOAD_ENDPOINT，已跳过上传。",
    }),
    "upload=skipped",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/workflow-node-summary.test.ts`
Expected: FAIL，提示剩余节点摘要未覆盖或格式不匹配

- [ ] **Step 3: Write minimal implementation**

```typescript
case "scoringOrchestrationNode": {
  const score = update.scoreComputation as {
    totalScore?: number;
    hardGateTriggered?: boolean;
    risks?: unknown[];
    humanReviewItems?: unknown[];
  };
  return `totalScore=${String(score?.totalScore ?? 0)} hardGate=${String(Boolean(score?.hardGateTriggered))} risks=${lengthOf(score?.risks)} reviewItems=${lengthOf(score?.humanReviewItems)}`;
}
case "persistAndUploadNode": {
  const uploadMessage = String(update.uploadMessage ?? "");
  const status = uploadMessage.includes("跳过") ? "skipped" : uploadMessage ? "success" : "failed";
  return `upload=${status}`;
}
```

- [ ] **Step 4: Run full verification**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/observability/nodeSummaries.ts tests/workflow-node-summary.test.ts tests/score-agent.test.ts tests/interactive-launcher.test.ts
git commit -m "test: complete workflow observability summaries"
```
