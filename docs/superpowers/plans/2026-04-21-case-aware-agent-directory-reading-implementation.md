# Case-Aware Agent Directory Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-shot prompt-only agent-assisted rule evaluation flow with a first-version case-aware runner that can read the current case directory through restricted read-only tools, while keeping the existing scoring output contract unchanged.

**Architecture:** Keep the outer scoring workflow intact and directly switch the agent-assisted rule path to a new case-aware runner. The new runner uses a small LangGraph-backed tool loop around the existing `/chat/completions` client, persists bootstrap payloads and structured traces, and removes the old “single large prompt decides everything” flow instead of carrying both paths in parallel.

**Tech Stack:** TypeScript, Node.js, LangGraph, Zod, node:test, tsx

---

## File Map

- Create: `src/agent/caseToolSchemas.ts`
  Responsibility: Define the request and response schemas for all case-aware read-only tools and final-answer actions.

- Create: `src/agent/caseTools.ts`
  Responsibility: Implement `read_patch`, `list_dir`, `read_file`, `read_file_chunk`, `grep_in_files`, and `read_json` with path-scope and budget enforcement.

- Create: `src/agent/caseAwarePrompt.ts`
  Responsibility: Build the bootstrap prompt and follow-up tool-result prompts for the case-aware runner.

- Create: `src/agent/caseAwareAgentGraph.ts`
  Responsibility: Define the small LangGraph inner loop (`planner -> tool_executor -> route -> forced_finalize`) for case-aware agent turns.

- Create: `src/agent/caseAwareAgentRunner.ts`
  Responsibility: Orchestrate the inner graph, accumulate turn traces, and return the final structured agent JSON plus observability artifacts.

- Modify: `src/agent/agentClient.ts`
  Responsibility: Expose a low-level `completeJsonPrompt()` entry point and simplify rule evaluation to route through the new case-aware runner call chain.

- Modify: `src/agent/ruleAssistance.ts`
  Responsibility: Keep merge and rubric snapshot logic, but replace the old one-shot prompt payload format with bootstrap payload types and parsers for the case-aware runner.

- Modify: `src/types.ts`
  Responsibility: Replace old prompt-only agent payload types with case-aware bootstrap, turn, tool, and trace types.

- Modify: `src/nodes/agentPromptBuilderNode.ts`
  Responsibility: Build and persist the new bootstrap payload and first-turn prompt instead of the old all-in-one evaluation prompt.

- Modify: `src/nodes/agentAssistedRuleNode.ts`
  Responsibility: Call `CaseAwareAgentRunner.run()` directly and emit the new case-aware lifecycle logs.

- Modify: `src/nodes/persistAndUploadNode.ts`
  Responsibility: Persist `agent-bootstrap-payload.json`, `agent-turns.json`, and `agent-tool-trace.json` in addition to the existing agent result artifact.

- Modify: `src/workflow/state.ts`
  Responsibility: Store the new bootstrap payload, tool traces, turn traces, forced finalize reason, and runner mode in workflow state.

- Modify: `tests/agent-assisted-rule.test.ts`
  Responsibility: Update payload and merge tests to the new bootstrap schema and case-aware final-answer flow.

- Create: `tests/case-tools.test.ts`
  Responsibility: Cover each read-only tool, path-scope rejection, truncation behavior, and budget updates.

- Create: `tests/case-aware-agent-runner.test.ts`
  Responsibility: Cover multi-turn tool execution, forced finalize, invalid output retry, and final answer handling.

- Modify: `tests/score-agent.test.ts`
  Responsibility: Verify the scoring workflow persists the new artifacts, logs case-aware lifecycle events, and keeps `result.json` compatibility.

- Modify: `tests/agent-client.test.ts`
  Responsibility: Cover the new low-level `completeJsonPrompt()` entry point and keep compatibility with current HTTP behavior.

---

### Task 1: Replace Agent Payload Types With Case-Aware Bootstrap Contracts

**Files:**
- Modify: `src/types.ts`
- Modify: `src/agent/ruleAssistance.ts`
- Modify: `tests/agent-assisted-rule.test.ts`

- [ ] **Step 1: Write the failing type-and-payload tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentBootstrapPayload, renderAgentBootstrapPrompt } from "../src/agent/ruleAssistance.js";

