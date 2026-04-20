# Case Constraint Rule Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为评分工作流增加用例级约束规则能力，包括 `taskUnderstandingNode` 自动生成 patch、解析 `expected_constraints.yaml` 为动态规则包、将 case 规则接入现有规则主链、在 `P0` 违规时触发硬门槛，并把结果输出到 `result.json` 与 HTML 报告。

**Architecture:** 继续复用现有 `taskUnderstandingNode -> ruleAuditNode -> agentPromptBuilderNode -> agentAssistedRuleNode -> ruleMergeNode -> scoringOrchestrationNode -> reportGenerationNode -> artifactPostProcessNode` 主链，不新增旁路校验器。用例约束在加载阶段转换为运行时 case rule 定义，在任务理解阶段生成有效 patch 并挂入状态，在规则引擎阶段以“目标文件筛选 + 轻量文本预筛 + agent 辅助兜底”方式评测，评分与报告阶段只消费统一的合并结果和 case rule 元数据。

**Tech Stack:** TypeScript, `node:test`, `node --import tsx --test`, LangGraph, `js-yaml`, AJV schema validation, existing `patchGenerator` / rule engine / HTML renderer

---

## File Structure

### Create

- `src/rules/caseConstraintLoader.ts`
  - 解析 `expected_constraints.yaml`，做严格字段校验，并输出运行时 case rule 定义。
- `src/rules/evaluators/caseConstraintEvaluator.ts`
  - 对 case rule 执行目标文件匹配、轻量文本预筛和 agent 候选兜底信号生成。
- `tests/case-constraint-loader.test.ts`
  - 覆盖 YAML 解析、字段边界校验和 priority 映射。

### Modify

- `src/types.ts`
  - 新增 case rule 定义、case rule 结果、扩展 `CaseInput`、扩展 workflow/agent 所需的类型字段。
- `src/io/caseLoader.ts`
  - 检测 `expected_constraints.yaml` 并写入 `CaseInput.expectedConstraintsPath`。
- `src/workflow/state.ts`
  - 增加 `effectivePatchPath`、`caseRuleDefinitions`、`caseRuleResults`。
- `src/nodes/taskUnderstandingNode.ts`
  - 无 patch 时自动生成 patch，解析 case rule 定义，持久化中间产物。
- `src/rules/engine/ruleTypes.ts`
  - 为运行时 case rule 增加元数据和新的 detector kind。
- `src/rules/engine/rulePackRegistry.ts`
  - 支持静态规则与运行时规则拼接，而不污染全局注册表。
- `src/rules/ruleEngine.ts`
  - 接收运行时 case rules，执行 case constraint evaluator，并输出 `caseRuleResults`。
- `src/nodes/ruleAuditNode.ts`
  - 将 state 内的 case rule 定义传给 rule engine，并接收 `caseRuleResults`。
- `src/agent/ruleAssistance.ts`
  - 允许 case rule 候选携带名称、优先级和 `llm` 提示，透传到 prompt payload。
- `src/scoring/scoringEngine.ts`
  - 当 case `must_rule` 结果为 `不满足` 时触发硬门槛。
- `src/nodes/ruleMergeNode.ts`
  - 基于最终合并结果回填 `caseRuleResults`，保证状态中保存的是最终 case 规则结论。
- `src/nodes/scoringOrchestrationNode.ts`
  - 把 `caseRuleDefinitions` 传入评分计算。
- `src/nodes/reportGenerationNode.ts`
  - 输出 `case_rule_results`。
- `src/report/renderer/buildHtmlReportViewModel.ts`
  - 增加用例规则区块的展示模型和统计。
- `src/report/renderer/renderHtmlReport.ts`
  - 渲染“用例规则结果”区块。
- `src/nodes/persistAndUploadNode.ts`
  - 额外落盘 `intermediate/case-rule-definitions.json`。
- `references/scoring/report_result_schema.json`
  - 增加 `case_rule_results` 字段 schema。
- `tests/task-understanding-node.test.ts`
  - 覆盖自动 patch 生成与 case rule 定义落盘。
- `tests/rule-engine.test.ts`
  - 覆盖 case rule 引擎行为。
- `tests/agent-assisted-rule.test.ts`
  - 覆盖 case rule 候选在 prompt payload 中的透传。
- `tests/scoring.test.ts`
  - 覆盖 case `P0` 违规触发硬门槛。
- `tests/schema-validator.test.ts`
  - 覆盖新增 schema 字段。
- `tests/report-renderer.test.ts`
  - 覆盖 HTML 报告中的 case rule 区块。
- `tests/score-agent.test.ts`
  - 覆盖工作流级回归：自动 patch、case rule、报告输出。

## Task 1: Load Case Constraint Files and Runtime Definitions

