# Remove Legacy Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除首版本工程中所有“兼容旧版本”的运行时分支、状态映射、测试与文档表述，同时保留“静态规则 -> agent 辅助 -> 合并结果 -> 评分与报告”的主链。

**Architecture:** 先用测试锁定三条主线：Agent client 不再做兼容降级重试、规则链路不再生成旧口径结果、输入与中间产物不再落盘 `prompt.txt` / `original-prompt.txt`。随后删掉兼容命名与分支，改为只消费真实状态 `staticRuleAuditResults`、`deterministicRuleResults`、`assistedRuleCandidates`、`mergedRuleAuditResults`，最后清理测试与文档中的兼容措辞。

**Tech Stack:** TypeScript, Node.js test runner, LangGraph state graph, repo-local scoring workflow

---

### Task 1: 删除 Agent Client 的兼容命名与降级重试

**Files:**
- Modify: `src/agent/agentClient.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Test: `tests/agent-client.test.ts`

- [ ] **Step 1: 先写失败测试，锁定“单次请求 + 新命名”行为**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ChatModelClient, createDefaultAgentClient } from "../src/agent/agentClient.js";

test("ChatModelClient sends one request with response_format and returns the first response body", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(url), body });

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const result = await client.evaluateRules({
      prompt: "请仅输出 JSON",
      payload: {
        case_context: {
          case_id: "case-1",
          task_type: "bug_fix",
          original_prompt_summary: "修复页面问题",
          has_patch: true,
          project_paths: {
            original_project_path: "/tmp/original",
            generated_project_path: "/tmp/workspace",
          },
        },
        task_understanding: {
          explicitConstraints: [],
          contextualConstraints: [],
          implicitConstraints: [],
          classificationHints: [],
        },
        rubric_summary: {
          task_type: "bug_fix",
          evaluation_mode: "auto_precheck_with_human_review",
          dimension_summaries: [],
          hard_gates: [],
          review_rule_summary: [],
        },
        deterministic_rule_results: [],
        assisted_rule_candidates: [],
        response_contract: {
          output_language: "zh-CN",
          json_only: true,
          fallback_rule: "不确定时必须返回 needs_human_review=true",
          required_top_level_fields: ["summary", "rule_assessments"],
          summary_schema: {
            assistant_scope: "string",
            overall_confidence: ["high", "medium", "low"],
          },
          rule_assessment_schema: {
            required_fields: ["rule_id", "decision", "confidence", "reason", "evidence_used", "needs_human_review"],
            decision_enum: ["violation", "pass", "not_applicable", "uncertain"],
            confidence_enum: ["high", "medium", "low"],
          },
        },
      },
    });

    assert.equal(result, "{\"ok\":true}");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.body.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: FAIL，提示 `ChatModelClient` 不存在，或仍然发起两次请求

- [ ] **Step 3: 删除兼容重试并改成首版本命名**

```ts
export interface ChatModelClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ChatModelClient implements AgentClient {
  constructor(private readonly options: ChatModelClientOptions) {}

  async evaluateRules(input: { prompt: string; payload: AgentPromptPayload }): Promise<string> {
    const response = await this.requestCompletion({
      model: this.options.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
      response_format: { type: "json_object" },
    });

    return this.extractMessageContent(response);
  }
}

