# 评分稳定性与 taxonomy / canonical 归一设计

## 背景

当前评分链路里，rubric agent 负责维度评分和风险项，rule agent 负责规则违规判定。两边都在描述“问题”，但它们没有共享同一个问题码本，也没有共享同一个 canonical issue，因此同一事实容易被写成两条风险、两次扣分说明，或者两个人工复核入口。

本设计只做一件事：把风险体系收敛成一套共享 taxonomy，再通过 canonical issue 把 rubric 风险和 rule 违规合成一个可追踪、只扣一次的主问题。

## 目标

- rubric 风险和 rule 违规使用同一套问题码。
- 每个 taxonomy code 只落到一个主 rubric 维度/条目，不再在多个维度上重复扣分。
- 同一问题在两个 agent 中出现时，只保留一个主扣分来源，rule 优先。
- 不同规则触发同一个维度时，保留各自的扣分效果，不按维度做合并去重。
- 方案保持精简，不新增第二套规则引擎，也不引入文本相似度去重。

## 非目标

- 不优化 linter。
- 不做基于自然语言相似度的自动聚类。
- 不引入多级 taxonomy 树、继承树或第二套风险分类系统。
- 不改变总分公式和硬门槛逻辑。

## Taxonomy 设计

### 1. 文件结构

`references/risks/risk-taxonomy.yaml` 拆成两类：

- `score_taxonomy`：参与评分和风险合并的主 taxonomy。
- `review_only_taxonomy`：只进人工复核，不参与扣分和 canonical merge。

### 2. 字段结构

`score_taxonomy` 中每条记录只保留一套稳定字段：

- `code`
- `level`
- `title`
- `description`
- `match_hints`
- `primary_item`

其中 `primary_item` 必须是一个对象，只允许一个主落点：

- `primary_item.dimension`
- `primary_item.item`

不允许再拆出第二个主落点。

`review_only_taxonomy` 只保留：

- `code`
- `level`
- `title`
- `description`
- `match_hints`

### 3. 完整 taxonomy

#### score_taxonomy

| code | level | title | primary_item |
| --- | --- | --- | --- |
| `REQUIREMENT_NOT_IMPLEMENTED` | high | 需求未实现 | `full_generation: 架构与职责划分 / 页面/组件职责分离；continuation: 与既有工程一致性 / 复用既有能力程度；bug_fix: 改动精准度与最小侵入性 / 问题点命中程度` |
| `REQUIREMENT_PARTIALLY_IMPLEMENTED` | medium | 需求实现不完整 | `full_generation: 架构与职责划分 / 页面/组件职责分离；continuation: 与既有工程一致性 / 复用既有能力程度；bug_fix: 改动精准度与最小侵入性 / 问题点命中程度` |
| `API_USAGE_DEVIATION` | high | 核心 API 使用偏离 | `all: 平台规范符合度 / HarmonyOS工程实践符合度` |
| `LANGUAGE_CONSTRAINT_VIOLATION` | medium | 语言约束违规 | `all: 代码正确性与静态质量 / ArkTS/ArkUI语法与类型安全` |
| `UI_LAYOUT_OR_BREAKPOINT_MISMATCH` | medium | 布局或断点不匹配 | `full_generation: 平台规范符合度 / ArkUI组织方式合理性；continuation: 与既有工程一致性 / 目录/模块接入一致性；bug_fix: 平台规范符合度 / ArkTS/ArkUI规范符合度` |
| `PERFORMANCE_OR_LIFECYCLE_RISK` | medium | 性能或生命周期风险 | `all: 风险控制与稳定性 / 稳定性风险` |
| `BUILD_OR_RESOURCE_ISSUE` | medium | 构建或资源问题 | `all: 代码正确性与静态质量 / 明显错误密度` |
| `READABILITY_OR_MAINTAINABILITY_RISK` | low | 可读性或可维护性下降 | `all: 可维护性与可读性 / 复杂度控制` |
| `DATA_STATE_CONSISTENCY_RISK` | medium | 数据或状态一致性风险 | `full_generation: 架构与职责划分 / 状态与数据流组织；continuation: 架构与职责划分 / 状态接入合理性；bug_fix: 风险控制与稳定性 / 回归风险控制` |
| `ERROR_HANDLING_OR_VALIDATION_RISK` | medium | 错误处理或校验不足 | `all: 风险控制与稳定性 / 安全与边界意识` |
| `SECURITY_OR_PRIVACY_RISK` | high | 安全或隐私风险 | `all: 风险控制与稳定性 / 安全与边界意识` |
| `EXTERNAL_SERVICE_INTEGRATION_RISK` | medium | 外部服务集成风险 | `all: 平台规范符合度 / HarmonyOS工程实践符合度` |