**Files:**
- Modify: `src/types.ts`
- Modify: `src/io/caseLoader.ts`
- Create: `src/rules/caseConstraintLoader.ts`
- Create: `tests/case-constraint-loader.test.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 `expected_constraints.yaml` 的检测和解析边界**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCaseFromPath } from "../src/io/caseLoader.js";
import { loadCaseConstraintRules } from "../src/rules/caseConstraintLoader.js";

async function makeCaseDir(t: test.TestContext): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "case-constraint-loader-"));
  t.after(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });
  const caseDir = path.join(rootDir, "requirement_004");
  await fs.mkdir(path.join(caseDir, "original"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "input.txt"), "修复餐厅登录流程", "utf-8");
  await fs.writeFile(
    path.join(caseDir, "expected_constraints.yaml"),
    [
      "constraints:",
      "  - id: HM-REQ-008-01",
      "    name: 必须使用 LoginWithHuaweiIDButton 实现华为账号一键登录",
      "    description: 登录页必须使用 Account Kit 提供的 LoginWithHuaweiIDButton 组件作为一键登录入口。",
      "    priority: P0",
      "    rules:",
      "      - target: '**/pages/*.ets'",
      "        ast:",
      "          - type: import",
      "            module: '@kit.AccountKit'",
      "          - type: call",
      "            name: LoginWithHuaweiIDButton",
      "        llm: 检查是否从 @kit.AccountKit 导入并使用了 LoginWithHuaweiIDButton 组件",
    ].join("\\n"),
    "utf-8",
  );
  return caseDir;
}

test("loadCaseFromPath exposes expectedConstraintsPath when YAML exists", async (t) => {
  const caseDir = await makeCaseDir(t);
  const caseInput = await loadCaseFromPath(caseDir);

  assert.equal(
    caseInput.expectedConstraintsPath,
    path.join(caseDir, "expected_constraints.yaml"),
  );
});

test("loadCaseConstraintRules maps current YAML fields into runtime case rules", async (t) => {
  const caseDir = await makeCaseDir(t);
  const rules = await loadCaseConstraintRules(
    path.join(caseDir, "expected_constraints.yaml"),
    "requirement_004",
  );

  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.rule_id, "HM-REQ-008-01");
  assert.equal(rules[0]?.rule_source, "must_rule");
  assert.equal(rules[0]?.rule_name, "必须使用 LoginWithHuaweiIDButton 实现华为账号一键登录");
  assert.equal(rules[0]?.priority, "P0");
  assert.equal(rules[0]?.is_case_rule, true);
});
```

- [ ] **Step 2: 运行测试，确认当前缺少路径与 loader 实现**

Run: `node --import tsx --test tests/case-constraint-loader.test.ts tests/score-agent.test.ts`

Expected: FAIL，提示 `expectedConstraintsPath` 不存在，且 `loadCaseConstraintRules` 模块未找到。

- [ ] **Step 3: 最小实现 case input 字段和 YAML loader**

```ts
// src/types.ts
export type CaseConstraintPriority = "P0" | "P1";

export interface CaseRuleDefinition {
  pack_id: string;
  rule_id: string;
  rule_name: string;
  rule_source: "must_rule" | "should_rule";
  summary: string;
  priority: CaseConstraintPriority;
  detector_kind: "case_constraint";
  detector_config: {
    targetPatterns: string[];
    astSignals: Array<Record<string, string>>;
    llmPrompt: string;
  };
  fallback_policy: "agent_assisted";
  is_case_rule: true;
}

export interface CaseInput {
  caseId: string;
  promptText: string;
  originalProjectPath: string;
  generatedProjectPath: string;
  patchPath?: string;
  expectedConstraintsPath?: string;
}
```

```ts
// src/io/caseLoader.ts
const expectedConstraintsCandidate = path.join(resolved, "expected_constraints.yaml");
let expectedConstraintsPath: string | undefined;
try {
  await fs.access(expectedConstraintsCandidate);
  expectedConstraintsPath = expectedConstraintsCandidate;
} catch {
  expectedConstraintsPath = undefined;
}
```

