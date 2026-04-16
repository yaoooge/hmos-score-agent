# Agent Assisted Rule Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有评分工作流中增加“规则引擎优先、Agent 辅助判定”的可回退链路，并完整落盘 prompt、候选规则、Agent 返回、合并结果和关键日志。

**Architecture:** 保留现有 `ruleAuditNode -> scoringOrchestrationNode` 主链，在两者之间插入 rubric 摘要、评分 prompt 组装、Agent 辅助判定、规则合并四个节点。工作流优先消费本地确定性规则结果，仅把候选弱规则交给 Agent，任何调用失败或非法输出都通过本地合并逻辑回退，保证最终 `result.json` 和 `report.html` 仍可生成。

**Tech Stack:** TypeScript、LangGraph、zod、node:test、repo 内 rubric/rule references、现有 `ArtifactStore`/`CaseLogger`

---

### Task 1: 扩展领域模型与工作流状态

**Files:**
- Modify: `src/types.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，约束新增状态字段会进入工作流结果**

```typescript
test("runScoreWorkflow exposes agent-assisted state for downstream nodes", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  assert.equal(typeof result.agentRunStatus, "string");
  assert.ok(Array.isArray(result.mergedRuleAuditResults));
});
```

- [ ] **Step 2: 运行单测，确认因字段缺失而失败**

Run: `npm test -- tests/score-agent.test.ts`
Expected: FAIL，提示 `agentRunStatus` 或 `mergedRuleAuditResults` 未定义

- [ ] **Step 3: 最小实现类型与状态字段**

```typescript
export interface AssistedRuleCandidate {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  why_uncertain: string;
  local_preliminary_signal: string;
  evidence_files: string[];
  evidence_snippets: string[];
}

export type AgentRunStatus = "not_enabled" | "success" | "failed" | "invalid_output" | "skipped";

export interface RubricSnapshot {
  task_type: TaskType;
  evaluation_mode: string;
  dimension_summaries: Array<{ name: string; weight: number; item_names: string[] }>;
  hard_gates: Array<{ id: string; score_cap: number }>;
  review_rule_summary: string[];
}
```

- [ ] **Step 4: 运行单测，确认状态字段接线成功**

Run: `npm test -- tests/score-agent.test.ts`
Expected: PASS 或进入下一个缺失实现导致的新失败

- [ ] **Step 5: 提交**

```bash
git add src/types.ts src/workflow/state.ts tests/score-agent.test.ts
git commit -m "feat: extend score workflow state for agent assistance"
```

### Task 2: 先用测试固定候选规则、rubric 摘要和 prompt 组装

**Files:**
- Create: `src/agent/ruleAssistance.ts`
- Test: `tests/agent-assisted-rule.test.ts`

- [ ] **Step 1: 写失败测试，覆盖候选筛选、rubric 摘要和中文 prompt**

```typescript
test("buildAgentPromptPayload keeps original prompt as fact and only sends assisted candidates", () => {
  const payload = buildAgentPromptPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复列表页渲染异常",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/changes.patch",
    },
    taskType: "bug_fix",
    constraintSummary,
    rubricSnapshot,
    deterministicRuleResults: [
      { rule_id: "ARKTS-MUST-001", rule_source: "must_rule", result: "满足", conclusion: "ok" },
    ],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要结合上下文判断",
        local_preliminary_signal: "possible_violation",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["Text(this.message)"],
      },
    ],
  });

  assert.equal(payload.case_context.original_prompt_summary.includes("修复列表页渲染异常"), true);
  assert.equal(payload.deterministic_rule_results.length, 1);
  assert.equal(payload.assisted_rule_candidates.length, 1);
  assert.match(renderAgentPrompt(payload), /所有描述型文案必须使用中文/);
  assert.match(renderAgentPrompt(payload), /只能输出 JSON/);
});
```

- [ ] **Step 2: 运行单测，确认辅助模块尚不存在**

Run: `npm test -- tests/agent-assisted-rule.test.ts`
Expected: FAIL，提示 `buildAgentPromptPayload` / `renderAgentPrompt` 未导出

- [ ] **Step 3: 最小实现辅助模块**

```typescript
export function selectAssistedRuleCandidates(ruleAuditResults: RuleAuditResult[]): {
  deterministicRuleResults: RuleAuditResult[];
  assistedRuleCandidates: AssistedRuleCandidate[];
} {
  // 当前快速版仅把 should_rule 和不支持的规则结论纳入候选，其余作为确定性结果。
}

export function buildRubricSnapshot(rubric: LoadedRubric): RubricSnapshot {
  // 裁剪出维度摘要、硬门槛和人工复核摘要。
}

export function buildAgentPromptPayload(input: BuildPromptPayloadInput): AgentPromptPayload {
  // 组装 case_context/task_understanding/rubric_summary/response_contract。
}

