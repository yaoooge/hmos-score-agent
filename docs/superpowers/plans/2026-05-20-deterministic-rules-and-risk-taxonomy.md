# 确定性规则与工程风险枚举实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让内置规则和用例规则一样以 YAML 作为运行时规则源，直接进入静态检验和 agent payload 生成阶段；Code Linter 结论只在规则合并阶段进入评分；风险项从工程级、语言级、需求实现级 taxonomy 中选择，减少同一问题因自由命名造成的一致性波动。

**Spec:** [docs/superpowers/specs/2026-05-20-deterministic-scoring-and-risk-taxonomy-design.md](/Users/guoyutong/MyWorkSpace/hmos-score-agent/docs/superpowers/specs/2026-05-20-deterministic-scoring-and-risk-taxonomy-design.md)

**Architecture:** 沿用现有 LangGraph、`src/rules/**`、`src/scoring/**`、`web/src/pages/scoreConsistencyAnalysis.ts`。不新增规则服务、数据库或第二套评分引擎。内置规则 YAML 是 source of truth；旧 TS rule arrays 不再作为运行时真源，也不再走“TS 导出 YAML”的路径。

**Tech Stack:** TypeScript、Node 内置 test runner、`js-yaml`、现有 rule engine / scoring / consistency analysis。

---

## 关键决策

可以把当前内置规则像用例规则一样直接采用 YAML 格式进入后续静态检验和 payload 生成阶段，而且这是本轮应采用的主路径。

必要性不是为了枚举 `pass/fail/not_applicable/review` 触发条件，而是为了消除当前“双真源”问题：`references/rules/*.yaml` 已经存在，但 `rulePackRegistry.ts` 仍从 `src/rules/packs/**` 的 TS 数组加载运行时规则。继续保留 TS 为真源会导致 YAML、静态检验、agent payload 三处表达不一致，也会让规则口径调整依赖代码发布。

本计划明确不做以下事情：

- 不实现通用 `decision_triggers` / trigger executor。
- 不用“没有命中反例 pattern”推断规则满足。
- 不把 Code Linter findings、summary、conclusion 放进 rule agent prompt。
- 不通过 `rulePackYamlExporter` 或 `generateRulePackYaml.ts` 生成内置规则 YAML。
- 不把风险名扩张成业务 case 级枚举。

## 规则 YAML 边界

内置规则沿用当前 `references/rules/arkts-language.yaml` 的结构，并在必要时小幅扩展：

```yaml
name: ...
version: ...
summary: ...
rule_pack_meta:
  pack_id: arkts-language
  source_name: ...
  source_version: ...
must_rules:
  - id: ARKTS-MUST-001
    rule: ...
    detector_kind: text_pattern
    detector_config: {}
    fallback_policy: agent_assisted
    decision_criteria:
      pass: []
      fail: []
      not_applicable: []
      review: []
should_rules: []
forbidden_patterns: []
```

字段含义：

- `rule` 映射到运行时 `RegisteredRule.summary`。
- `must_rules` / `should_rules` / `forbidden_patterns` 映射到 `rule_source`。
- `detector_kind` 和 `detector_config` 继续驱动现有静态 evaluator。
- `decision_criteria` 只作为 rule agent prompt 的判定口径，不作为静态执行条件。
- `case_constraint` 类型继续使用 `targetPatterns`、`targetChecks`、`llmPrompt`、`kit`，与用例规则 loader 的输出形态保持一致。

---

### Task 1: 让内置规则 YAML 成为运行时主数据源

**Why:** 这是必须做的基础任务。它不是补 trigger 条件，也不是实现新判定器，而是把已有 `references/rules/*.yaml` 接入 `rulePackRegistry`，让静态检验、agent 候选、payload 生成都读取同一份 YAML。否则规则仍由 TS 数组决定，YAML 只是一份旁路资料，一致性问题会继续存在。

**Files:**
- Create: `src/rules/engine/rulePackYamlLoader.ts`
- Modify: `src/rules/engine/rulePackRegistry.ts`
- Modify: `src/rules/engine/ruleTypes.ts`
- Modify/Delete as needed: `tests/rule-pack-yaml-export.test.ts`
- Test: `tests/rule-pack-yaml-loader.test.ts`
- Test: `tests/rule-pack-registry.test.ts`