```ts
// src/rules/caseConstraintLoader.ts
import fs from "node:fs/promises";
import yaml from "js-yaml";
import type { CaseConstraintPriority, CaseRuleDefinition } from "../types.js";

export async function loadCaseConstraintRules(
  expectedConstraintsPath?: string,
  caseId = "unknown-case",
): Promise<CaseRuleDefinition[]> {
  if (!expectedConstraintsPath) {
    return [];
  }
  const yamlText = await fs.readFile(expectedConstraintsPath, "utf-8");
  const doc = (yaml.load(yamlText) as { constraints?: unknown[] } | undefined) ?? {};
  return (doc.constraints ?? []).map((item) => {
    const current = item as Record<string, unknown>;
    const priority = current.priority as CaseConstraintPriority;
    return {
      pack_id: `case-${caseId}`,
      rule_id: String(current.id),
      rule_name: String(current.name),
      rule_source: priority === "P0" ? "must_rule" : "should_rule",
      summary: String(current.description || current.name),
      priority,
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: (current.rules as Array<Record<string, unknown>>).map((rule) =>
          String(rule.target),
        ),
        astSignals: (current.rules as Array<Record<string, unknown>>).flatMap(
          (rule) => (rule.ast as Array<Record<string, string>> | undefined) ?? [],
        ),
        llmPrompt: String((current.rules as Array<Record<string, unknown>>)[0]?.llm ?? ""),
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    };
  });
}
```

- [ ] **Step 4: 收紧字段边界，再补一个非法字段失败测试并通过**

```ts
test("loadCaseConstraintRules rejects unsupported fields instead of ignoring them", async (t) => {
  const caseDir = await makeCaseDir(t);
  await fs.writeFile(
    path.join(caseDir, "expected_constraints.yaml"),
    [
      "constraints:",
      "  - id: HM-REQ-008-01",
      "    name: bad",
      "    description: bad",
      "    priority: P0",
      "    unexpected_field: true",
      "    rules:",
      "      - target: '**/pages/*.ets'",
      "        ast: []",
      "        llm: bad",
    ].join("\\n"),
    "utf-8",
  );

  await assert.rejects(
    () =>
      loadCaseConstraintRules(path.join(caseDir, "expected_constraints.yaml"), "requirement_004"),
    /unexpected_field/,
  );
});
```

Run: `node --import tsx --test tests/case-constraint-loader.test.ts tests/score-agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/io/caseLoader.ts src/rules/caseConstraintLoader.ts tests/case-constraint-loader.test.ts tests/score-agent.test.ts
git commit -m "feat: load case constraint definitions from yaml"
```

## Task 2: Generate Effective Patch and Persist Case Rule Definitions in Task Understanding

**Files:**
- Modify: `src/workflow/state.ts`
- Modify: `src/nodes/taskUnderstandingNode.ts`
- Modify: `tests/task-understanding-node.test.ts`

- [ ] **Step 1: 写失败测试，锁定自动 patch 生成和 case rule 定义落盘**

```ts
test("taskUnderstandingNode generates patch when case patch is absent and loads case rules", async (t) => {
  const rootDir = await makeTempDir(t);
  const originalProjectPath = path.join(rootDir, "original");
  const generatedProjectPath = path.join(rootDir, "workspace");
  const expectedConstraintsPath = path.join(rootDir, "expected_constraints.yaml");
  const artifactStore = new ArtifactStore(rootDir);
  const caseDir = await artifactStore.ensureCaseDir("case-agent");

  await fs.mkdir(path.join(originalProjectPath, "entry", "src", "main", "ets"), { recursive: true });
  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets"), { recursive: true });
  await fs.writeFile(path.join(originalProjectPath, "entry", "src", "main", "ets", "Index.ets"), "Text('old')\\n", "utf-8");
  await fs.writeFile(path.join(generatedProjectPath, "entry", "src", "main", "ets", "Index.ets"), "Text('new')\\n", "utf-8");
  await fs.writeFile(
    expectedConstraintsPath,
    [
      "constraints:",
      "  - id: HM-REQ-008-01",
      "    name: 登录按钮",
      "    description: 必须存在登录按钮",
      "    priority: P0",
      "    rules:",
      "      - target: '**/pages/*.ets'",
      "        ast:",
      "          - type: call",
      "            name: LoginWithHuaweiIDButton",
      "        llm: 检查登录按钮是否存在",
    ].join("\\n"),
    "utf-8",
  );

  const result = await taskUnderstandingNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-agent",
        promptText: "新增登录能力",
        originalProjectPath,
        generatedProjectPath,
        expectedConstraintsPath,
      },
    } as never,
    { artifactStore },
  );

  assert.equal(typeof result.effectivePatchPath, "string");
  assert.equal(result.caseRuleDefinitions?.length, 1);
  const patchText = await fs.readFile(result.effectivePatchPath as string, "utf-8");
  assert.match(patchText, /diff --git/);
  const persistedRules = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "case-rule-definitions.json"), "utf-8"),
  );
  assert.equal(persistedRules.length, 1);
});
```

- [ ] **Step 2: 运行测试，确认当前节点不会生成 patch 或挂载 case rules**

Run: `node --import tsx --test tests/task-understanding-node.test.ts`

Expected: FAIL，提示 `effectivePatchPath` 或 `caseRuleDefinitions` 未定义。

- [ ] **Step 3: 最小实现 workflow 状态与 patch 准备逻辑**