test("buildAgentBootstrapPayload emits tool contract instead of inline evidence-only prompt", () => {
  const payload = buildAgentBootstrapPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "实现首页本地资讯定位能力",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/effective.patch",
    },
    caseRoot: "/tmp/case-root",
    effectivePatchPath: "/tmp/case-root/intermediate/effective.patch",
    taskType: "continuation",
    constraintSummary,
    rubricSnapshot,
    assistedRuleCandidates,
    initialTargetFiles: ["entry/src/main/ets/home/viewmodels/HomePageVM.ets"],
  });

  assert.equal(payload.case_context.case_root, "/tmp/case-root");
  assert.equal(payload.case_context.effective_patch_path, "/tmp/case-root/intermediate/effective.patch");
  assert.equal(payload.tool_contract.allowed_tools.includes("read_file"), true);
  assert.equal(payload.tool_contract.allowed_tools.includes("read_patch"), true);
  assert.equal(payload.response_contract.action_enum.includes("tool_call"), true);
  assert.equal(payload.response_contract.action_enum.includes("final_answer"), true);
});

test("renderAgentBootstrapPrompt instructs the model to choose tool_call or final_answer only", () => {
  const prompt = renderAgentBootstrapPrompt(sampleBootstrapPayload);

  assert.match(prompt, /你只能返回 tool_call 或 final_answer/);
  assert.match(prompt, /case 目录只读工具/);
  assert.match(prompt, /禁止输出 markdown/);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm test -- tests/agent-assisted-rule.test.ts
```

Expected:

- import failure for `buildAgentBootstrapPayload`, or
- assertion failure because old payload shape still lacks `tool_contract`, `case_root`, and `action_enum`

- [ ] **Step 3: Replace the old payload types in `src/types.ts`**

```ts
export type CaseToolName =
  | "read_patch"
  | "list_dir"
  | "read_file"
  | "read_file_chunk"
  | "grep_in_files"
  | "read_json";

export interface AgentBootstrapPayload {
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
  assisted_rule_candidates: AssistedRuleCandidate[];
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
}

export interface CaseAwareAgentFinalAnswer {
  action: "final_answer";
  summary: {
    assistant_scope: string;
    overall_confidence: "high" | "medium" | "low";
  };
  rule_assessments: AgentAssistedRuleResult["rule_assessments"];
}
```

- [ ] **Step 4: Replace the old prompt-builder entry points in `src/agent/ruleAssistance.ts`**

```ts
export function buildAgentBootstrapPayload(input: {
  caseInput: {
    caseId: string;
    promptText: string;
    originalProjectPath: string;
    generatedProjectPath: string;
    patchPath?: string;
  };
  caseRoot: string;
  effectivePatchPath?: string;
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
  assistedRuleCandidates: AssistedRuleCandidate[];
  initialTargetFiles: string[];
}): AgentBootstrapPayload {
  return {
    case_context: {
      case_id: input.caseInput.caseId,
      case_root: input.caseRoot,
      task_type: input.taskType,
      original_prompt_summary: input.caseInput.promptText,
      original_project_path: input.caseInput.originalProjectPath,
      generated_project_path: input.caseInput.generatedProjectPath,
      effective_patch_path: input.effectivePatchPath,
    },
    task_understanding: input.constraintSummary,
    rubric_summary: input.rubricSnapshot,
    assisted_rule_candidates: input.assistedRuleCandidates,
    initial_target_files: input.initialTargetFiles,
    tool_contract: {
      allowed_tools: ["read_patch", "list_dir", "read_file", "read_file_chunk", "grep_in_files", "read_json"],
      max_tool_calls: 6,
      max_total_bytes: 61440,
      max_files: 20,
    },
    response_contract: {
      action_enum: ["tool_call", "final_answer"],
      output_language: "zh-CN",
      json_only: true,
    },
  };
}

export function renderAgentBootstrapPrompt(payload: AgentBootstrapPayload): string {
  return [
    "你是评分流程中的 case-aware 辅助判定模块。",
    "你可以在受限预算内调用 case 目录只读工具来补查上下文。",
    "你只能返回 tool_call 或 final_answer 两种 JSON action。",
    "若证据不足，必须在 final_answer 中将 needs_human_review 置为 true。",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
```

- [ ] **Step 5: Re-run the targeted tests**

Run:

```bash
npm test -- tests/agent-assisted-rule.test.ts
```

Expected:

- bootstrap payload tests pass
- unrelated old one-shot prompt assertions may still fail until downstream nodes are switched

- [ ] **Step 6: Commit the payload contract switch**

```bash
git add src/types.ts src/agent/ruleAssistance.ts tests/agent-assisted-rule.test.ts
git commit -m "refactor: switch agent payload to case-aware bootstrap contract"
```

---

### Task 2: Add Failing Tests And Implement Read-Only Case Tools

**Files:**
- Create: `tests/case-tools.test.ts`
- Create: `src/agent/caseToolSchemas.ts`
- Create: `src/agent/caseTools.ts`

- [ ] **Step 1: Write the failing tool tests**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCaseToolExecutor } from "../src/agent/caseTools.js";

async function makeCaseRoot(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "case-tools-"));
  await fs.mkdir(path.join(dir, "workspace", "entry", "src", "main", "ets", "home"), { recursive: true });
  await fs.mkdir(path.join(dir, "intermediate"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "workspace", "entry", "src", "main", "ets", "home", "HomePageVM.ets"),
    "export class HomePageVM { refreshLocalNews(): void {} }\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(dir, "intermediate", "effective.patch"),
    "diff --git a/entry/src/main/ets/home/HomePageVM.ets b/entry/src/main/ets/home/HomePageVM.ets\n",
    "utf-8",
  );
  t.after(async () => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("read_file stays inside caseRoot and returns content", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({ caseRoot, maxToolCalls: 6, maxTotalBytes: 61440, maxFiles: 20 });

  const result = await executor.execute({
    tool: "read_file",
    args: { path: "workspace/entry/src/main/ets/home/HomePageVM.ets" },
  });

  assert.equal(result.ok, true);
  assert.match(String(result.result?.content ?? ""), /refreshLocalNews/);
});

test("read_file rejects path traversal", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({ caseRoot, maxToolCalls: 6, maxTotalBytes: 61440, maxFiles: 20 });

  const result = await executor.execute({
    tool: "read_file",
    args: { path: "../outside.txt" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error?.code, "path_out_of_scope");
});

test("read_patch returns effective patch content", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const executor = createCaseToolExecutor({ caseRoot, maxToolCalls: 6, maxTotalBytes: 61440, maxFiles: 20 });

  const result = await executor.execute({
    tool: "read_patch",
    args: {},
  });

  assert.equal(result.ok, true);
  assert.match(String(result.result?.content ?? ""), /diff --git/);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm test -- tests/case-tools.test.ts
```

Expected:

- `ERR_MODULE_NOT_FOUND` for `caseTools.js`

- [ ] **Step 3: Add the tool schemas**

```ts
import { z } from "zod";

export const caseToolNameSchema = z.enum([
  "read_patch",
  "list_dir",
  "read_file",
  "read_file_chunk",
  "grep_in_files",
  "read_json",
]);

export const caseToolCallSchema = z.object({
  tool: caseToolNameSchema,
  args: z.record(z.string(), z.unknown()),
});
```

- [ ] **Step 4: Implement the read-only tool executor**

```ts
export function createCaseToolExecutor(config: {
  caseRoot: string;
  maxToolCalls: number;
  maxTotalBytes: number;
  maxFiles: number;
}) {
  let usedToolCalls = 0;
  let usedBytes = 0;
  const readFiles = new Set<string>();

  return {
    async execute(call: { tool: CaseToolName; args: Record<string, unknown> }) {
      if (usedToolCalls >= config.maxToolCalls) {
        return { ok: false, error: { code: "tool_budget_exceeded", message: "tool call budget exceeded" } };
      }

      usedToolCalls += 1;
      return runCaseTool({
        caseRoot: config.caseRoot,
        call,
        onBytes(bytes) {
          usedBytes += bytes;
        },
        onFile(path) {
          readFiles.add(path);
        },
        getBudget() {
          return {
            usedToolCalls,
            usedBytes,
            readFileCount: readFiles.size,
            remainingToolCalls: config.maxToolCalls - usedToolCalls,
            remainingBytes: config.maxTotalBytes - usedBytes,
          };
        },
      });
    },
  };
}
```

- [ ] **Step 5: Re-run the targeted tests**

Run:

```bash
npm test -- tests/case-tools.test.ts
```

Expected:

- all case tool tests pass

- [ ] **Step 6: Commit the case tool layer**

```bash
git add src/agent/caseToolSchemas.ts src/agent/caseTools.ts tests/case-tools.test.ts
git commit -m "feat: add case-aware read-only tools"
```

---

### Task 3: Add A Failing Multi-Turn Runner Test And Implement The Inner Agent Loop

**Files:**
- Create: `tests/case-aware-agent-runner.test.ts`
- Create: `src/agent/caseAwarePrompt.ts`
- Create: `src/agent/caseAwareAgentGraph.ts`
- Create: `src/agent/caseAwareAgentRunner.ts`
- Modify: `src/agent/agentClient.ts`

- [ ] **Step 1: Write the failing runner tests**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCaseAwareAgent } from "../src/agent/caseAwareAgentRunner.js";

test("case-aware runner performs a tool_call before emitting final_answer", async (t) => {
  const caseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-aware-runner-"));
  await fs.mkdir(path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "home"), { recursive: true });
  await fs.mkdir(path.join(caseRoot, "intermediate"), { recursive: true });
  await fs.writeFile(
    path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "home", "HomePageVM.ets"),
    "export class HomePageVM { updateLocalNews(): void {} }\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseRoot, "intermediate", "effective.patch"),
    "diff --git a/entry/src/main/ets/home/HomePageVM.ets b/entry/src/main/ets/home/HomePageVM.ets\n",
    "utf-8",
  );
  t.after(async () => fs.rm(caseRoot, { recursive: true, force: true }));

  const outputs = [
    JSON.stringify({
      action: "tool_call",
      tool: "read_file",
      args: { path: "workspace/entry/src/main/ets/home/HomePageVM.ets" },
      reason: "需要确认是否更新本地资讯状态",
    }),
    JSON.stringify({
      action: "final_answer",
      summary: {
        assistant_scope: "本次仅辅助候选规则判定",
        overall_confidence: "medium",
      },
      rule_assessments: [
        {
          rule_id: "HM-REQ-010-03",
          decision: "pass",
          confidence: "medium",
          reason: "已看到本地资讯更新逻辑。",
          evidence_used: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
          needs_human_review: false,
        },
      ],
    }),
  ];

  const result = await runCaseAwareAgent({
    caseRoot,
    bootstrapPayload: sampleBootstrapPayload,
    completeJsonPrompt: async () => outputs.shift() ?? "",
  });

  assert.equal(result.turns.length, 2);
  assert.equal(result.toolTrace.length, 1);
  assert.equal(result.finalAnswer?.action, "final_answer");
});

test("case-aware runner forces finalize after invalid model output retry exhaustion", async () => {
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: sampleBootstrapPayload,
    completeJsonPrompt: async () => "not-json",
  });

  assert.equal(result.status, "invalid_output");
  assert.equal(result.forcedFinalizeReason, "invalid_model_output");
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm test -- tests/case-aware-agent-runner.test.ts
```

Expected:

- `ERR_MODULE_NOT_FOUND` for `caseAwareAgentRunner.js`

- [ ] **Step 3: Add a low-level completion entry point in `src/agent/agentClient.ts`**

```ts
export interface AgentClient {
  completeJsonPrompt(prompt: string): Promise<string>;
  understandTask(input: TaskUnderstandingAgentInput): Promise<string>;
}

export class ChatModelClient implements AgentClient {
  async completeJsonPrompt(prompt: string): Promise<string> {
    const requestBody = {
      model: this.options.model,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    };
    let response = await this.requestCompletion(requestBody);
    if (this.shouldRetryWithoutStructuredOutput(response)) {
      const { response_format: _ignored, ...fallbackBody } = requestBody;
      response = await this.requestCompletion(fallbackBody);
    }
    return this.extractMessageContent(response);
  }

  async understandTask(input: TaskUnderstandingAgentInput): Promise<string> {
    return this.completeJsonPrompt(renderTaskUnderstandingPrompt(input));
  }
}
```

- [ ] **Step 4: Implement the case-aware runner and graph**

```ts
export async function runCaseAwareAgent(input: {
  caseRoot: string;
  bootstrapPayload: AgentBootstrapPayload;
  completeJsonPrompt: (prompt: string) => Promise<string>;
}) {
  const executor = createCaseToolExecutor({
    caseRoot: input.caseRoot,
    maxToolCalls: input.bootstrapPayload.tool_contract.max_tool_calls,
    maxTotalBytes: input.bootstrapPayload.tool_contract.max_total_bytes,
    maxFiles: input.bootstrapPayload.tool_contract.max_files,
  });

  const turns: CaseAwareAgentTurn[] = [];
  const toolTrace: CaseToolTraceItem[] = [];
  let forcedFinalizeReason: string | undefined;

  for (let turn = 1; turn <= input.bootstrapPayload.tool_contract.max_tool_calls + 1; turn += 1) {
    const prompt =
      turn === 1
        ? renderCaseAwareBootstrapPrompt(input.bootstrapPayload)
        : renderCaseAwareFollowupPrompt({ bootstrapPayload: input.bootstrapPayload, turns, toolTrace });
    const raw = await input.completeJsonPrompt(prompt);
    const decision = parseCaseAwarePlannerOutput(raw);

    if (decision.action === "final_answer") {
      turns.push({ turn, action: "final_answer", status: "success", raw_output_text: raw });
      return { status: "success", turns, toolTrace, finalAnswer: decision, forcedFinalizeReason };
    }

    const toolResult = await executor.execute({ tool: decision.tool, args: decision.args });
    toolTrace.push({
      turn,
      tool: decision.tool,
      args: decision.args,
      ok: toolResult.ok,
      error_code: toolResult.error?.code,
      paths_read: toolResult.pathsRead ?? [],
      bytes_returned: toolResult.bytesReturned ?? 0,
      truncated: Boolean(toolResult.result?.truncated),
      budget_after_call: toolResult.budget,
    });
    turns.push({ turn, action: "tool_call", tool: decision.tool, status: toolResult.ok ? "success" : "error", raw_output_text: raw });

    if (!toolResult.ok && toolResult.error?.code === "tool_budget_exceeded") {
      forcedFinalizeReason = "tool_budget_exceeded";
      break;
    }
  }

  return {
    status: "invalid_output",
    turns,
    toolTrace,
    finalAnswer: undefined,
    forcedFinalizeReason: forcedFinalizeReason ?? "invalid_model_output",
  };
}
```

- [ ] **Step 5: Re-run the targeted tests**

Run:

```bash
npm test -- tests/case-aware-agent-runner.test.ts tests/agent-client.test.ts
```

Expected:

- case-aware runner tests pass
- agent client tests pass with the new low-level completion method

- [ ] **Step 6: Commit the runner implementation**

```bash
git add src/agent/agentClient.ts src/agent/caseAwarePrompt.ts src/agent/caseAwareAgentGraph.ts src/agent/caseAwareAgentRunner.ts tests/case-aware-agent-runner.test.ts tests/agent-client.test.ts
git commit -m "feat: add case-aware agent runner"
```

---

### Task 4: Switch Nodes To The New Runner And Remove The Old One-Shot Evaluation Path

**Files:**
- Modify: `src/workflow/state.ts`
- Modify: `src/nodes/agentPromptBuilderNode.ts`
- Modify: `src/nodes/agentAssistedRuleNode.ts`

- [ ] **Step 1: Write the failing workflow-facing assertions**

```ts
assert.equal(result.agentPromptPayload?.tool_contract?.allowed_tools.includes("read_file"), true);
assert.equal(result.agentPromptText?.includes("你只能返回 tool_call 或 final_answer"), true);
assert.equal(result.agentRunStatus, "success");
```

Add them to:

```ts
tests/score-agent.test.ts
```

inside the workflow test that already persists `inputs/agent-prompt-payload.json`.

- [ ] **Step 2: Run the targeted workflow tests to verify they fail**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected:

- payload-shape assertion failures because the old prompt builder still emits the one-shot format

- [ ] **Step 3: Extend workflow state for the new runner artifacts**

```ts
agentBootstrapPayload: Annotation<AgentBootstrapPayload>(),
agentToolTrace: Annotation<CaseToolTraceItem[]>(),
agentTurns: Annotation<CaseAwareAgentTurn[]>(),
forcedFinalizeReason: Annotation<string>(),
agentRunnerMode: Annotation<"case_aware">(),
```

- [ ] **Step 4: Replace the prompt builder output with bootstrap data**

```ts
const initialTargetFiles = Array.from(
  new Set(
    assistedRuleCandidates.flatMap((candidate) => candidate.evidence_files).slice(0, 20),
  ),
);
const payload = buildAgentBootstrapPayload({
  caseInput: state.caseInput,
  caseRoot: state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath),
  effectivePatchPath: state.effectivePatchPath,
  taskType: state.taskType,
  constraintSummary: state.constraintSummary,
  rubricSnapshot: state.rubricSnapshot,
  assistedRuleCandidates,
  initialTargetFiles,
});
const prompt = renderAgentBootstrapPrompt(payload);
```

- [ ] **Step 5: Replace the node call site with the new runner**

```ts
const runnerResult = await runCaseAwareAgent({
  caseRoot: state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath),
  bootstrapPayload: state.agentBootstrapPayload,
  completeJsonPrompt: (prompt) => deps.agentClient!.completeJsonPrompt(prompt),
  logger: deps.logger,
});

