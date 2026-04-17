# Static Rule Pack Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前静态规则能力重构为按规则包组织的可扩展结构，引入内部 `未接入判定器` 状态，并让这部分规则正确进入 agent 辅助判定链路。

**Architecture:** 先拆出规则包注册层、静态规则内部结果类型和 evaluator 基础设施，再将 ArkTS 规则迁移到 `arkts-language/{must,forbidden,should}`。`ruleAuditNode` 输出静态结果、确定性结果和 agent 候选，`ruleMergeNode` 只消费归一化后的最终结果，保持对评分与报告层的语义稳定。

**Tech Stack:** TypeScript, Node.js test runner, LangGraph state graph, existing repo-local scoring references

---

### Task 1: 引入静态规则内部结果类型与计数测试

**Files:**
- Create: `src/rules/engine/ruleTypes.ts`
- Modify: `src/types.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/rule-pack-registry.test.ts`

- [ ] **Step 1: 写失败测试，锁定 63 条规则注册数量和内部状态类型需求**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { getRegisteredRulePacks, listRegisteredRules } from "../src/rules/engine/rulePackRegistry.js";

test("arkts-language pack registers all rules from current source set", () => {
  const packs = getRegisteredRulePacks();
  const arktsPack = packs.find((item) => item.packId === "arkts-language");

  assert.ok(arktsPack);
  const rules = listRegisteredRules();
  assert.equal(rules.filter((item) => item.rule_source === "must_rule").length, 30);
  assert.equal(rules.filter((item) => item.rule_source === "should_rule").length, 21);
  assert.equal(rules.filter((item) => item.rule_source === "forbidden_pattern").length, 12);
  assert.equal(rules.length, 63);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- tests/rule-pack-registry.test.ts`
Expected: FAIL，提示 `rulePackRegistry.js` 不存在或注册数量断言失败

- [ ] **Step 3: 定义静态规则内部类型和工作流新增状态字段**

```ts
// src/rules/engine/ruleTypes.ts
export type StaticRuleResult = "满足" | "不满足" | "不涉及" | "未接入判定器";

export interface StaticRuleAuditResult {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  result: StaticRuleResult;
  conclusion: string;
}

export interface RegisteredRule {
  pack_id: string;
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  summary: string;
  detector_kind: "text_pattern" | "project_structure" | "not_implemented";
  detector_config: Record<string, unknown>;
  fallback_policy: "agent_assisted" | "not_applicable";
}
```

```ts
// src/types.ts
export interface AssistedRuleCandidate {
  rule_id: string;
  rule_source: "must_rule" | "should_rule" | "forbidden_pattern";
  why_uncertain: string;
  local_preliminary_signal: "未接入判定器";
  evidence_files: string[];
  evidence_snippets: string[];
}
```

```ts
// src/workflow/state.ts
import { StaticRuleAuditResult } from "../rules/engine/ruleTypes.js";

export const ScoreState = Annotation.Root({
  // ...
  staticRuleAuditResults: Annotation<StaticRuleAuditResult[]>(),
  deterministicRuleResults: Annotation<RuleAuditResult[]>(),
  assistedRuleCandidates: Annotation<AssistedRuleCandidate[]>(),
  // ...
});
```

- [ ] **Step 4: 运行测试，确认类型和状态模型已接入**

Run: `npm test -- tests/rule-pack-registry.test.ts`
Expected: 仍然 FAIL，但错误推进到 `rulePackRegistry` 未实现或规则未注册

- [ ] **Step 5: 提交这个最小类型重构**

```bash
git add src/rules/engine/ruleTypes.ts src/types.ts src/workflow/state.ts tests/rule-pack-registry.test.ts
git commit -m "refactor: add static rule audit internal types"
```

### Task 2: 建立规则包注册表和 ArkTS 规则包骨架

**Files:**
- Create: `src/rules/engine/rulePackRegistry.ts`
- Create: `src/rules/packs/arkts-language/must.ts`
- Create: `src/rules/packs/arkts-language/forbidden.ts`
- Create: `src/rules/packs/arkts-language/should.ts`
- Test: `tests/rule-pack-registry.test.ts`

- [ ] **Step 1: 为 ArkTS 规则包注册写失败断言**

```ts
test("registered rules preserve source ordering within arkts-language pack", () => {
  const rules = listRegisteredRules();

  assert.deepEqual(
    rules.slice(0, 4).map((item) => item.rule_id),
    ["ARKTS-MUST-001", "ARKTS-MUST-002", "ARKTS-MUST-003", "ARKTS-MUST-004"],
  );
  assert.equal(rules.at(-1)?.rule_id, "ARKTS-FORBIDDEN-REACT-001");
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- tests/rule-pack-registry.test.ts`
Expected: FAIL，提示 `listRegisteredRules` 未导出或顺序不符合预期

- [ ] **Step 3: 实现规则包骨架与注册表**

```ts
// src/rules/engine/rulePackRegistry.ts
import { arktsMustRules } from "../packs/arkts-language/must.js";
import { arktsForbiddenRules } from "../packs/arkts-language/forbidden.js";
import { arktsShouldRules } from "../packs/arkts-language/should.js";
import type { RegisteredRule } from "./ruleTypes.js";

const arktsLanguagePack = {
  packId: "arkts-language",
  displayName: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
  rules: [...arktsMustRules, ...arktsShouldRules, ...arktsForbiddenRules],
};

export function getRegisteredRulePacks() {
  return [arktsLanguagePack];
}

export function listRegisteredRules(): RegisteredRule[] {
  return getRegisteredRulePacks().flatMap((item) => item.rules);
}
```

```ts
// src/rules/packs/arkts-language/must.ts
import type { RegisteredRule } from "../../engine/ruleTypes.js";

export const arktsMustRules: RegisteredRule[] = [
  {
    pack_id: "arkts-language",
    rule_id: "ARKTS-MUST-001",
    rule_source: "must_rule",
    summary: "对象属性名必须是合法标识符；禁止依赖数字键或普通字符串键的动态属性访问。",
    detector_kind: "not_implemented",
    detector_config: {},
    fallback_policy: "agent_assisted",
  },
  {
    pack_id: "arkts-language",
    rule_id: "ARKTS-MUST-002",
    rule_source: "must_rule",
    summary: "禁止使用 Symbol() API；仅允许 Symbol.iterator。",
    detector_kind: "text_pattern",
    detector_config: { patterns: ["\\bSymbol\\s*\\("], fileExtensions: [".ets"] },
    fallback_policy: "agent_assisted",
  },
];
```

```ts
// src/rules/packs/arkts-language/forbidden.ts
export const arktsForbiddenRules: RegisteredRule[] = [
  {
    pack_id: "arkts-language",
    rule_id: "ARKTS-FORBIDDEN-REACT-001",
    rule_source: "forbidden_pattern",
    summary: "禁止引入 React/Web 模式代码。",
    detector_kind: "text_pattern",
    detector_config: {
      patterns: ["\\bfrom\\s+['\"]react['\"]", "<div>", "\\buseState\\s*\\("],
      fileExtensions: [".ets"],
    },
    fallback_policy: "agent_assisted",
  },
];
```

- [ ] **Step 4: 补齐三类文件中的 63 条规则条目**

实现要求：
- `must.ts` 中共 30 条
- `should.ts` 中共 21 条
- `forbidden.ts` 中共 12 条
- 当前不能稳定静态判定的规则统一使用 `detector_kind: "not_implemented"`
- 已知可静态判定的规则先填入 `text_pattern` 或 `project_structure`

示例条目：

```ts
{
  pack_id: "arkts-language",
  rule_id: "ARKTS-MUST-005",
  rule_source: "must_rule",
  summary: "禁止使用 var，必须使用 let 或 const。",
  detector_kind: "text_pattern",
  detector_config: { patterns: ["\\bvar\\b"], fileExtensions: [".ets"] },
  fallback_policy: "agent_assisted",
}
```

- [ ] **Step 5: 运行测试，确认注册数量和顺序正确**

Run: `npm test -- tests/rule-pack-registry.test.ts`
Expected: PASS

- [ ] **Step 6: 提交规则包骨架**

```bash
git add src/rules/engine/rulePackRegistry.ts src/rules/packs/arkts-language/must.ts src/rules/packs/arkts-language/should.ts src/rules/packs/arkts-language/forbidden.ts tests/rule-pack-registry.test.ts
git commit -m "feat: add arkts rule pack registry"
```

### Task 3: 实现 evaluator 基础设施并迁移首批静态可判规则

**Files:**
- Create: `src/rules/evaluators/textPatternEvaluator.ts`
- Create: `src/rules/evaluators/projectStructureEvaluator.ts`
- Create: `src/rules/evaluators/shared.ts`
- Modify: `src/rules/engine/ruleEngine.ts`
- Modify: `tests/rule-engine.test.ts`

- [ ] **Step 1: 为 evaluator 行为写失败测试**

```ts
test("runRuleEngine marks unsupported rules as 未接入判定器 instead of 不涉及", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.staticRuleAuditResults.some((item) => item.rule_id === "ARKTS-MUST-001" && item.result === "未接入判定器"),
    true,
  );
});
```

```ts
test("runRuleEngine keeps deterministic results separated from agent candidates", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let x: any = 1;\nvar y = 2;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-MUST-005"), true);
  assert.equal(result.assistedRuleCandidates.some((item) => item.rule_id === "ARKTS-MUST-001"), true);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- tests/rule-engine.test.ts`
Expected: FAIL，提示 `staticRuleAuditResults`、`deterministicRuleResults` 或 `assistedRuleCandidates` 缺失

- [ ] **Step 3: 实现文本判定器和结构判定器**

```ts
// src/rules/evaluators/textPatternEvaluator.ts
import path from "node:path";
import type { RegisteredRule, StaticRuleAuditResult } from "../engine/ruleTypes.js";
import type { CollectedEvidence } from "../evidenceCollector.js";

export function runTextPatternRule(rule: RegisteredRule, evidence: CollectedEvidence): StaticRuleAuditResult & { matchedFiles: string[] } {
  const fileExtensions = ((rule.detector_config.fileExtensions as string[]) ?? []).map((item) => item.toLowerCase());
  const patterns = ((rule.detector_config.patterns as string[]) ?? []).map((item) => new RegExp(item));
  const matchedFiles = evidence.workspaceFiles
    .filter((file) => fileExtensions.includes(path.extname(file.relativePath).toLowerCase()))
    .filter((file) => patterns.some((pattern) => pattern.test(file.content)))
    .map((file) => file.relativePath);

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: matchedFiles.length > 0 ? "不满足" : "满足",
    conclusion: matchedFiles.length > 0 ? `${rule.summary} 检测到规则命中，文件：${matchedFiles.join(", ")}` : "未发现该规则的命中证据。",
    matchedFiles,
  };
}
```

```ts
// src/rules/evaluators/projectStructureEvaluator.ts
export function runProjectStructureRule(rule: RegisteredRule, evidence: CollectedEvidence) {
  const requiredPaths = (rule.detector_config.requiredPaths as string[]) ?? [];
  const workspacePaths = new Set(evidence.workspaceFiles.map((item) => item.relativePath));
  const missingPaths = requiredPaths.filter((item) => !workspacePaths.has(item));

  return {
    rule_id: rule.rule_id,
    rule_source: rule.rule_source,
    result: missingPaths.length > 0 ? "不满足" : "满足",
    conclusion: missingPaths.length > 0 ? `${rule.summary} 缺失路径：${missingPaths.join(", ")}` : "项目结构符合该规则要求。",
    matchedFiles: missingPaths,
  };
}
```

- [ ] **Step 4: 重写规则引擎，使其输出静态结果、确定性结果和 agent 候选**

```ts
// src/rules/engine/ruleEngine.ts
const staticRuleAuditResults = registeredRules.map((rule) => runRegisteredRule(rule, evidence));

const deterministicRuleResults = staticRuleAuditResults
  .filter((item) => item.result !== "未接入判定器")
  .map(({ matchedFiles: _matchedFiles, ...item }) => item);

const assistedRuleCandidates = staticRuleAuditResults
  .filter((item) => item.result === "未接入判定器")
  .map((item) => ({
    rule_id: item.rule_id,
    rule_source: item.rule_source,
    why_uncertain: item.conclusion,
    local_preliminary_signal: "未接入判定器" as const,
    evidence_files: ruleEvidenceIndex[item.rule_id]?.evidenceFiles ?? fallbackEvidenceFiles,
    evidence_snippets: ruleEvidenceIndex[item.rule_id]?.evidenceSnippets ?? fallbackEvidenceSnippets,
  }));
```

- [ ] **Step 5: 迁移首批已知规则**

本阶段至少迁移以下规则为静态可判定：
- `ARKTS-MUST-002`
- `ARKTS-MUST-003`
- `ARKTS-MUST-005`
- `ARKTS-MUST-006`
- `ARKTS-FORBIDDEN-REACT-001`

这些规则全部限制在 `.ets` 文件中执行。

- [ ] **Step 6: 运行测试，确认静态层不再把未接入规则误判为 `不涉及`**

Run: `npm test -- tests/rule-engine.test.ts`
Expected: PASS

- [ ] **Step 7: 提交 evaluator 与规则引擎重构**

```bash
git add src/rules/evaluators/textPatternEvaluator.ts src/rules/evaluators/projectStructureEvaluator.ts src/rules/evaluators/shared.ts src/rules/engine/ruleEngine.ts tests/rule-engine.test.ts
git commit -m "refactor: split static rule evaluators and engine outputs"
```

### Task 4: 打通工作流中的静态结果与 agent 候选链路

**Files:**
- Modify: `src/nodes/ruleAuditNode.ts`
- Modify: `src/nodes/agentPromptBuilderNode.ts`
- Modify: `src/nodes/ruleMergeNode.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: 为工作流中间状态写失败测试**

```ts
test("ruleAuditNode exposes static results and agent candidates separately", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await ruleAuditNode(
    {
      caseInput,
      taskType: "full_generation",
    } as never,
    { referenceRoot },
  );

  assert.equal(Array.isArray(result.staticRuleAuditResults), true);
  assert.equal(Array.isArray(result.deterministicRuleResults), true);
  assert.equal(Array.isArray(result.assistedRuleCandidates), true);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `npm test -- --test-name-pattern="static results and agent candidates separately"`
Expected: FAIL，提示 `staticRuleAuditResults` 未返回

- [ ] **Step 3: 改造 `ruleAuditNode` 与 `agentPromptBuilderNode`**

```ts
// src/nodes/ruleAuditNode.ts
return {
  staticRuleAuditResults: result.staticRuleAuditResults,
  ruleAuditResults: result.deterministicRuleResults,
  deterministicRuleResults: result.deterministicRuleResults,
  assistedRuleCandidates: result.assistedRuleCandidates,
  ruleEvidenceIndex: result.ruleEvidenceIndex,
  ruleViolations: result.ruleViolations,
  evidenceSummary: result.evidenceSummary,
};
```

```ts
// src/nodes/agentPromptBuilderNode.ts
const candidates = state.assistedRuleCandidates ?? [];
await deps.logger?.info(`agent prompt 组装完成 candidates=${candidates.length} deterministic=${(state.deterministicRuleResults ?? []).length}`);
```

- [ ] **Step 4: 调整 `ruleMergeNode`，只对候选规则做 agent 合并**

```ts
if (state.agentRunStatus === "failed" || state.agentRunStatus === "skipped" || !state.agentRawOutputText) {
  const mergedRuleAuditResults = [
    ...(state.deterministicRuleResults ?? []),
    ...(state.assistedRuleCandidates ?? []).map((candidate) => ({
      rule_id: candidate.rule_id,
      rule_source: candidate.rule_source,
      result: "待人工复核" as const,
      conclusion: `静态层未接入判定器，且 agent 不可用，规则 ${candidate.rule_id} 已回退为待人工复核。`,
    })),
  ];
```

- [ ] **Step 5: 增加日志断言，确保 `未接入判定器` 不泄露到最终结果**

```ts
test("runScoreWorkflow keeps 未接入判定器 inside static layer only", async (t) => {
  // ... run workflow
  const mergedAudit = JSON.parse(await fs.readFile(path.join(caseDir, "intermediate", "rule-audit-merged.json"), "utf-8"));
  assert.equal(mergedAudit.some((item: { result: string }) => item.result === "未接入判定器"), false);
});
```

- [ ] **Step 6: 运行相关测试**

Run: `npm test -- tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 7: 提交工作流接线变更**

```bash
git add src/nodes/ruleAuditNode.ts src/nodes/agentPromptBuilderNode.ts src/nodes/ruleMergeNode.ts tests/score-agent.test.ts
git commit -m "feat: route static unsupported rules into agent candidates"
```

### Task 5: 补齐静态可判规则并固定回归测试

**Files:**
- Modify: `src/rules/packs/arkts-language/must.ts`
- Modify: `src/rules/packs/arkts-language/forbidden.ts`
- Modify: `src/rules/packs/arkts-language/should.ts`
- Modify: `tests/rule-engine.test.ts`
- Modify: `tests/score-agent.test.ts`

- [ ] **Step 1: 写规则覆盖回归测试，保证“能静态判的都已接入，剩余都标记未接入”**

```ts
test("runRuleEngine classifies every registered rule into deterministic or agent-assisted", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.length + result.assistedRuleCandidates.length,
    63,
  );
  assert.equal(
    result.staticRuleAuditResults.some((item) => item.result === "未接入判定器"),
    result.assistedRuleCandidates.length > 0,
  );
});
```

- [ ] **Step 2: 运行测试，确认当前失败或覆盖不足**

Run: `npm test -- tests/rule-engine.test.ts`
Expected: FAIL，或出现部分规则未被计入两类结果之一

- [ ] **Step 3: 逐条迁移所有静态可判规则**

本步骤要求逐条阅读 63 条规则，按以下标准补齐：
- 关键词/API/import 可稳定命中的，使用 `text_pattern`
- 文件结构/目录约束可判的，使用 `project_structure`
- 误报风险高、需要语义理解的，保留 `not_implemented`

需要优先补齐的典型类别：
- ArkTS 不支持语法关键字
- 禁止 API / import / library
- 指定文件后缀和目录结构要求
- 明确的声明形式限制

每条规则都必须具有中文 `summary`，最终 `conclusion` 也必须保持中文。

- [ ] **Step 4: 补充代表性正反例测试**

至少新增以下覆盖：
- `Symbol()` 命中与 `Symbol.iterator` 例外
- `var` 命中但 `.js` 文件不命中
- `any/unknown` 命中与普通具体类型不命中
- React import 命中但普通 ArkTS 页面不命中
- 至少 1 条 `should` 规则的静态命中样例

示例：

```ts
test("runRuleEngine allows Symbol.iterator but rejects Symbol()", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "const iter = Symbol.iterator;\nconst bad = Symbol('x');\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-MUST-002" && item.result === "不满足"), true);
});
```

- [ ] **Step 5: 运行完整验证**

Run: `npm test`
Expected: PASS，55+ tests through, 0 failures

Run: `npm run build`
Expected: PASS，`tsc -p tsconfig.json` exit 0

- [ ] **Step 6: 提交规则覆盖补全**

```bash
git add src/rules/packs/arkts-language/must.ts src/rules/packs/arkts-language/should.ts src/rules/packs/arkts-language/forbidden.ts tests/rule-engine.test.ts tests/score-agent.test.ts
git commit -m "feat: expand static arkts rule coverage"
```

## Self-Review

- Spec coverage:
  - 规则包目录结构：Task 2
  - 内部 `未接入判定器` 状态：Task 1、Task 3
  - `ruleAuditNode` 输出拆分：Task 4
  - agent 候选只来自未接入规则：Task 3、Task 4
  - 63 条规则逐条迁移与分类：Task 2、Task 5
- Placeholder scan:
  - 无 `TODO/TBD/implement later` 占位词
  - 每个任务都包含具体文件路径、测试命令和代码骨架
- Type consistency:
  - 内部类型统一使用 `StaticRuleAuditResult`
  - 对外评分结果继续使用 `RuleAuditResult`
  - `AssistedRuleCandidate.local_preliminary_signal` 固定为 `"未接入判定器"`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-static-rule-pack-redesign-implementation.md`.

你之前已经明确后续任务不使用子代理，所以执行方式固定为 Inline Execution。我下一步会按这份计划直接在当前会话里用 TDD 开始实现。