```ts
// src/workflow/state.ts
effectivePatchPath: Annotation<string>(),
caseRuleDefinitions: Annotation<CaseRuleDefinition[]>(),
caseRuleResults: Annotation<CaseRuleResult[]>(),
```

```ts
// src/nodes/taskUnderstandingNode.ts
import { generateCasePatch } from "../io/patchGenerator.js";
import { loadCaseConstraintRules } from "../rules/caseConstraintLoader.js";

async function ensureEffectivePatchPath(state: ScoreGraphState, deps: TaskUnderstandingDeps): Promise<string | undefined> {
  if (state.caseInput.patchPath) {
    return state.caseInput.patchPath;
  }
  if (!deps.artifactStore || !state.caseDir) {
    return undefined;
  }
  const outputPath = path.join(state.caseDir, "intermediate", "generated.patch");
  await generateCasePatch(path.dirname(state.caseInput.originalProjectPath), outputPath);
  return outputPath;
}
```

- [ ] **Step 4: 用有效 patch 路径替换后续 patch 摘要读取，并持久化 case rules**

```ts
const effectivePatchPath = await ensureEffectivePatchPath(state, deps);
const patchSummary = await readPatchSummary(effectivePatchPath);
const caseRuleDefinitions = await loadCaseConstraintRules(
  state.caseInput.expectedConstraintsPath,
  state.caseInput.caseId,
);
await deps.artifactStore?.writeJson(
  state.caseDir,
  "intermediate/case-rule-definitions.json",
  caseRuleDefinitions,
);

return {
  constraintSummary,
  effectivePatchPath,
  caseRuleDefinitions,
};
```

Run: `node --import tsx --test tests/task-understanding-node.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workflow/state.ts src/nodes/taskUnderstandingNode.ts tests/task-understanding-node.test.ts
git commit -m "feat: prepare effective patch and case rules in task understanding"
```

## Task 3: Evaluate Runtime Case Rules Inside the Rule Engine

**Files:**
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify: `src/rules/engine/rulePackRegistry.ts`
- Create: `src/rules/evaluators/caseConstraintEvaluator.ts`
- Modify: `src/rules/ruleEngine.ts`
- Modify: `src/nodes/ruleAuditNode.ts`
- Modify: `tests/rule-engine.test.ts`

- [ ] **Step 1: 写失败测试，锁定 case rule 的“直接不满足”和“进入 agent 候选”两条路径**

```ts
test("runRuleEngine evaluates runtime case rules and exposes caseRuleResults", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "import { LoginWithHuaweiIDButton } from '@kit.AccountKit';\\nLoginWithHuaweiIDButton()\\n",
    "entry/src/main/module.json5": "{ \"module\": { \"name\": \"entry\" } }\\n",
  });

  const runtimeRules: CaseRuleDefinition[] = [
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      rule_source: "must_rule",
      summary: "登录页必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/pages/*.ets"],
        astSignals: [
          { type: "import", module: "@kit.AccountKit" },
          { type: "call", name: "LoginWithHuaweiIDButton" },
        ],
        llmPrompt: "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-06",
      rule_name: "module.json5 需配置 Client ID",
      rule_source: "should_rule",
      summary: "module.json5 需配置 Client ID",
      priority: "P1",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/module.json5"],
        astSignals: [{ type: "json_key", name: "metadata" }],
        llmPrompt: "检查 module.json5 是否配置 metadata",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
  ];

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules,
  });

  assert.equal(
    result.caseRuleResults.some((item) => item.rule_id === "HM-REQ-008-01"),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-06"),
    true,
  );
});

test("runRuleEngine marks missing case targets as violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/Index.ets": "Text('plain')\\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_004",
        rule_id: "HM-REQ-008-01",
        rule_name: "必须使用 LoginWithHuaweiIDButton",
        rule_source: "must_rule",
        summary: "登录页必须使用 LoginWithHuaweiIDButton",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/pages/*.ets"],
          astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
          llmPrompt: "检查登录页按钮",
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "HM-REQ-008-01" && item.result === "不满足",
    ),
    true,
  );
});
```

- [ ] **Step 2: 运行测试，确认 rule engine 还不接受运行时规则**

Run: `node --import tsx --test tests/rule-engine.test.ts`

Expected: FAIL，提示 `runtimeRules` / `caseRuleResults` 字段不存在，或 `case_constraint` 未实现。

- [ ] **Step 3: 扩展规则类型和 evaluator 入口**

```ts
// src/rules/engine/ruleTypes.ts
export type DetectorKind =
  | "text_pattern"
  | "project_structure"
  | "case_constraint"
  | "not_implemented";

export interface RegisteredRule {
  pack_id: string;
  rule_id: string;
  rule_source: RuleSource;
  summary: string;
  detector_kind: DetectorKind;
  detector_config: Record<string, unknown>;
  fallback_policy: "agent_assisted" | "not_applicable";
  rule_name?: string;
  priority?: "P0" | "P1";
  is_case_rule?: boolean;
}
```