#### review_only_taxonomy

| code | level | title | 处理方式 |
| --- | --- | --- | --- |
| `EVALUATION_METADATA_RISK` | high | 评审元数据风险 | 仅进人工复核，不参与扣分，不参与 canonical merge |

### 4. 归一原则

- 同一 code 在同一次评分里只能对应一个主落点。
- 如果一个风险描述同时沾多个维度，优先保留最直接、最根因的那个落点，其余只留在 `description`、`main_issues` 或 `reason`，不要再拆第二个扣分项。
- 但只要是不同规则、不同证据锚点、不同 `issue_id`，即使最终命中同一个维度，也必须保留各自扣分，不得按维度汇总成一条。
- review-only taxonomy 不得进入扣分链路。
- 任何“看起来相关”的次级后果，都不能再单独生成一个新的 taxonomy code。

## Canonical 设计

### 1. Canonical issue

`scoreFusion` 内部只使用一个最小 canonical 结构，不向外扩张第二套风险系统。

```ts
type CanonicalIssueSource = "rubric" | "rule" | "build" | "manual";

interface CanonicalIssue {
  issue_id: string;
  canonical_code: string;
  source: CanonicalIssueSource;
  primary_dimension: string;
  primary_item: string;
  evidence_anchor: string;
  severity: "low" | "medium" | "high";
  related_rule_id?: string;
  related_risk_code?: string;
}
```

### 2. `issue_id` 规则

`issue_id = <canonical_code>:<task_type>:<primary_dimension>:<primary_item>:<evidence_anchor>`

其中：

- `canonical_code` 优先取 score taxonomy 的 `code`。
- rule 侧如果存在稳定映射，也必须映射到同一个 `canonical_code`。
- canonical merge 只去重“同一事实”，不去重“同一维度上的多个独立规则”。
- `primary_dimension` 和 `primary_item` 必须来自上面的单一主落点。
- `evidence_anchor` 取最稳定的文件路径或代码位置锚点，只保留一个，不拼接多个弱锚点。
- `review_only_taxonomy` 不生成 `issue_id`。

### 3. rule 到 canonical 的对应关系

rule 侧不能再保留“多个 `affected_items` 都算”的做法。每条规则只允许一个 `primary_dimension + primary_item`，其余影响只保留为说明文本，不进入数值扣分。

规则侧 canonical 映射只做两件事：

- 找到唯一的 `canonical_code`。
- 找到唯一的 `primary_item`。

这两个字段必须来自规则定义或单一映射表，不允许由 prompt 文本、同名函数或表面语义临时推断。

如果某条规则暂时无法稳定映射到 score taxonomy，就保留为 `RULE_VIOLATION:<rule_id>` 类型的独立问题，不和 rubric 风险合并，也不硬凑到别的维度里。

### 4. 合并规则

- rubric 风险和 rule 违规若命中同一 `issue_id`，只保留 rule 作为主项。
- rubric 风险保留为附属说明时，不再单独计数为一个新问题。
- 不同 `issue_id` 的问题不合并。
- 不同规则即使落在同一 dimension / item，也不能因为“维度相同”就合并成一个 issue。
- 无法稳定确认是否同一问题时，宁可不合并。