return {
  agentRunnerMode: "case_aware",
  agentRunStatus: runnerResult.status,
  agentRawOutputText: runnerResult.finalAnswerRawText ?? "",
  agentTurns: runnerResult.turns,
  agentToolTrace: runnerResult.toolTrace,
  forcedFinalizeReason: runnerResult.forcedFinalizeReason,
};
```

- [ ] **Step 6: Re-run the targeted workflow tests**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected:

- new payload and state assertions pass
- persistence assertions may still fail until artifacts are written in the next task

- [ ] **Step 7: Commit the direct switch to the new runner**

```bash
git add src/workflow/state.ts src/nodes/agentPromptBuilderNode.ts src/nodes/agentAssistedRuleNode.ts tests/score-agent.test.ts
git commit -m "refactor: replace one-shot agent evaluation with case-aware runner"
```

---

### Task 5: Add Required Logging And Persistence For Case-Aware Turns

**Files:**
- Modify: `src/nodes/persistAndUploadNode.ts`
- Modify: `src/agent/caseAwareAgentRunner.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: Write the failing persistence and log assertions**

```ts
const turns = JSON.parse(
  await fs.readFile(path.join(caseDir, "intermediate", "agent-turns.json"), "utf-8"),
);
const toolTrace = JSON.parse(
  await fs.readFile(path.join(caseDir, "intermediate", "agent-tool-trace.json"), "utf-8"),
);
const runLog = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");

assert.equal(Array.isArray(turns), true);
assert.equal(Array.isArray(toolTrace), true);
assert.match(runLog, /case-aware agent 判定开始/);
assert.match(runLog, /case-aware 工具执行/);
assert.match(runLog, /case-aware 判定完成/);
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected:

- missing file errors for `agent-turns.json` and `agent-tool-trace.json`, or
- missing log-line assertion failures

- [ ] **Step 3: Emit the required lifecycle logs from the runner**

```ts
await logger?.info(
  `case-aware agent 判定开始 candidates=${bootstrapPayload.assisted_rule_candidates.length} caseId=${bootstrapPayload.case_context.case_id} hasPatch=${Boolean(bootstrapPayload.case_context.effective_patch_path)}`,
);
await logger?.info(
  `case-aware bootstrap 完成 targetFiles=${bootstrapPayload.initial_target_files.length} initialPatch=${Boolean(bootstrapPayload.case_context.effective_patch_path)} toolBudget=${bootstrapPayload.tool_contract.max_tool_calls} byteBudget=${bootstrapPayload.tool_contract.max_total_bytes}`,
);
await logger?.info(
  `case-aware planner 开始 turn=${turn} remainingTools=${budget.remainingToolCalls} remainingBytes=${budget.remainingBytes}`,
);
await logger?.info(
  `case-aware 判定完成 turns=${turns.length} reviewedRules=${finalAnswer.rule_assessments.length} humanReview=${finalAnswer.rule_assessments.filter((item) => item.needs_human_review).length} status=success`,
);
```

- [ ] **Step 4: Persist the new artifacts**

```ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "inputs/agent-bootstrap-payload.json",
  state.agentBootstrapPayload ?? {},
);
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/agent-turns.json",
  state.agentTurns ?? [],
);
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/agent-tool-trace.json",
  state.agentToolTrace ?? [],
);
```

- [ ] **Step 5: Enrich the existing agent result artifact**

```ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/agent-assisted-rule-result.json",
  {
    status: state.agentRunStatus ?? "not_enabled",
    raw_output_text: state.agentRawOutputText ?? "",
    parsed_result: state.agentAssistedRuleResults ?? null,
    runner_mode: state.agentRunnerMode ?? "case_aware",
    turn_count: state.agentTurns?.length ?? 0,
    tool_call_count: state.agentToolTrace?.length ?? 0,
    forced_finalize_reason: state.forcedFinalizeReason ?? null,
  },
);
```

- [ ] **Step 6: Re-run the targeted workflow tests**

Run:

```bash
npm test -- tests/score-agent.test.ts
```

Expected:

- persistence assertions pass
- run.log contains the required case-aware lifecycle lines

- [ ] **Step 7: Commit logging and persistence**

```bash
git add src/agent/caseAwareAgentRunner.ts src/nodes/persistAndUploadNode.ts tests/score-agent.test.ts
git commit -m "feat: persist case-aware agent traces and logs"
```

---

### Task 6: Run End-To-End Verification And Remove Any Leftover One-Shot Assumptions

**Files:**
- Modify: `tests/agent-assisted-rule.test.ts`
- Modify: `tests/score-agent.test.ts`
- Modify: `tests/case-aware-agent-runner.test.ts`

- [ ] **Step 1: Remove any remaining old one-shot payload assumptions from tests**

```ts
assert.doesNotMatch(prompt, /你只需要基于提供的证据，对 assisted_rule_candidates 中的候选弱规则给出结构化辅助判断。/);
assert.match(prompt, /你只能返回 tool_call 或 final_answer/);
assert.equal(payload.case_context.case_root.length > 0, true);
```

- [ ] **Step 2: Run the focused integration suite**

Run:

```bash
npm test -- tests/agent-assisted-rule.test.ts tests/case-tools.test.ts tests/case-aware-agent-runner.test.ts tests/score-agent.test.ts
```

Expected:

- all four suites pass

- [ ] **Step 3: Run the full project test suite**

Run:

```bash
npm test
```

Expected:

- `fail 0`
- existing todo count unchanged or intentionally updated

- [ ] **Step 4: Run the TypeScript build**

Run:

```bash
npm run build
```

Expected:

- exit code `0`
- no TypeScript errors

- [ ] **Step 5: Commit the final cleanup**

```bash
git add tests/agent-assisted-rule.test.ts tests/case-tools.test.ts tests/case-aware-agent-runner.test.ts tests/score-agent.test.ts src
git commit -m "test: finalize case-aware agent workflow"
```

---

## Self-Review

### Spec Coverage

- Goal and architecture: covered by Tasks 1 through 4, which directly replace the old one-shot prompt path with a case-aware runner.
- Restricted tool surface and safety boundaries: covered by Task 2.
- LangGraph-backed inner loop and runner orchestration: covered by Task 3.
- Workflow/node integration and direct switch without compatibility branches: covered by Task 4.
- Required logs and structured traces: covered by Task 5.
- Verification and acceptance criteria: covered by Task 6.

No spec section is left without an implementation task.

### Placeholder Scan

- No `TBD`, `TODO`, or “similar to previous task” instructions remain.
- Every task contains exact file paths.
- Every task contains explicit commands and expected outcomes.
- Every code-changing step contains concrete code snippets rather than vague directions.

### Type Consistency

- The plan consistently uses `AgentBootstrapPayload`, `CaseToolName`, `CaseAwareAgentFinalAnswer`, `CaseAwareAgentTurn`, and `forcedFinalizeReason`.
- The low-level client method is consistently named `completeJsonPrompt`.
- The new node integration consistently refers to `agentBootstrapPayload`, `agentToolTrace`, `agentTurns`, and `agentRunnerMode`.

No naming conflicts were introduced across tasks.