```ts
// src/rules/evaluators/caseConstraintEvaluator.ts
export function runCaseConstraintRule(
  rule: RegisteredRule,
  evidence: CollectedEvidence,
): EvaluatedRule {
  const targetPatterns = (rule.detector_config.targetPatterns as string[] | undefined) ?? [];
  const astSignals = (rule.detector_config.astSignals as Array<Record<string, string>> | undefined) ?? [];
  const candidateFiles = evidence.workspaceFiles.filter((file) =>
    targetPatterns.some((pattern) => matchesCaseTargetPattern(file.relativePath, pattern)),
  );

  if (candidateFiles.length === 0) {
    return {
      rule_id: rule.rule_id,
      rule_source: rule.rule_source,
      result: "不满足",
      conclusion: `${rule.summary} 未找到匹配目标文件。`,
      matchedFiles: [],
    };
  }

  const hasAllSignals = candidateFiles.some((file) =>
    astSignals.every((signal) => Object.values(signal).every((token) => file.content.includes(token))),
  );

  return hasAllSignals
    ? {
        rule_id: rule.rule_id,
        rule_source: rule.rule_source,
        result: "满足",
        conclusion: "在目标文件中找到了当前约束需要的直接证据。",
        matchedFiles: candidateFiles.map((file) => file.relativePath),
      }
    : {
        rule_id: rule.rule_id,
        rule_source: rule.rule_source,
        result: "未接入判定器",
        conclusion: `${rule.summary} 需要结合上下文做语义判定。`,
        matchedFiles: candidateFiles.map((file) => file.relativePath),
      };
}
```

- [ ] **Step 4: 在 rule engine 中接入运行时规则，并单独提取 caseRuleResults**

```ts
const evaluatedRules = listRegisteredRules(input.runtimeRules ?? []).map((rule) =>
  evaluateRegisteredRule(rule, evidence),
);

const caseRuleIds = new Set((input.runtimeRules ?? []).map((rule) => rule.rule_id));
const caseRuleResults = deterministicRuleResults.filter((rule) => caseRuleIds.has(rule.rule_id));
```

```ts
// src/nodes/ruleAuditNode.ts
const result = await runRuleEngine({
  referenceRoot: config.referenceRoot,
  caseInput: state.caseInput,
  taskType: state.taskType,
  runtimeRules: state.caseRuleDefinitions,
});

return {
  staticRuleAuditResults: result.staticRuleAuditResults,
  deterministicRuleResults: result.deterministicRuleResults,
  assistedRuleCandidates: result.assistedRuleCandidates,
  ruleEvidenceIndex: result.ruleEvidenceIndex,
  ruleViolations: result.ruleViolations,
  evidenceSummary: result.evidenceSummary,
  caseRuleResults: result.caseRuleResults,
};
```

Run: `node --import tsx --test tests/rule-engine.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rules/engine/ruleTypes.ts src/rules/engine/rulePackRegistry.ts src/rules/evaluators/caseConstraintEvaluator.ts src/rules/ruleEngine.ts src/nodes/ruleAuditNode.ts tests/rule-engine.test.ts
git commit -m "feat: evaluate runtime case rules in rule engine"
```

## Task 4: Carry Case Rule Metadata Through Agent, Scoring, and Result JSON

**Files:**
- Modify: `src/types.ts`
- Modify: `src/agent/ruleAssistance.ts`
- Modify: `src/scoring/scoringEngine.ts`
- Modify: `src/nodes/ruleMergeNode.ts`
- Modify: `src/nodes/scoringOrchestrationNode.ts`
- Modify: `src/nodes/reportGenerationNode.ts`
- Modify: `references/scoring/report_result_schema.json`
- Modify: `tests/agent-assisted-rule.test.ts`
- Modify: `tests/scoring.test.ts`
- Modify: `tests/schema-validator.test.ts`

- [ ] **Step 1: 写失败测试，锁定 case 规则候选透传、P0 硬门槛、`result.json` 字段**