export function renderAgentPrompt(payload: AgentPromptPayload): string {
  // 输出中文评分 prompt，强调仅辅助候选规则、必须 JSON、无法确认时 needs_human_review=true。
}
```

- [ ] **Step 4: 运行单测，确认工具函数全部通过**

Run: `npm test -- tests/agent-assisted-rule.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/ruleAssistance.ts tests/agent-assisted-rule.test.ts
git commit -m "feat: add agent-assisted prompt preparation helpers"
```

### Task 3: 先用测试固定 Agent 返回校验与合并策略

**Files:**
- Modify: `src/agent/ruleAssistance.ts`
- Test: `tests/agent-assisted-rule.test.ts`

- [ ] **Step 1: 写失败测试，覆盖合法返回、非法输出和本地优先合并**

```typescript
test("mergeRuleAuditResults keeps deterministic results authoritative and falls back on invalid agent output", () => {
  const merged = mergeRuleAuditResults({
    deterministicRuleResults: [
      { rule_id: "ARKTS-MUST-001", rule_source: "must_rule", result: "满足", conclusion: "本地已确定" },
    ],
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-SHOULD-001",
        rule_source: "should_rule",
        why_uncertain: "需要语义判断",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/ets/pages/Index.ets"],
        evidence_snippets: ["List()"],
      },
    ],
    agentOutputText: "{\"summary\":{\"assistant_scope\":\"本次仅辅助弱规则判定\",\"overall_confidence\":\"medium\"},\"rule_assessments\":[{\"rule_id\":\"ARKTS-SHOULD-001\",\"decision\":\"uncertain\",\"confidence\":\"low\",\"reason\":\"证据不足\",\"evidence_used\":[\"entry/src/main/ets/pages/Index.ets\"],\"needs_human_review\":true}]}",
  });

  assert.equal(merged.agentRunStatus, "success");
  assert.equal(merged.mergedRuleAuditResults.find((item) => item.rule_id === "ARKTS-MUST-001")?.result, "满足");
  assert.equal(merged.mergedRuleAuditResults.find((item) => item.rule_id === "ARKTS-SHOULD-001")?.result, "待人工复核");
});
```

- [ ] **Step 2: 运行单测，确认缺少解析/映射逻辑**

Run: `npm test -- tests/agent-assisted-rule.test.ts`
Expected: FAIL，提示 `mergeRuleAuditResults` 或 schema 校验缺失

- [ ] **Step 3: 最小实现 schema 校验与合并**

```typescript
const agentResponseSchema = z.object({
  summary: z.object({
    assistant_scope: z.string(),
    overall_confidence: z.enum(["high", "medium", "low"]),
  }),
  rule_assessments: z.array(
    z.object({
      rule_id: z.string(),
      decision: z.enum(["violation", "pass", "not_applicable", "uncertain"]),
      confidence: z.enum(["high", "medium", "low"]),
      reason: z.string(),
      evidence_used: z.array(z.string()),
      needs_human_review: z.boolean(),
    }),
  ),
});
```

- [ ] **Step 4: 运行单测，确认合并策略稳定**

Run: `npm test -- tests/agent-assisted-rule.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/ruleAssistance.ts tests/agent-assisted-rule.test.ts
git commit -m "feat: add agent-assisted result validation and merge policy"
```

### Task 4: 接入工作流节点与可回退 Agent 调用

**Files:**
- Create: `src/agent/agentClient.ts`
- Create: `src/nodes/rubricPreparationNode.ts`
- Create: `src/nodes/agentPromptBuilderNode.ts`
- Create: `src/nodes/agentAssistedRuleNode.ts`
- Create: `src/nodes/ruleMergeNode.ts`
- Modify: `src/config.ts`
- Modify: `src/nodes/ruleAuditNode.ts`
- Modify: `src/nodes/scoringOrchestrationNode.ts`
- Modify: `src/workflow/scoreWorkflow.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，覆盖成功与失败回退两条工作流路径**

```typescript
test("runScoreWorkflow merges agent-assisted candidate results into scoring flow", async (t) => {
  const result = await runScoreWorkflow({
    caseInput,
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: {
      async evaluateRules() {
        return "{\"summary\":{\"assistant_scope\":\"本次仅辅助弱规则判定\",\"overall_confidence\":\"medium\"},\"rule_assessments\":[]}";
      },
    },
  });

  assert.equal(result.agentRunStatus, "success");
  assert.ok(Array.isArray(result.mergedRuleAuditResults));
});

test("runScoreWorkflow falls back when agent client throws", async (t) => {
  const result = await runScoreWorkflow({
    caseInput,
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: {
      async evaluateRules() {
        throw new Error("network down");
      },
    },
  });

  assert.equal(result.agentRunStatus, "failed");
  assert.ok(Array.isArray(result.mergedRuleAuditResults));
});
```

- [ ] **Step 2: 运行单测，确认工作流尚未接线**

Run: `npm test -- tests/score-agent.test.ts`
Expected: FAIL，提示缺少 `agentClient`、中间节点或状态字段

- [ ] **Step 3: 最小实现工作流节点和 client 接口**

