# 确定性评分与风险枚举设计

## 背景

两组一致性分析暴露出两类问题：

- `C-001` 出现 69/97 大幅分数漂移，核心原因是硬规则有时被漏判，Code Linter 结果也存在采集或合并波动。
- `C-002` 总分稳定，但规则集合和风险项集合漂移，导致完整报告一致性为 0%。

本设计目标不是新增一套规则引擎，而是在现有评分链路中收紧边界：确定性结论保持确定性，agent 只处理需要语义判断的部分，风险名称从枚举中选择。

## 设计原则

1. Code Linter 是确定性输入，只在规则合并阶段进入评分。

   `officialCodeLinterNode` 继续独立运行并产出 `officialLinterRuleResults`。这些结果不进入 `ruleAgentPromptBuilderNode`，也不进入 rule assessment agent prompt。最终只由 `ruleMergeNode` 追加到 `mergedRuleAuditResults`。

2. 不做通用 trigger 静态判定器。

   不引入 `pass/fail/not_applicable/review` 的通用 pattern 执行器。规则触发条件很难穷举，尤其不能用“没有命中反例 pattern”推断规则满足，否则容易造成漏判。

3. 内置规则结构向用例规则靠拢，但仍按现有代码方式维护。

   内置规则继续维护在 `src/rules/packs/**`，不再把“代码导出 YAML”作为实施路径。可以在规则定义中补充 agent 判定用的结构化标准，例如 `decision_criteria.pass/fail/not_applicable/review`，让 prompt 更稳定，但这些标准不自动等同于静态判定结果。

4. 确定性判定只处理强证据。

   已有 `text_pattern`、project structure、Code Linter、明确 API 正向/反向证据可以作为确定性结果。无法用强证据确认的规则进入 agent 或人工复核，不推断“满足”。

5. 风险项必须枚举化。

   风险项通过 `references/risks/risk-taxonomy.yaml` 管理，包含稳定 `code`、`level`、`title`、`description`、`matchHints`。rubric agent 优先从枚举中选择风险，评分融合和一致性分析使用 `risk_code` 作为稳定 key。

## 规则链路

现有链路保持：

```text
ruleAuditNode
  -> deterministicRuleResults
  -> assistedRuleCandidates

officialCodeLinterNode
  -> officialLinterRuleResults

ruleAssessmentAgentNode
  -> agent-assisted rule results

ruleMergeNode
  -> deterministicRuleResults + officialLinterRuleResults + assisted results
```

边界要求：

- `assistedRuleCandidates` 不包含 Code Linter 结果。
- rule agent prompt 只能包含规则包定义、用例规则、静态预判证据、patch/文件证据。
- Code Linter 结论保持到 `ruleMergeNode` 再进入最终规则集合。

## 内置规则结构

内置规则仍使用 TypeScript 规则包定义，不新增规则 YAML 主数据。

对需要 agent 判定的规则，可增加轻量 criteria：

```ts
decision_criteria?: {
  pass?: string[];
  fail?: string[];
  not_applicable?: string[];
  review?: string[];
};
```

这些字段的用途：

- 构建 rule agent prompt 时，让 agent 按统一口径输出 `violation/pass/not_applicable/uncertain`。
- 让内置规则的表达方式接近用例规则中的 `llmPrompt` 和 target check。
- 作为人工复核说明，不作为通用静态 evaluator 的执行条件。

不做的事：

- 不新增 `decision_triggers` 通用执行器。
- 不用 pattern absence 判定满足。
- 不强制所有规则一次性补齐 criteria。

## 风险枚举

新增 `references/risks/risk-taxonomy.yaml`：

```yaml
version: v1
entries:
  - code: PRELOAD_API_MISSING
    level: high
    title: 缺失核心预加载 API 调用
    description: 未按任务约束使用预加载核心 API。
    matchHints:
      - cloudResPrefetch
      - 预加载 API
```

使用方式：

- rubric prompt 带上 taxonomy 摘要。
- rubric agent 输出 risks 时优先选择 `risk_code`。
- `scoreFusion` 对已知 `risk_code` 归一化 level 和 title。
- 规则违规风险使用稳定 code：`RULE_VIOLATION:<rule_id>`。
- 一致性分析优先用 `risk_code` 作为风险 key。

## 一致性指标

保留当前 `consistencyPercentage`，新增拆分指标：

- `scoreStability`：平均分、中位数、极差、标准差。
- `gateStability`：硬门槛多数值、一致率。
- `findingStability`：规则集合 Jaccard、风险集合 Jaccard。

这样 `C-002` 可以表达为“总分稳定，但 finding 集合不稳定”，避免把所有波动混成一个结论。

## 测试策略

- Code Linter 边界测试：构造 state，确认 `ruleAgentPromptBuilderNode` 输出不包含 `OFFICIAL-LINTER`。
- rule merge 测试：确认 `ruleMergeNode` 追加 Code Linter rule results。
- criteria prompt 测试：确认 agent prompt 包含 `decision_criteria`，但 evaluator 不执行这些 criteria。
- risk taxonomy 测试：加载 YAML，归一化风险。
- scoring 测试：规则风险有稳定 `risk_code`，rubric 风险按 taxonomy 归一。
- consistency 测试：`risk_code` 优先作为 key，并输出拆分稳定性指标。

## 迁移策略

1. 先锁定 Code Linter 与 rule agent 的边界。
2. 再给规则定义增加可选 `decision_criteria`，只影响 prompt，不影响静态判定。
3. 增加风险 taxonomy，并让 rubric agent 选择风险 code。
4. 在 score fusion 和一致性分析中消费稳定 risk key。

这条路径避免引入新规则服务，也避免把难以枚举的 trigger 条件误用为静态判定器。