```ts
test("buildAgentPromptPayload keeps case rule metadata on assisted candidates", () => {
  const payload = buildAgentPromptPayload({
    caseInput: {
      caseId: "case-1",
      promptText: "实现登录流程",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      patchPath: "/tmp/changes.patch",
    },
    taskType: "full_generation",
    constraintSummary,
    rubricSnapshot,
    deterministicRuleResults: [],
    assistedRuleCandidates: [
      {
        rule_id: "HM-REQ-008-06",
        rule_source: "should_rule",
        why_uncertain: "需要结合上下文判断 metadata 是否为 Client ID",
        local_preliminary_signal: "unknown",
        evidence_files: ["entry/src/main/module.json5"],
        evidence_snippets: ['{ "module": { "name": "entry" } }'],
        rule_name: "module.json5 需配置 Client ID",
        priority: "P1",
        llm_prompt: "检查 module.json5 是否配置 Client ID 相关 metadata",
        is_case_rule: true,
      },
    ],
  });

  assert.equal(payload.assisted_rule_candidates[0]?.rule_name, "module.json5 需配置 Client ID");
  assert.equal(payload.assisted_rule_candidates[0]?.priority, "P1");
});

test("computeScoreBreakdown triggers hard gate when case P0 rule fails", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const result = computeScoreBreakdown({
    taskType: "full_generation",
    rubric,
    ruleAuditResults: [
      {
        rule_id: "HM-REQ-008-01",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "未使用 LoginWithHuaweiIDButton",
      },
    ],
    ruleViolations: [],
    constraintSummary,
    featureExtraction,
    evidenceSummary: {
      workspaceFileCount: 4,
      originalFileCount: 3,
      changedFileCount: 2,
      changedFiles: ["entry/src/main/ets/pages/LoginPage.ets"],
      hasPatch: true,
    },
    caseRuleDefinitions: [
      {
        pack_id: "case-requirement_004",
        rule_id: "HM-REQ-008-01",
        rule_name: "必须使用 LoginWithHuaweiIDButton",
        rule_source: "must_rule",
        summary: "登录页必须使用 LoginWithHuaweiIDButton",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/pages/*.ets"],
          astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
          llmPrompt: "检查登录按钮",
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  assert.equal(result.hardGateTriggered, true);
  assert.match(result.hardGateReason ?? "", /case_rule/i);
});

test("validateReportResult accepts result with case_rule_results", () => {
  const schemaPath = path.resolve(process.cwd(), "references/scoring/report_result_schema.json");
  const valid = makeValidResultJson();
  valid.case_rule_results = [
    {
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      rule_source: "must_rule",
      result: "满足",
      conclusion: "ok",
      hard_gate_triggered: false,
    },
  ];
  assert.doesNotThrow(() => validateReportResult(valid, schemaPath));
});
```

- [ ] **Step 2: 运行测试，确认现有类型与 schema 无法承载 case rule 数据**

Run: `node --import tsx --test tests/agent-assisted-rule.test.ts tests/scoring.test.ts tests/schema-validator.test.ts`

Expected: FAIL，提示 `priority` / `rule_name` / `case_rule_results` 不存在，且硬门槛断言未满足。

- [ ] **Step 3: 扩展候选类型、评分输入和报告输出**

```ts
// src/types.ts
export interface AssistedRuleCandidate {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  why_uncertain: string;
  local_preliminary_signal: string;
  evidence_files: string[];
  evidence_snippets: string[];
  rule_name?: string;
  priority?: "P0" | "P1";
  llm_prompt?: string;
  is_case_rule?: boolean;
}

export interface CaseRuleResult {
  rule_id: string;
  rule_name: string;
  priority: "P0" | "P1";
  rule_source: "must_rule" | "should_rule";
  result: "满足" | "不满足" | "不涉及" | "待人工复核";
  conclusion: string;
  hard_gate_triggered: boolean;
}
```

```ts
// src/scoring/scoringEngine.ts
function selectTriggeredGates(input: ComputeScoreInput): GateTrigger[] {
  const triggered: GateTrigger[] = [];
  const caseMustRuleIds = new Set(
    (input.caseRuleDefinitions ?? [])
      .filter((rule) => rule.priority === "P0")
      .map((rule) => rule.rule_id),
  );

  if (
    input.ruleAuditResults.some(
      (rule) => caseMustRuleIds.has(rule.rule_id) && rule.result === "不满足",
    )
  ) {
    triggered.push({
      id: "G1",
      reason: "case_rule: 存在 P0 用例约束不满足。",
    });
  }
  // 保留原有 gate 逻辑...
  return triggered;
}
```

```ts
// src/nodes/reportGenerationNode.ts
// src/nodes/ruleMergeNode.ts
const caseRuleDefinitions = state.caseRuleDefinitions ?? [];
const caseRuleResults = caseRuleDefinitions.map((definition) => {
  const matched = merged.mergedRuleAuditResults.find((item) => item.rule_id === definition.rule_id);
  return {
    rule_id: definition.rule_id,
    rule_name: definition.rule_name,
    priority: definition.priority,
    rule_source: definition.rule_source,
    result: matched?.result ?? "待人工复核",
    conclusion: matched?.conclusion ?? "缺少最终规则判定结果。",
    hard_gate_triggered: definition.priority === "P0" && matched?.result === "不满足",
  };
});

return {
  agentRunStatus: merged.agentRunStatus,
  agentAssistedRuleResults: merged.agentAssistedRuleResults ?? undefined,
  mergedRuleAuditResults: merged.mergedRuleAuditResults,
  caseRuleResults,
};
```