```typescript
export interface AgentClient {
  evaluateRules(input: { prompt: string; payload: AgentPromptPayload }): Promise<string>;
}

export async function agentAssistedRuleNode(
  state: ScoreGraphState,
  deps: { agentClient?: AgentClient; logger?: WorkflowLogger },
): Promise<Partial<ScoreGraphState>> {
  if (!deps.agentClient || state.assistedRuleCandidates.length === 0) {
    return { agentRunStatus: !deps.agentClient ? "skipped" : "not_enabled" };
  }
  // 调用、记录日志、保留原始返回文本，失败时只返回 failed 状态，不抛出工作流异常。
}
```

- [ ] **Step 4: 运行单测，确认两条路径均通过**

Run: `npm test -- tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/agent/agentClient.ts src/nodes/rubricPreparationNode.ts src/nodes/agentPromptBuilderNode.ts src/nodes/agentAssistedRuleNode.ts src/nodes/ruleMergeNode.ts src/config.ts src/nodes/ruleAuditNode.ts src/nodes/scoringOrchestrationNode.ts src/workflow/scoreWorkflow.ts tests/score-agent.test.ts
git commit -m "feat: integrate agent-assisted rule evaluation workflow"
```

### Task 5: 落盘 prompt、中间态、case info 和关键日志

**Files:**
- Modify: `src/service.ts`
- Modify: `src/nodes/persistAndUploadNode.ts`
- Modify: `src/io/caseLogger.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，覆盖新输入文件、中间文件和中文日志**

```typescript
test("runScoreWorkflow persists agent prompt payload and merged audit artifacts", async (t) => {
  await runScoreWorkflow({ caseInput, caseDir, referenceRoot, artifactStore, agentClient });

  const originalPrompt = await fs.readFile(path.join(caseDir, "inputs", "original-prompt.txt"), "utf-8");
  const agentPrompt = await fs.readFile(path.join(caseDir, "inputs", "agent-prompt.txt"), "utf-8");
  const mergedAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit-merged.json"), "utf-8"),
  );
  const runLog = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");

  assert.equal(originalPrompt.includes("请修复"), true);
  assert.match(agentPrompt, /你不是最终评分器/);
  assert.ok(Array.isArray(mergedAudit));
  assert.match(runLog, /rubric 加载完成|agent prompt 组装完成|agent 辅助判定合并完成/);
});
```

- [ ] **Step 2: 运行单测，确认落盘文件尚不存在**

Run: `npm test -- tests/score-agent.test.ts`
Expected: FAIL，提示目标文件缺失

- [ ] **Step 3: 最小实现统一落盘**

```typescript
await deps.artifactStore.writeText(state.caseDir, "inputs/original-prompt.txt", state.originalPromptText);
await deps.artifactStore.writeText(state.caseDir, "inputs/agent-prompt.txt", state.agentPromptText);
await deps.artifactStore.writeJson(state.caseDir, "inputs/agent-prompt-payload.json", state.agentPromptPayload);
await deps.artifactStore.writeJson(state.caseDir, "intermediate/rubric-snapshot.json", state.rubricSnapshot);
await deps.artifactStore.writeJson(state.caseDir, "intermediate/agent-assisted-rule-candidates.json", state.assistedRuleCandidates);
await deps.artifactStore.writeJson(state.caseDir, "intermediate/agent-assisted-rule-result.json", state.agentAssistedRuleResults);
await deps.artifactStore.writeJson(state.caseDir, "intermediate/rule-audit-merged.json", state.mergedRuleAuditResults);
```

- [ ] **Step 4: 运行单测，确认落盘与日志通过**

Run: `npm test -- tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/service.ts src/nodes/persistAndUploadNode.ts src/io/caseLogger.ts tests/score-agent.test.ts
git commit -m "feat: persist agent-assisted scoring artifacts and logs"
```

### Task 6: 全量验证与收口

**Files:**
- Modify: `tests/scoring.test.ts`
- Modify: `tests/score-agent.test.ts`
- Modify: `src/report/schemaValidator.ts`
- Modify: `src/nodes/reportGenerationNode.ts`

- [ ] **Step 1: 补充回归测试，确认评分和报告仍消费合并后的统一结果**

```typescript
test("reportGenerationNode uses merged rule audit results in result json", async () => {
  // 构造包含 mergedRuleAuditResults 的状态，验证 resultJson.rule_audit_results 来源正确。
});
```

- [ ] **Step 2: 运行相关测试，确认仍有旧行为未更新**

Run: `npm test -- tests/scoring.test.ts tests/score-agent.test.ts`
Expected: FAIL，提示 `resultJson.rule_audit_results` 仍读取旧字段

- [ ] **Step 3: 最小修正报告和评分消费路径**

```typescript
const effectiveRuleAuditResults = state.mergedRuleAuditResults.length > 0 ? state.mergedRuleAuditResults : state.ruleAuditResults;
```

- [ ] **Step 4: 运行全量测试和构建**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/scoring.test.ts tests/score-agent.test.ts src/report/schemaValidator.ts src/nodes/reportGenerationNode.ts
git commit -m "test: cover merged rule audit scoring flow"
```