export function createDefaultAgentClient(config: {
  modelProviderBaseUrl?: string;
  modelProviderApiKey?: string;
  modelProviderModel?: string;
}): AgentClient | undefined {
  if (!config.modelProviderBaseUrl || !config.modelProviderApiKey) {
    return undefined;
  }

  return new ChatModelClient({
    baseUrl: config.modelProviderBaseUrl,
    apiKey: config.modelProviderApiKey,
    model: config.modelProviderModel ?? "gpt-5.4",
  });
}
```

- [ ] **Step 4: 运行测试，确认新命名和单次请求通过**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交这个最小变更**

```bash
git add src/agent/agentClient.ts src/workflow/scoreWorkflow.ts tests/agent-client.test.ts
git commit -m "refactor: remove agent client legacy compatibility"
```

### Task 2: 删除规则引擎的旧口径映射，工作流改为消费真实状态

**Files:**
- Modify: `src/rules/ruleEngine.ts`
- Modify: `src/nodes/ruleAuditNode.ts`
- Modify: `src/nodes/ruleMergeNode.ts`
- Modify: `src/nodes/scoringOrchestrationNode.ts`
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `src/nodes/persistAndUploadNode.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/rule-engine.test.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定不再生成旧口径 `ruleAuditResults`**

```ts
test("runRuleEngine does not expose a compatibility-mapped ruleAuditResults field", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal("ruleAuditResults" in result, false);
  assert.equal(result.staticRuleAuditResults.some((item) => item.result === "未接入判定器"), true);
});
```

- [ ] **Step 2: 写失败测试，锁定 scoring/report 在无 merge 时消费确定性结果**

```ts
test("runScoreWorkflow uses deterministic results before merge and merged results after merge", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  assert.equal(Array.isArray(result.deterministicRuleResults), true);
  assert.equal(Array.isArray(result.mergedRuleAuditResults), true);
  assert.equal(
    (result.mergedRuleAuditResults as Array<{ result: string }>).some((item) => item.result === "待人工复核"),
    true,
  );
});
```

- [ ] **Step 3: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/score-agent.test.ts`
Expected: FAIL，提示 `ruleAuditResults` 仍然存在，或工作流节点仍在回退到旧字段

- [ ] **Step 4: 删除旧口径结果，并让 audit/merge/scoring/report 只沿真实状态流转**

```ts
// src/rules/ruleEngine.ts
export interface RuleEngineOutput {
  staticRuleAuditResults: StaticRuleAuditResult[];
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
  ruleViolations: RuleViolation[];
  ruleEvidenceIndex: RuleEvidenceIndex;
  evidenceSummary: EvidenceSummary;
}

return {
  staticRuleAuditResults,
  deterministicRuleResults,
  assistedRuleCandidates,
  ruleViolations,
  ruleEvidenceIndex,
  evidenceSummary: evidence.summary,
};
```

```ts
// src/nodes/ruleAuditNode.ts
return {
  staticRuleAuditResults: result.staticRuleAuditResults,
  deterministicRuleResults: result.deterministicRuleResults,
  assistedRuleCandidates: result.assistedRuleCandidates,
  ruleEvidenceIndex: result.ruleEvidenceIndex,
  ruleViolations: result.ruleViolations,
  evidenceSummary: result.evidenceSummary,
};
```

```ts
// src/nodes/ruleMergeNode.ts
if ((state.assistedRuleCandidates?.length ?? 0) === 0) {
  return {
    mergedRuleAuditResults: state.deterministicRuleResults ?? [],
    agentAssistedRuleResults: undefined,
  };
}
```

```ts
// src/nodes/scoringOrchestrationNode.ts
const effectiveRuleAuditResults =
  (state.mergedRuleAuditResults?.length ?? 0) > 0
    ? state.mergedRuleAuditResults
    : state.deterministicRuleResults ?? [];
```

```ts
// src/nodes/reportGenerationNode.ts
const effectiveRuleAuditResults =
  (state.mergedRuleAuditResults?.length ?? 0) > 0
    ? state.mergedRuleAuditResults
    : state.deterministicRuleResults ?? [];
```

```ts
// src/nodes/persistAndUploadNode.ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/rule-audit.json",
  state.deterministicRuleResults ?? [],
);
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/rule-audit-merged.json",
  state.mergedRuleAuditResults ?? state.deterministicRuleResults ?? [],
);
```

- [ ] **Step 5: 运行测试，确认真实状态链路通过**

Run: `node --import tsx --test tests/rule-engine.test.ts tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 6: 提交规则链路收口**