```ts
// src/nodes/reportGenerationNode.ts
const caseRuleResults = state.caseRuleResults ?? [];
```

- [ ] **Step 4: 更新 schema 并让测试转绿**

```json
"case_rule_results": {
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "rule_id": { "type": "string" },
      "rule_name": { "type": "string" },
      "priority": { "type": "string", "enum": ["P0", "P1"] },
      "rule_source": { "type": "string", "enum": ["must_rule", "should_rule"] },
      "result": { "type": "string", "enum": ["满足", "不满足", "不涉及", "待人工复核"] },
      "conclusion": { "type": "string" },
      "hard_gate_triggered": { "type": "boolean" }
    },
    "required": [
      "rule_id",
      "rule_name",
      "priority",
      "rule_source",
      "result",
      "conclusion",
      "hard_gate_triggered"
    ],
    "additionalProperties": false
  }
}
```

Run: `node --import tsx --test tests/agent-assisted-rule.test.ts tests/scoring.test.ts tests/schema-validator.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/agent/ruleAssistance.ts src/scoring/scoringEngine.ts src/nodes/ruleMergeNode.ts src/nodes/scoringOrchestrationNode.ts src/nodes/reportGenerationNode.ts references/scoring/report_result_schema.json tests/agent-assisted-rule.test.ts tests/scoring.test.ts tests/schema-validator.test.ts
git commit -m "feat: score and report case rule results"
```

## Task 5: Render and Persist Case Rule Results in HTML and Workflow Outputs

**Files:**
- Modify: `src/report/renderer/buildHtmlReportViewModel.ts`
- Modify: `src/report/renderer/renderHtmlReport.ts`
- Modify: `src/nodes/persistAndUploadNode.ts`
- Modify: `tests/report-renderer.test.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 HTML 报告区块和工作流回归结果**

```ts
test("renderHtmlReport renders case rule section with priority and hard gate state", () => {
  const html = renderHtmlReport(
    buildHtmlReportViewModel(
      makeResultJson({
        case_rule_results: [
          {
            rule_id: "HM-REQ-008-01",
            rule_name: "必须使用 LoginWithHuaweiIDButton",
            priority: "P0",
            rule_source: "must_rule",
            result: "不满足",
            conclusion: "未使用 LoginWithHuaweiIDButton",
            hard_gate_triggered: true,
          },
        ],
      }),
    ),
  );

  assert.match(html, /用例规则结果/);
  assert.match(html, /HM-REQ-008-01/);
  assert.match(html, /P0/);
  assert.match(html, /已触发硬门槛/);
});

test("runScoreWorkflow includes case_rule_results and generated patch output", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "实现登录流程",
    withPatch: false,
  });

  await fs.writeFile(
    path.join(fixtureCaseDir, "expected_constraints.yaml"),
    [
      "constraints:",
      "  - id: HM-REQ-008-01",
      "    name: 必须使用 LoginWithHuaweiIDButton",
      "    description: 登录页必须使用 LoginWithHuaweiIDButton",
      "    priority: P0",
      "    rules:",
      "      - target: '**/pages/*.ets'",
      "        ast:",
      "          - type: call",
      "            name: LoginWithHuaweiIDButton",
      "        llm: 检查登录按钮",
    ].join("\\n"),
    "utf-8",
  );

  const caseInput = await loadCaseFromPath(fixtureCaseDir);
  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  assert.equal(Array.isArray((result.resultJson as Record<string, unknown>).case_rule_results), true);
  const generatedPatchText = await fs.readFile(
    path.join(caseDir, "intermediate", "generated.patch"),
    "utf-8",
  );
  assert.match(generatedPatchText, /diff --git/);
});
```

- [ ] **Step 2: 运行测试，确认报告和工作流输出尚未包含 case rule 区块**

Run: `node --import tsx --test tests/report-renderer.test.ts tests/score-agent.test.ts`

Expected: FAIL，提示 HTML 中缺少“用例规则结果”，或 `result.json` 不含 `case_rule_results`。

- [ ] **Step 3: 扩展报告 view model 和 renderer**

```ts
// src/report/renderer/buildHtmlReportViewModel.ts
caseRules: {
  items: Array<{
    ruleId: string;
    ruleName: string;
    priority: string;
    result: string;
    conclusion: string;
    hardGateTriggered: boolean;
  }>;
  emptyState: string;
};
```

```ts
const caseRuleResults = Array.isArray(resultJson.case_rule_results)
  ? resultJson.case_rule_results
  : [];