## 两个 Agent 的修改面

### rubric agent

`hmos-rubric-scoring` 及其 prompt 只做四件事：

- 只从 `score_taxonomy` 选择 `risk_code`。
- 每个风险只对应一个主落点，不要拆成多个近义风险。
- 对明显属于 review-only 的元数据问题，不放进 `risks`，转入 `main_issues` 或人工复核语义。
- 同一根因不要同时输出多个风险名，即使它会影响多个 rubric item，也只保留一个主风险。

rubric 风险描述要直接指向主落点对应的那个问题，不要写成跨多个维度的总评。

### rule agent

`hmos-rule-assessment` 只负责规则是否成立，不变成第二个 rubric 评分器。但它的 `reason` 要对齐一个主落点：

- 先按候选规则自身语义判定。
- 再用 taxonomy 的单落点映射，说明这条规则主要落在哪个 rubric 维度/条目上。
- 不要在 `reason` 里展开多个同级维度，不要把同一事实拆成多个解释。
- 如果某条规则没有稳定证据，不要用本地同名函数、封装函数或近似语义硬凑成 pass。

## 全流程

1. rubric agent 生成 item scores 和 rubric risks，`risk_code` 只能来自 `score_taxonomy`。
2. rule agent 生成规则判定，`reason` 对齐单一主落点。
3. scoreFusion 读取 taxonomy 映射，把 rubric risk 和 rule violation 转成 `CanonicalIssue`。
4. 若同一 `issue_id` 同时存在 rubric 风险和 rule 违规，只保留 rule 违规作为主项。
5. `review_only_taxonomy` 只进人工复核，不进扣分，不进风险合并。
6. 一致性分析按 `issue_id` 统计，避免同一问题被重复记数；多个独立规则落在同一维度时仍按规则粒度累计。

## 影响范围

涉及文件：

- `references/risks/risk-taxonomy.yaml`
- `.opencode/skills/hmos-rubric-scoring/SKILL.md`
- `.opencode/prompts/hmos-rubric-scoring-system.md`
- `.opencode/skills/hmos-rule-assessment/SKILL.md`
- `.opencode/prompts/hmos-rule-assessment-system.md`
- `src/agent/opencodeRubricScoring.ts`
- `src/agent/opencodeRuleAssessment.ts`
- `src/scoring/scoreFusion.ts`
- `src/scoring/riskTaxonomy.ts`
- `src/types.ts`
- `tests/score-fusion.test.ts`

## 测试计划

- `tests/score-fusion.test.ts`
  - 验证同一 `issue_id` 只保留 rule 风险主项。
  - 验证不同 `issue_id` 不互相吞并。
  - 验证多个不同规则落在同一 dimension / item 时仍保留多个 `rule_impacts` 和累计扣分。
  - 验证 review-only taxonomy 不参与扣分链路。

- `tests/risk-taxonomy.test.ts`
  - 验证 score taxonomy / review-only taxonomy 都能被解析。
  - 验证每条 score taxonomy 都有且只有一个 primary_item。

- `tests/opencode-rubric-scoring.test.ts`
  - 验证 rubric prompt 只允许使用 score taxonomy。
  - 验证 review-only taxonomy 不进入 `risks`。

- `tests/opencode-rule-assessment.test.ts`
  - 验证 rule prompt 的 `reason` 只能对齐单一主落点。

## 成功标准

- 同一问题不再出现双倍扣分。
- taxonomy 每条只对应一个主 rubric 落点。
- rubric 风险和 rule 违规能稳定合并到同一个 canonical issue。
- 不同规则落在同一维度时，仍能按规则粒度保留多次扣分。
- 方案保持精简，没有第二套复杂去重引擎，也没有引入新的技术债。