```bash
git add src/rules/ruleEngine.ts src/nodes/ruleAuditNode.ts src/nodes/ruleMergeNode.ts src/nodes/scoringOrchestrationNode.ts src/nodes/reportGenerationNode.ts src/nodes/persistAndUploadNode.ts src/workflow/state.ts tests/rule-engine.test.ts tests/score-agent.test.ts
git commit -m "refactor: remove legacy rule audit compatibility flow"
```

### Task 3: 删除 prompt 快照落盘与相关元数据

**Files:**
- Modify: `src/service.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Modify: `src/workflow/state.ts`
- Modify: `src/nodes/persistAndUploadNode.ts`
- Test: `tests/interactive-launcher.test.ts`
- Test: `tests/workflow-custom-events.test.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定不再落盘 `prompt.txt` 和 `original-prompt.txt`**

```ts
test("runSingleCase writes only current workflow inputs without prompt snapshot files", async (t) => {
  const fixture = await createLauncherCaseFixture(t);
  process.env.LOCAL_CASE_ROOT = fixture.localCaseRoot;
  process.env.DEFAULT_REFERENCE_ROOT = path.resolve(process.cwd(), "references/scoring");

  try {
    const result = await runSingleCase(fixture.casePath);
    await assert.rejects(
      fs.readFile(path.join(result.caseDir, "inputs", "prompt.txt"), "utf-8"),
    );
    await assert.rejects(
      fs.readFile(path.join(result.caseDir, "inputs", "original-prompt.txt"), "utf-8"),
    );

    const caseInfo = JSON.parse(await fs.readFile(path.join(result.caseDir, "inputs", "case-info.json"), "utf-8"));
    assert.equal("original_prompt_file" in caseInfo, false);
    assert.equal(caseInfo.agent_prompt_file, "inputs/agent-prompt.txt");
  } finally {
    delete process.env.LOCAL_CASE_ROOT;
    delete process.env.DEFAULT_REFERENCE_ROOT;
  }
});
```

- [ ] **Step 2: 写失败测试，锁定 workflow state 不再依赖 `originalPromptText`**

```ts
test("taskUnderstandingNode emits custom start events without originalPromptText in state", async () => {
  const events: Array<Record<string, unknown>> = [];

  const result = await taskUnderstandingNode(
    {
      caseInput: {
        caseId: "case-1",
        promptText: "修复页面 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
    } as never,
    {
      writer: (chunk: Record<string, unknown>) => events.push(chunk),
    } as never,
  );

  assert.equal(events[0]?.event, "node_started");
  assert.ok(result.constraintSummary);
});
```

- [ ] **Step 3: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/interactive-launcher.test.ts tests/workflow-custom-events.test.ts tests/score-agent.test.ts`
Expected: FAIL，提示 prompt 快照文件仍存在，或 `originalPromptText` 仍然是必需状态

- [ ] **Step 4: 删除 prompt 快照文件和相关状态字段**

```ts
// src/service.ts
const caseInfoBase = {
  case_id: path.basename(caseDir),
  source_case_path: sourceCasePath,
  task_type: taskType,
  original_project_path: caseInput.originalProjectPath,
  generated_project_path: caseInput.generatedProjectPath,
  patch_path: caseInput.patchPath ?? null,
  started_at: new Date().toISOString(),
  agent_prompt_file: "inputs/agent-prompt.txt",
  agent_assistance_enabled: Boolean(config.modelProviderBaseUrl && config.modelProviderApiKey),
  agent_model: config.modelProviderModel ?? "gpt-5.4",
};