- [ ] **Step 1: 写 loader 失败测试**

创建 `tests/rule-pack-yaml-loader.test.ts`，断言 loader 能直接读取当前三份 YAML：

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRegisteredRulePacksFromYamlDirectory } from "../src/rules/engine/rulePackYamlLoader.js";

test("loads built-in rule packs directly from references/rules yaml", () => {
  const packs = loadRegisteredRulePacksFromYamlDirectory(path.resolve(process.cwd(), "references/rules"));
  assert.deepEqual(
    packs.map((pack) => pack.packId).sort(),
    ["arkts-language", "arkts-performance", "cross-device-adaptation"],
  );
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "ARKTS-MUST-002"));
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "RSP-MUST-01"));
});
```

- [ ] **Step 2: 写 registry 失败测试**

在 `tests/rule-pack-registry.test.ts` 增加断言：

```ts
test("registered rule packs use yaml source of truth", () => {
  const packs = getRegisteredRulePacks();
  const language = packs.find((pack) => pack.packId === "arkts-language");
  assert.ok(language);
  assert.ok(language.rules.some((rule) => rule.rule_id === "ARKTS-MUST-002"));
});
```

- [ ] **Step 3: 实现同步 YAML loader**

新增 `src/rules/engine/rulePackYamlLoader.ts`。为避免把全链路改成 async，loader 使用 `fs.readFileSync` 在 registry 初始化时读取 YAML。

映射规则：

```text
rule_pack_meta.pack_id -> RegisteredRule.pack_id / RegisteredRulePack.packId
name -> RegisteredRulePack.displayName
must_rules[] -> rule_source = must_rule
should_rules[] -> rule_source = should_rule
forbidden_patterns[] -> rule_source = forbidden_pattern
rule.id -> rule_id
rule.rule -> summary
rule.detector_kind -> detector_kind
rule.detector_config -> detector_config
rule.fallback_policy -> fallback_policy
rule.rule_name -> rule_name
rule.priority -> priority
rule.decision_criteria -> decision_criteria
```

loader 只做字段校验、默认值填充和类型归一，不执行规则、不导出 YAML。

- [ ] **Step 4: 扩展最小规则类型**

在 `src/rules/engine/ruleTypes.ts` 增加：

```ts
export interface RuleDecisionCriteria {
  pass?: string[];
  fail?: string[];
  not_applicable?: string[];
  review?: string[];
}
```

并给 `RegisteredRule` 增加：

```ts
decision_criteria?: RuleDecisionCriteria;
```

不新增通用 trigger 字段。

- [ ] **Step 5: registry 改为从 YAML 加载**

修改 `src/rules/engine/rulePackRegistry.ts`：

- 移除对 `src/rules/packs/arkts-language/*.ts`、`arkts-performance/*.ts`、`cross-device-adaptation/*.ts` 的运行时 import。
- 使用 `loadRegisteredRulePacksFromYamlDirectory(path.resolve(process.cwd(), "references/rules"))` 初始化 `registeredRulePacks`。
- 保持 `resolveEnabledRulePackIds`、`getRegisteredRulePacks`、`getEnabledRulePacks`、`listRegisteredRules` 对外签名不变。

- [ ] **Step 6: 处理旧 YAML 导出测试**

旧导出链路不再是计划路径。删除或改写 `tests/rule-pack-yaml-export.test.ts`，避免继续要求 `rulePackYamlExporter` 或 `generateRulePackYaml.ts` 参与主流程。若暂时保留旧工具，测试也只能标注为 legacy utility，不允许作为运行时依赖。

- [ ] **Step 7: 运行测试**

Run:

```bash
node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-pack-registry.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/rules/engine/rulePackYamlLoader.ts src/rules/engine/rulePackRegistry.ts src/rules/engine/ruleTypes.ts tests/rule-pack-yaml-loader.test.ts tests/rule-pack-registry.test.ts tests/rule-pack-yaml-export.test.ts
git commit -m "feat: load built-in rule packs from yaml"
```

只提交实际改动文件。

---

### Task 2: 将 agent 判定标准作为 YAML prompt 口径传递

**Why:** 这里补的是 agent 判定口径，不是静态触发条件。`decision_criteria` 解决的是 agent 对“满足 / 不满足 / 不涉及 / 待复核”的解释稳定性，不负责自动判定。

**Files:**
- Modify: `references/rules/arkts-language.yaml`
- Modify: `references/rules/arkts-performance.yaml`
- Modify: `references/rules/cross-device-adaptation.yaml`
- Modify: `src/types.ts`
- Modify: `src/rules/ruleEngine.ts`
- Modify: `src/agent/ruleAssistance.ts`
- Test: `tests/rule-agent-decision-criteria.test.ts`

- [ ] **Step 1: 写 prompt 失败测试**

创建 `tests/rule-agent-decision-criteria.test.ts`，构造一个带 `decision_criteria` 的 assisted candidate，断言 payload 保留标准，同时不包含 Code Linter：

```ts
test("rule agent payload includes yaml decision criteria but excludes official linter", () => {
  const payload = buildAgentBootstrapPayload({
    // existing minimal input...
    assistedRuleCandidates: [
      {
        rule_id: "ARKTS-MUST-001",
        rule_source: "must_rule",
        why_uncertain: "需要语义判定",
        local_preliminary_signal: "unknown",
        evidence_files: [],
        evidence_snippets: [],
        decision_criteria: {
          fail: ["存在标识符冲突导致类型、枚举、接口或命名空间语义不唯一。"],
          review: ["证据不足，需人工复核。"],
        },
      },
    ],
  } as never);

  const text = JSON.stringify(payload);
  assert.match(text, /decision_criteria/);
  assert.doesNotMatch(text, /OFFICIAL-LINTER/);
});
```

- [ ] **Step 2: 扩展最小 payload 类型**

在 `src/types.ts` 的 `AssistedRuleCandidate` 增加：

```ts
decision_criteria?: RuleDecisionCriteria;
```

从 `src/rules/engine/ruleTypes.ts` 复用类型，避免重复定义。

- [ ] **Step 3: rule engine 透传 criteria**

在 `src/rules/ruleEngine.ts` 构造 `assistedRuleCandidates` 时，把 `registeredRule?.decision_criteria` 透传到 candidate。

不要把 Code Linter state 传入这个流程。

- [ ] **Step 4: YAML 中只给高波动规则补充 criteria**

优先给需要 agent 判定且当前波动大的规则补充 `decision_criteria`，例如：

```yaml
decision_criteria:
  pass:
    - 已明确使用规范 API 或类型约束完成需求，且没有发现相反证据。
  fail:
    - 缺失关键 API 调用、语言约束违规或实现与需求目标明显偏离。
  not_applicable:
    - 当前工程没有对应场景或目标文件。
  review:
    - 证据不足，无法仅凭 patch 和目标文件确认。
```

不要要求所有规则一次性补齐，不写通用 pattern trigger。

- [ ] **Step 5: 运行测试**

Run:

```bash
node --import tsx --test tests/rule-agent-decision-criteria.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add references/rules src/types.ts src/rules/ruleEngine.ts src/agent/ruleAssistance.ts tests/rule-agent-decision-criteria.test.ts
git commit -m "feat: pass yaml decision criteria to rule agent"
```

---

### Task 3: 锁定 Code Linter 只在规则合并阶段进入评分

**Files:**
- Test: `tests/rule-agent-linter-boundary.test.ts`
- Test: `tests/rule-merge-node.test.ts`
- Modify only if failing: `src/nodes/ruleAgentPromptBuilderNode.ts`
- Modify only if failing: `src/nodes/ruleMergeNode.ts`

- [ ] **Step 1: 写 rule agent 边界测试**

创建 `tests/rule-agent-linter-boundary.test.ts`，构造带 `officialLinterRuleResults` 的 state，调用 `ruleAgentPromptBuilderNode`，断言输出 payload 不包含：

```text
OFFICIAL-LINTER
官方 Code Linter
officialLinterRuleResults
officialLinterSummary
```

- [ ] **Step 2: 写 merge 测试**

创建 `tests/rule-merge-node.test.ts`，断言 `ruleMergeNode` 会把：

```text
deterministicRuleResults + officialLinterRuleResults + assisted results
```

合并为 `mergedRuleAuditResults`，且顺序稳定。

- [ ] **Step 3: 运行测试**

Run:

```bash
node --import tsx --test tests/rule-agent-linter-boundary.test.ts tests/rule-merge-node.test.ts
```

Expected: PASS。若失败，只修对应边界，不把 linter 内容塞进 rule agent。

- [ ] **Step 4: 提交**

```bash
git add tests/rule-agent-linter-boundary.test.ts tests/rule-merge-node.test.ts src/nodes/ruleAgentPromptBuilderNode.ts src/nodes/ruleMergeNode.ts
git commit -m "test: lock official linter merge boundary"
```

只提交实际改动文件。

---

### Task 4: 建立工程级风险 taxonomy YAML

**Why:** 风险 taxonomy 不应按单个业务 case 命名。它的职责是把 agent 的自由文本风险收敛到稳定、可复用的工程问题类别，便于评分融合和一致性分析使用稳定 key。

**Files:**
- Create: `references/risks/risk-taxonomy.yaml`
- Create: `src/scoring/riskTaxonomy.ts`
- Modify: `src/types.ts`
- Test: `tests/risk-taxonomy.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/risk-taxonomy.test.ts`：

```ts
test("risk taxonomy loads engineering language and requirement risks", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "REQUIREMENT_NOT_IMPLEMENTED"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "LANGUAGE_CONSTRAINT_VIOLATION"));
  assert.ok(taxonomy.entries.some((entry) => entry.code === "BUILD_OR_RESOURCE_ISSUE"));
});

test("normalizeRiskItem uses taxonomy title and level for known risk_code", () => {
  const taxonomy = loadRiskTaxonomy(path.resolve(process.cwd(), "references/risks/risk-taxonomy.yaml"));
  const risk = normalizeRiskItem({
    id: 1,
    level: "low",
    title: "随意生成的标题",
    description: "关键需求没有实现。",
    evidence: "EntryAbility.ets",
    risk_code: "REQUIREMENT_NOT_IMPLEMENTED",
  }, taxonomy);

  assert.equal(risk.level, "high");
  assert.equal(risk.title, "需求未实现");
});
```

- [ ] **Step 2: 创建风险枚举 YAML**

创建 `references/risks/risk-taxonomy.yaml`：

```yaml
version: v1
entries:
  - code: REQUIREMENT_NOT_IMPLEMENTED
    level: high
    title: 需求未实现
    description: 需求目标、关键约束或验收点没有在生成代码中落地。
    matchHints: [未实现, 缺失功能, 需求偏离, 关键约束缺失]
  - code: REQUIREMENT_PARTIALLY_IMPLEMENTED
    level: medium
    title: 需求实现不完整
    description: 需求已有部分实现，但关键路径、边界场景或兜底逻辑缺失。
    matchHints: [部分实现, 兜底不足, 边界缺失, 实现不完整]
  - code: API_USAGE_DEVIATION
    level: high
    title: 核心 API 使用偏离
    description: 关键能力没有按要求使用框架 API、平台接口或指定调用方式。
    matchHints: [API 偏离, 未使用指定 API, 平台接口缺失, 调用方式错误]
  - code: LANGUAGE_CONSTRAINT_VIOLATION
    level: medium
    title: 语言约束违规
    description: ArkTS / TypeScript 类型、语法或语言约束不符合要求。
    matchHints: [类型违规, 语法违规, ArkTS, any, unknown]
  - code: UI_LAYOUT_OR_BREAKPOINT_MISMATCH
    level: medium
    title: 布局或断点不匹配
    description: 布局、断点、列表、网格或响应式策略与要求不一致。
    matchHints: [断点, Grid, List, WaterFlow, 响应式]
  - code: PERFORMANCE_OR_LIFECYCLE_RISK
    level: medium
    title: 性能或生命周期风险
    description: 存在重复计算、热点路径低效、监听释放不完整或生命周期处理不稳。
    matchHints: [性能, 生命周期, 监听, 重复计算, 释放]
  - code: BUILD_OR_RESOURCE_ISSUE
    level: medium
    title: 构建或资源问题
    description: 构建流程、资源引用、配置、依赖或模块边界存在问题。
    matchHints: [构建, 资源, 配置, 依赖, 模块]
  - code: READABILITY_OR_MAINTAINABILITY_RISK
    level: low
    title: 可读性或可维护性下降
    description: 命名、结构、注释或重复代码影响后续 review 和维护。
    matchHints: [可读性, 可维护性, 命名, 注释, 重复代码]
```

- [ ] **Step 3: 实现 taxonomy loader**

新增 `src/scoring/riskTaxonomy.ts`。与 rule loader 一样保持简单同步加载：

```ts
export type RiskTaxonomyLevel = "low" | "medium" | "high";

export interface RiskTaxonomyEntry {
  code: string;
  level: RiskTaxonomyLevel;
  title: string;
  description: string;
  matchHints: string[];
}

export interface RiskTaxonomy {
  version: string;
  entries: RiskTaxonomyEntry[];
}
```

提供：

```ts
loadRiskTaxonomy(filePath: string): RiskTaxonomy
findRiskTaxonomyEntry(taxonomy: RiskTaxonomy, code?: string): RiskTaxonomyEntry | undefined
normalizeRiskItem(risk: RiskItem, taxonomy: RiskTaxonomy): RiskItem
```

- [ ] **Step 4: 扩展最小风险字段**

在 `src/types.ts` 的 `RiskItem` 增加：

```ts
risk_code?: string;
risk_category?: "low" | "medium" | "high";
source_rule_id?: string;
```

不新增业务专用字段。

- [ ] **Step 5: 运行测试**

Run:

```bash
node --import tsx --test tests/risk-taxonomy.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add references/risks/risk-taxonomy.yaml src/scoring/riskTaxonomy.ts src/types.ts tests/risk-taxonomy.test.ts
git commit -m "feat: add engineering risk taxonomy"
```

---

### Task 5: 让 rubric agent 从风险 taxonomy 中选择风险

**Files:**
- Modify: `src/types.ts`
- Modify: `src/nodes/rubricPreparationNode.ts`
- Modify: `src/agent/ruleAssistance.ts`
- Modify: `src/agent/opencodeRubricPrompt.ts`
- Modify: `src/agent/opencodeRubricScoring.ts`
- Test: `tests/rubric-risk-taxonomy-prompt.test.ts`

- [ ] **Step 1: 写 prompt 失败测试**

创建 `tests/rubric-risk-taxonomy-prompt.test.ts`，断言 rubric payload / prompt 包含：

```text
risk_taxonomy
REQUIREMENT_NOT_IMPLEMENTED
不要创造新的风险名称
risk_code
```

- [ ] **Step 2: 扩展 `LoadedRubricSnapshot`**

在 `src/types.ts` 增加可选摘要：

```ts
risk_taxonomy?: Array<{
  code: string;
  level: "low" | "medium" | "high";
  title: string;
  description: string;
}>;
```

- [ ] **Step 3: rubric preparation 加载 taxonomy**

在 `src/nodes/rubricPreparationNode.ts` 中，根据 `referenceRoot` 推导 `references/risks/risk-taxonomy.yaml`，加载后注入 `rubricSnapshot.risk_taxonomy`。

不要把 taxonomy 加入 rule agent bootstrap payload。

- [ ] **Step 4: 修改 rubric prompt 约束**

在 `src/agent/opencodeRubricPrompt.ts` 中增加明确约束：

```text
risks 必须优先从 risk_taxonomy 中选择 risk_code、level 和 title；不要创造新的风险名称。只有确实无法匹配时，risk_code 可省略，但 title 仍应简洁稳定。
```

- [ ] **Step 5: 扩展 rubric agent 输出 schema**

在 `src/agent/opencodeRubricScoring.ts` 的风险 schema 增加：

```ts
risk_code: z.string().min(1).optional(),
risk_category: z.enum(["low", "medium", "high"]).optional(),
source_rule_id: z.string().min(1).optional(),
```

- [ ] **Step 6: 运行测试**

Run:

```bash
node --import tsx --test tests/rubric-risk-taxonomy-prompt.test.ts tests/opencode-config.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/types.ts src/nodes/rubricPreparationNode.ts src/agent/ruleAssistance.ts src/agent/opencodeRubricPrompt.ts src/agent/opencodeRubricScoring.ts tests/rubric-risk-taxonomy-prompt.test.ts
git commit -m "feat: constrain rubric risks with taxonomy"
```

只提交实际改动文件。

---

### Task 6: 在评分融合阶段归一化风险

**Files:**
- Modify: `src/scoring/scoreFusion.ts`
- Modify: `src/nodes/scoreFusionOrchestrationNode.ts`
- Test: `tests/score-fusion.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/score-fusion.test.ts` 增加：

- 规则违规生成 `risk_code = RULE_VIOLATION:<rule_id>` 和 `source_rule_id`。
- rubric agent 输出已知 `risk_code` 时，`level/title` 被 taxonomy 覆盖为稳定值。

- [ ] **Step 2: 给 score fusion 增加 taxonomy 输入**

在 `src/scoring/scoreFusion.ts` 的 `FuseRubricScoreWithRulesInput` 增加：

```ts
riskTaxonomy?: RiskTaxonomy;
```

- [ ] **Step 3: 归一化 rubric risks**

初始化 risks 时：

```ts
const risks = (input.rubricScoringResult?.risks ?? []).map((risk, index) => {
  const withId = { ...risk, id: index + 1 };
  return input.riskTaxonomy ? normalizeRiskItem(withId, input.riskTaxonomy) : withId;
});
```

- [ ] **Step 4: 给规则风险加稳定 key**

规则违规风险增加：

```ts
risk_code: `RULE_VIOLATION:${rule.rule_id}`,
source_rule_id: rule.rule_id,
```

- [ ] **Step 5: orchestration 传入 taxonomy**

在 `src/nodes/scoreFusionOrchestrationNode.ts` 加载同一份 taxonomy 并传给 `fuseRubricScoreWithRules`。

- [ ] **Step 6: 运行测试**

Run:

```bash
node --import tsx --test tests/score-fusion.test.ts tests/risk-taxonomy.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/scoring/scoreFusion.ts src/nodes/scoreFusionOrchestrationNode.ts tests/score-fusion.test.ts
git commit -m "feat: normalize risks during score fusion"
```

---

### Task 7: 拆分一致性指标并使用稳定风险 key

**Files:**
- Modify: `web/src/pages/scoreConsistencyAnalysis.ts`
- Test: `tests/score-consistency-analysis.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/score-consistency-analysis.test.ts` 增加：

- `risk_code` 优先作为风险 key。
- `source_rule_id` 次优先作为风险 key。
- 输出 `scoreStability`、`gateStability`、`findingStability`。

- [ ] **Step 2: 修改风险 key 生成优先级**

在 `extractConsistencyRunSummary` 中使用：

```ts
const key = riskCode
  ? `risk_code|${riskCode}`
  : sourceRuleId
    ? `source_rule|${sourceRuleId}`
    : `${normalizeText(level).toLowerCase()}|${normalizeText(identityText)}`;
```

- [ ] **Step 3: 增加拆分指标**

在 `analyzeConsistency` 返回对象中保留现有 `consistencyPercentage`，新增：

```ts
scoreStability: {
  average,
  median,
  min,
  max,
  standardDeviation,
},
gateStability: {
  majorityHardGateTriggered,
  hardGateConsistencyPercentage,
},
findingStability: {
  averageRuleJaccard,
  averageRiskJaccard,
},
```

- [ ] **Step 4: 优化结论文案**

当分数标准差低但 finding Jaccard 低时，结论中明确输出：

```text
总分稳定，但规则或风险集合存在波动。
```

- [ ] **Step 5: 运行测试**

Run:

```bash
node --import tsx --test tests/score-consistency-analysis.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/scoreConsistencyAnalysis.ts tests/score-consistency-analysis.test.ts
git commit -m "feat: split score consistency metrics"
```

---

### Task 8: 清理旧 TS 规则真源和导出路径

**Files:**
- Delete or stop importing: `src/rules/packs/arkts-language/*.ts`
- Delete or stop importing: `src/rules/packs/arkts-performance/*.ts`
- Delete or stop importing: `src/rules/packs/cross-device-adaptation/*.ts`
- Delete or mark legacy: `src/rules/engine/rulePackYamlExporter.ts`
- Delete or mark legacy: `src/tools/generateRulePackYaml.ts`
- Modify: `package.json`

- [ ] **Step 1: 确认无运行时 import**

Run:

```bash
rg -n "rules/packs/(arkts-language|arkts-performance|cross-device-adaptation)|rulePackYamlExporter|generateRulePackYaml" src tests package.json
```

Expected: 主运行路径不再引用旧 TS 规则数组和导出脚本。

- [ ] **Step 2: 删除或标记 legacy**

优先删除旧导出脚本和对应 package script。若因历史测试或文档暂时保留，必须加注释说明：

```text
legacy utility only, not used by runtime rule loading
```

旧 TS rule arrays 如果删除成本过高，可以先保留但不被 `rulePackRegistry` import；后续独立清理。

- [ ] **Step 3: 运行回归测试**

Run:

```bash
node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-pack-registry.test.ts tests/rule-engine.test.ts
```

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/rules/packs src/rules/engine/rulePackYamlExporter.ts src/tools/generateRulePackYaml.ts package.json tests
git commit -m "chore: retire generated rule pack path"
```

只提交实际改动文件。

---

### Task 9: 最终验证

**Files:** 不主动修改文件。若验证暴露问题，只修对应问题。

- [ ] **Step 1: 运行核心测试**

Run:

```bash
node --import tsx --test tests/rule-pack-yaml-loader.test.ts tests/rule-pack-registry.test.ts tests/rule-agent-linter-boundary.test.ts tests/rule-merge-node.test.ts tests/risk-taxonomy.test.ts tests/rubric-risk-taxonomy-prompt.test.ts tests/score-fusion.test.ts tests/score-consistency-analysis.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行完整测试**

Run:

```bash
npm test
```

Expected: PASS。

- [ ] **Step 3: 运行构建**

Run:

```bash
npm run build
npm run build:dashboard
```

Expected: PASS。

- [ ] **Step 4: 手工边界检查**

Run:

```bash
rg -n "OFFICIAL-LINTER|officialLinter" src/nodes/ruleAgentPromptBuilderNode.ts src/agent/ruleAssistance.ts
rg -n "risk_taxonomy|risk_code|source_rule_id" src/agent/opencodeRubricPrompt.ts src/agent/opencodeRubricScoring.ts src/scoring web/src/pages/scoreConsistencyAnalysis.ts
rg -n "decision_triggers|decisionTriggers|rulePackYamlExporter|generateRulePackYaml" src references tests package.json
```

Expected:

- rule agent prompt 构建路径没有 Code Linter 结论。
- 风险 taxonomy 只进入 rubric scoring、score fusion 和一致性分析。
- 不存在新的通用 trigger executor。
- 不存在运行时依赖 TS 导出 YAML 的路径。

- [ ] **Step 5: 如有验证修复则提交**

```bash
git add src references tests web package.json
git commit -m "fix: stabilize yaml rule and risk taxonomy integration"
```

如果没有修复，不创建空提交。

---

## 自检清单

- [ ] 内置规则 YAML 是运行时 source of truth。
- [ ] 用例规则和内置规则都进入同一套 `RegisteredRule` / `AssistedRuleCandidate` 结构。
- [ ] `decision_criteria` 只进入 agent prompt，不作为静态触发器。
- [ ] Code Linter 只在 `ruleMergeNode` 合并，不进入 rule agent prompt。
- [ ] 风险 taxonomy 是工程级、语言级、需求实现级分类，不绑定单个业务 case。
- [ ] 风险稳定 key 优先使用 `risk_code`，规则风险使用 `RULE_VIOLATION:<rule_id>`。
- [ ] 一致性分析能区分分数稳定性、硬门槛稳定性和 finding 稳定性。