caseRules: {
  items: caseRuleResults.map((item) => {
    const current = asRecord(item);
    return {
      ruleId: String(current.rule_id ?? ""),
      ruleName: String(current.rule_name ?? ""),
      priority: String(current.priority ?? ""),
      result: String(current.result ?? ""),
      conclusion: String(current.conclusion ?? ""),
      hardGateTriggered: Boolean(current.hard_gate_triggered),
    };
  }),
  emptyState: "当前没有可展示的用例规则结果。",
},
```

```ts
// src/report/renderer/renderHtmlReport.ts
<a href="#case-rules">用例规则</a>

<section id="case-rules" class="section-card">
  <div class="section-title">
    <h2>用例规则结果</h2>
    <small>展示 expected_constraints.yaml 转换后的规则结果</small>
  </div>
  ${
    viewModel.caseRules.items.length > 0
      ? viewModel.caseRules.items
          .map(
            (item) => `
              <article class="rule-row">
                <div class="rule-head">
                  <strong>${escapeHtml(item.ruleId)} · ${escapeHtml(item.ruleName)}</strong>
                  <span class="rule-status ${escapeHtml(item.result)}">${escapeHtml(item.result)}</span>
                </div>
                <p class="muted">优先级 ${escapeHtml(item.priority)} · ${item.hardGateTriggered ? "已触发硬门槛" : "未触发硬门槛"}</p>
                <p>${escapeHtml(item.conclusion)}</p>
              </article>`
          )
          .join("")
      : `<p class="empty-state">${escapeHtml(viewModel.caseRules.emptyState)}</p>`
  }
</section>
```

- [ ] **Step 4: 落盘中间产物并跑整组回归**

```ts
// src/nodes/persistAndUploadNode.ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/case-rule-definitions.json",
  state.caseRuleDefinitions ?? [],
);
```

Run: `npm test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/report/renderer/buildHtmlReportViewModel.ts src/report/renderer/renderHtmlReport.ts src/nodes/persistAndUploadNode.ts tests/report-renderer.test.ts tests/score-agent.test.ts
git commit -m "feat: render case rule results in report outputs"
```

## Task 6: Final Verification and Cleanup

**Files:**
- Modify: none unless failures require targeted fixes
- Verify: `tests/case-constraint-loader.test.ts`
- Verify: `tests/task-understanding-node.test.ts`
- Verify: `tests/rule-engine.test.ts`
- Verify: `tests/agent-assisted-rule.test.ts`
- Verify: `tests/scoring.test.ts`
- Verify: `tests/schema-validator.test.ts`
- Verify: `tests/report-renderer.test.ts`
- Verify: `tests/score-agent.test.ts`

- [ ] **Step 1: 运行分层测试，确认新链路先局部稳定**

Run: `node --import tsx --test tests/case-constraint-loader.test.ts tests/task-understanding-node.test.ts tests/rule-engine.test.ts`

Expected: PASS

- [ ] **Step 2: 运行评分与报告相关测试，确认 schema 与 UI 输出稳定**

Run: `node --import tsx --test tests/agent-assisted-rule.test.ts tests/scoring.test.ts tests/schema-validator.test.ts tests/report-renderer.test.ts`

Expected: PASS

- [ ] **Step 3: 运行工作流回归和全量测试**

Run: `node --import tsx --test tests/score-agent.test.ts`

Expected: PASS

Run: `npm test`

Expected: PASS，且没有因为 `case_rule_results`、自动 patch 或运行时 case rules 引入新的回归失败。

- [ ] **Step 4: 运行 lint，确认没有类型或风格残留问题**

Run: `npm run lint`

Expected: PASS

- [ ] **Step 5: Final Commit**

```bash
git add src/types.ts src/io/caseLoader.ts src/rules/caseConstraintLoader.ts src/nodes/taskUnderstandingNode.ts src/workflow/state.ts src/rules/engine/ruleTypes.ts src/rules/engine/rulePackRegistry.ts src/rules/evaluators/caseConstraintEvaluator.ts src/rules/ruleEngine.ts src/nodes/ruleAuditNode.ts src/agent/ruleAssistance.ts src/scoring/scoringEngine.ts src/nodes/scoringOrchestrationNode.ts src/nodes/reportGenerationNode.ts src/report/renderer/buildHtmlReportViewModel.ts src/report/renderer/renderHtmlReport.ts src/nodes/persistAndUploadNode.ts references/scoring/report_result_schema.json tests/case-constraint-loader.test.ts tests/task-understanding-node.test.ts tests/rule-engine.test.ts tests/agent-assisted-rule.test.ts tests/scoring.test.ts tests/schema-validator.test.ts tests/report-renderer.test.ts tests/score-agent.test.ts
git commit -m "feat: support case constraint rule packs in scoring workflow"
```