await artifactStore.writeJson(caseDir, "inputs/case-info.json", {
  ...caseInfoBase,
  agent_run_status: "not_enabled",
});
```

```ts
// src/workflow/state.ts
export const ScoreState = Annotation.Root({
  caseInput: Annotation<CaseInput>(),
  caseDir: Annotation<string>(),
  constraintSummary: Annotation<ConstraintSummary>(),
  taskType: Annotation<TaskType>(),
  // 删除 originalPromptText
});
```

```ts
// src/workflow/scoreWorkflow.ts
const initialState = {
  caseInput: input.caseInput,
  caseDir: input.caseDir,
};
```

```ts
// src/nodes/persistAndUploadNode.ts
await deps.artifactStore.writeText(state.caseDir, "inputs/agent-prompt.txt", state.agentPromptText ?? "");
await deps.artifactStore.writeJson(state.caseDir, "inputs/agent-prompt-payload.json", state.agentPromptPayload ?? {});
```

- [ ] **Step 5: 运行测试，确认 prompt 快照路径已移除**

Run: `node --import tsx --test tests/interactive-launcher.test.ts tests/workflow-custom-events.test.ts tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 6: 提交输入落盘清理**

```bash
git add src/service.ts src/workflow/scoreWorkflow.ts src/workflow/state.ts src/nodes/persistAndUploadNode.ts tests/interactive-launcher.test.ts tests/workflow-custom-events.test.ts tests/score-agent.test.ts
git commit -m "refactor: remove prompt snapshot artifacts"
```

### Task 4: 清理兼容措辞并做全链路验证

**Files:**
- Modify: `tests/agent-client.test.ts`
- Modify: `tests/rule-engine.test.ts`
- Modify: `tests/score-agent.test.ts`
- Modify: `docs/superpowers/specs/2026-04-17-remove-legacy-compat-design.md`
- Modify: `docs/superpowers/plans/2026-04-17-remove-legacy-compat-implementation.md`

- [ ] **Step 1: 写失败测试，锁定源码不再保留 `Compatible` / `legacy` 兼容命名**

```ts
test("repo runtime files no longer use legacy compatibility naming", async () => {
  const files = [
    "src/agent/agentClient.ts",
    "src/rules/ruleEngine.ts",
    "src/service.ts",
  ];

  for (const relativePath of files) {
    const text = await fs.readFile(path.resolve(process.cwd(), relativePath), "utf-8");
    assert.doesNotMatch(text, /\bCompatible\b|\blegacy\b|兼容旧版本/);
  }
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: FAIL，提示仍存在 `Compatible` 或 `legacy` 命名

- [ ] **Step 3: 清理测试名、注释和文档措辞**

```ts
// tests/agent-client.test.ts
test("ChatModelClient sends one JSON-format request and parses the response", async () => {
  // ...
});
```

```ts
// src/agent/agentClient.ts
// ChatModelClient 负责调用当前评分工作流使用的模型服务接口。
export class ChatModelClient implements AgentClient {
  // ...
}
```

```md
<!-- docs/superpowers/specs/2026-04-17-remove-legacy-compat-design.md -->
- 删除历史兼容命名与分支
- 保留首版本唯一真实状态流转
```

- [ ] **Step 4: 跑工作流相关完整测试集**

Run: `node --import tsx --test tests/agent-client.test.ts tests/rule-engine.test.ts tests/score-agent.test.ts tests/interactive-launcher.test.ts tests/workflow-custom-events.test.ts tests/workflow-node-summary.test.ts tests/agent-assisted-rule.test.ts`
Expected: PASS，0 fail

- [ ] **Step 5: 扫描源码，确认兼容措辞已清空**

Run: `rg -n "Compatible|legacy|兼容旧版本|旧版本兼容" src tests docs`
Expected: 仅允许命中当前设计/计划文档中描述“清理兼容”的上下文，不允许命中运行时代码与保留测试

- [ ] **Step 6: 提交收尾清理**

```bash
git add src tests docs/superpowers/specs/2026-04-17-remove-legacy-compat-design.md docs/superpowers/plans/2026-04-17-remove-legacy-compat-implementation.md
git commit -m "refactor: remove legacy compatibility paths"
```
