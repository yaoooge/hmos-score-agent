# 基于用例约束的动态规则包设计

## 1. 背景

当前评分工作流已经具备以下能力：

- 基于 `input.txt`、`original/`、`workspace/`、`diff/changes.patch` 加载评分用例
- 在 `taskUnderstandingNode` 中结合 prompt、原始工程结构和 patch 摘要提取任务约束
- 通过规则引擎执行静态规则审计，并将不确定规则交给 agent 辅助判定
- 在评分阶段应用硬门槛，并输出统一的 `result.json` 与 `report.html`

但当前链路仍缺少与具体业务用例强绑定的“必达要求”能力，表现为：

1. `taskUnderstandingNode` 只读取已有 patch 路径，无法在用例未提供 `diff/changes.patch` 时自动根据 `original/` 与 `workspace/` 生成 patch
2. 用例目录下的 `expected_constraints.yaml` 尚未进入规则体系，无法参与后续规则审计和 agent 辅助判定
3. 用例中的高优先级约束无法触发硬门槛
4. `result.json` 与 HTML 报告中无法单独展示用例规则的审计结果

`cases/requirement_004` 已经提供了完整示例：它不仅包含 `original/`、`workspace/`，还包含 `expected_constraints.yaml`，其中描述了一组业务侧必须满足的用例约束。这些约束在语义上不是一般性的语言规范，而是针对该 case 的业务验收规则，因此必须以“动态规则包”的形式并入现有规则主链，而不是作为旁路校验结果单独存在。

## 2. 目标

本轮实现目标如下：

1. 当用例未提供 patch 文件时，`taskUnderstandingNode` 能基于 `original/` 与 `workspace/` 自动生成 patch，并在后续节点中继续使用。
2. 解析 `expected_constraints.yaml`，将其中约束转换为运行时注册的 case rule pack。
3. case rule pack 直接接入现有规则引擎，参与：
   - 确定性规则审计
   - agent 辅助判定候选生成
   - 规则结果合并
   - 评分与硬门槛判断
4. 当用例规则中的 `P0` 约束最终判定为 `不满足` 时，触发硬门槛。
5. 最终 `result.json` 与 HTML 报告中明确包含用例规则结果，并能与通用规则区分展示。

## 3. 非目标

本轮明确不做以下事项：

- 不设计通用约束 DSL
- 不支持当前 `expected_constraints.yaml` 之外的新字段组合
- 不实现通用 AST 语义判定器
- 不引入对 `expected_constraints.yaml` 的多版本兼容
- 不改写现有通用规则包的定义方式
- 不让 case 规则绕过现有规则引擎直接进入评分

本轮只支持当前已确认的字段：

- 顶层 `constraints`
- constraint 下的 `id`、`name`、`description`、`priority`、`rules`
- rule 下的 `target`、`ast`、`llm`

如果输入超出该范围，应尽早抛出清晰错误，而不是静默忽略。

## 4. 设计原则

### 4.1 走主链，不走旁路

用例规则必须作为规则体系的一部分接入既有主链，复用：

- 证据采集
- 静态规则结果结构
- agent 辅助判定
- 规则合并
- 评分与报告输出

这样可以避免出现两套相似但不一致的规则结果语义。

### 4.2 当前字段精确支持

只支持当前 `requirement_004` 中已经出现的字段和结构，不对 AST 描述做泛化设计，也不为未来格式预留复杂抽象层。

### 4.3 用例高优先级约束直接影响门槛

`P0` 表示 case 业务验收红线，一旦判定为 `不满足`，必须能稳定触发硬门槛，而不是仅作为普通扣分项存在。

### 4.4 patch 作为共享事实源

无论 patch 来自用例目录已有文件，还是由 `taskUnderstandingNode` 运行时生成，后续节点都应消费同一份 patch 路径，避免 task understanding、evidence summary 和评分阶段使用不同的变更事实。

### 4.5 低风险扩展优先

在不破坏现有规则引擎结构的前提下扩展 case rule pack，优先选择：

- 追加状态字段
- 追加运行时规则注册入口
- 追加报告字段

避免重写静态规则主流程。

## 5. 总体方案

## 5.1 自动 patch 生成

在 `taskUnderstandingNode` 中新增 patch 准备逻辑：

- 如果 `state.caseInput.patchPath` 已存在，继续按现有逻辑读取
- 如果不存在，则调用现有 `generateCasePatch(caseDir, outputPath)`，基于 `original/` 与 `workspace/` 生成 patch
- 生成的 patch 落盘到当前运行目录，例如 `intermediate/generated.patch`
- 将该路径回写到工作流状态中的有效 patch 路径，供：
  - patch 摘要计算
  - 证据采集
  - 后续 continuation / bug_fix 相关逻辑

### 5.2 用例约束转动态规则包

新增 case constraint loader，负责：

- 定位 `<caseDir>/expected_constraints.yaml`
- 读取并解析 YAML
- 校验字段范围是否仅包含本轮支持字段
- 将每条 constraint 转换为运行时规则定义

运行时映射规则如下：

- `constraint.id` -> `rule_id`
- `constraint.description` 优先作为 `summary`，为空时回退到 `constraint.name`
- `priority: P0` -> `rule_source: must_rule`
- `priority: P1` -> `rule_source: should_rule`
- `constraint.name` -> 报告展示名称
- `rules[].target` -> 证据文件匹配范围
- `rules[].ast` -> 本地预筛关键词来源
- `rules[].llm` -> agent 辅助判定提示

这组规则组成一个运行时 pack，例如：

- `packId: case-requirement_004`
- `displayName: 用例 requirement_004 约束规则`

## 5.3 Case 规则的本地判定策略

本轮不实现真正的 AST evaluator，而采用“目标文件筛选 + 轻量文本预筛 + agent 辅助兜底”的方案。

### A. 目标文件筛选

根据 `rules[].target` 在 workspace 文件集合中筛出候选文件。

如果没有任何候选文件：

- 对明显必须存在实现文件的约束，直接返回 `不满足`
- 结论中明确说明“未找到匹配目标文件”

### B. 轻量文本预筛

从 `rules[].ast` 中抽取当前可直接映射成文本信号的字段，例如：

- `module`
- `name`
- `type`
- `json_key`

这些信号不承担最终语义判定职责，只用于：

- 判断规则是否“涉及当前实现”
- 缩小 agent 证据范围
- 在证据极弱时给出更明确的本地结论

### C. Agent 辅助判定

只要本地无法稳定判定“满足”或“明确不满足”，则将该 case 规则纳入 `assistedRuleCandidates`。

候选中除现有字段外，还应带上 case rule 专属上下文，例如：

- 约束名称
- 约束描述
- 约束优先级
- 当前 `llm` 指令文本

这样 agent 在现有规则辅助评审时可以把 case 约束与通用规则一并处理。

## 5.4 规则引擎接入方式

现有规则引擎以 `listRegisteredRules()` 输出静态规则。本轮扩展为支持“静态规则 + 运行时 case 规则”。

建议做法：

- 保留现有静态 pack 注册表
- 新增运行时规则列表参数，由调用方传入
- 在 `runRuleEngine()` 内部将二者拼接为最终待评估规则集

这样无需改造静态规则文件结构，只需让 workflow 在加载 case 后把动态规则带入。

## 5.5 硬门槛策略

新增 case 规则门槛触发条件：

- 只要最终规则结果中存在来自 case rule pack 的 `must_rule`
- 且其结果为 `不满足`
- 即触发新的硬门槛

该门槛不写入 rubric 静态配置，而由评分引擎基于规则来源动态判定。原因是：

- rubric hard gate 是 task type 级别通用策略
- case rule hard gate 是单个用例特有策略

两者不应混在同一静态配置层中。

## 5.6 报告输出

### `result.json`

保留原有 `rule_audit_results` 总表，并新增 `case_rule_results` 字段，专门承载来自 `expected_constraints.yaml` 的规则结果。

每项至少包含：

- `rule_id`
- `rule_name`
- `priority`
- `rule_source`
- `result`
- `conclusion`
- `hard_gate_triggered`

### HTML 报告

新增“用例规则结果”区块，展示：

- 规则 ID
- 规则名称
- 优先级
- 审计结果
- 结论
- 是否触发硬门槛

同时保留现有“规则审计结果”总览区块，确保通用规则与用例规则都可见。

## 6. 数据与接口设计

## 6.1 `CaseInput` 扩展

建议在 `CaseInput` 中新增可选字段：

- `expectedConstraintsPath?: string`

用于记录 `<caseDir>/expected_constraints.yaml` 的路径。

## 6.2 工作流状态扩展

建议新增以下状态字段：

- `effectivePatchPath`
- `caseRuleDefinitions`
- `caseRuleResults`

语义如下：

### `effectivePatchPath`

表示当前工作流实际使用的 patch 路径。若 case 自带 patch，则等于原始 `patchPath`；若运行时生成 patch，则指向生成后的落盘文件。

### `caseRuleDefinitions`

保存从 `expected_constraints.yaml` 解析得到的运行时规则定义，供 `ruleAuditNode` 使用。

### `caseRuleResults`

保存最终合并后的用例规则结果，供评分和报告直接消费。

## 6.3 运行时规则定义结构

建议新增 case rule 的运行时扩展字段，包括：

- `rule_name`
- `priority`
- `target_patterns`
- `llm_prompt`
- `is_case_rule`

这样可以在不破坏现有 `RegisteredRule` 基础结构的前提下，补充报告和硬门槛所需元信息。

## 7. 模块改造点

## 7.1 `src/io/caseLoader.ts`

职责调整：

- 继续加载 `input.txt`、`original/`、`workspace/`
- 检测 `expected_constraints.yaml` 是否存在
- 将其路径放入 `CaseInput`

## 7.2 `src/nodes/taskUnderstandingNode.ts`

新增职责：

- 生成或确认有效 patch
- 将有效 patch 路径传入 patch 摘要流程
- 解析并缓存 case 规则定义

并在中间产物中落盘：

- `intermediate/generated.patch`（如有）
- `intermediate/case-rule-definitions.json`

## 7.3 `src/rules/engine/rulePackRegistry.ts`

新增运行时 pack 拼接入口，例如：

- `listRegisteredRules(runtimeRules?: RegisteredRule[])`

或提供新的组合函数，避免静态全局注册表被动态污染。

## 7.4 `src/rules/ruleEngine.ts`

扩展输入参数，允许接收 case rule 定义，并在执行后：

- 生成统一规则结果
- 单独提取 case rule 结果
- 在 `ruleViolations` 中体现 case 违规

## 7.5 `src/scoring/scoringEngine.ts`

新增 case 硬门槛逻辑：

- 检查 case 规则中的 `must_rule` 是否有 `不满足`
- 若有，触发新的硬门槛原因

## 7.6 `src/nodes/reportGenerationNode.ts`

新增输出：

- `case_rule_results`

并保证 `result.json` 通过 schema 校验。

## 7.7 报告渲染模块

需要同步修改：

- `src/report/renderer/buildHtmlReportViewModel.ts`
- `src/report/renderer/renderHtmlReport.ts`

以展示 case rule 独立区块和统计信息。

## 8. 字段支持边界

本轮对 `expected_constraints.yaml` 的支持边界如下：

### 支持

- `constraints`
- `id`
- `name`
- `description`
- `priority`
- `rules`
- `target`
- `ast`
- `llm`

### 不支持

- 额外顶层字段
- 额外 constraint 字段
- 额外 rule 字段
- AST 描述中的通用表达式扩展
- 自定义优先级值

当检测到不支持字段时，应抛出带路径信息的错误，例如指出：

- 哪个 constraint
- 哪个字段不被支持

这样可以避免未来 case silently degrade。

## 9. 失败与回退策略

### 9.1 缺少 `expected_constraints.yaml`

不报错，视为当前用例无 case rule，继续执行现有链路。

### 9.2 YAML 格式错误

直接失败，因为 case 约束输入本身不可解释，无法安全评测。

### 9.3 包含超范围字段

直接失败，并给出清晰错误，避免误以为规则已参与评测。

### 9.4 自动 patch 生成失败

直接失败。因为当前需求明确要求 task understanding 根据 `original/` 与 `workspace/` 生成 patch，该事实源缺失会影响后续判定质量。

## 10. 测试策略

### 10.1 task understanding

新增测试覆盖：

- case 未提供 patch 时自动生成 patch
- 生成后的 patch 路径被后续摘要逻辑使用
- 生成 patch 被落盘到运行目录

### 10.2 case constraint loader

新增测试覆盖：

- 成功解析 `requirement_004` 风格 YAML
- `P0` 映射为 `must_rule`
- `P1` 映射为 `should_rule`
- 非法字段时报错

### 10.3 rule engine

新增测试覆盖：

- case rule 参与统一规则评测
- 无目标文件时按规则返回 `不满足`
- 不确定 case rule 进入 `assistedRuleCandidates`
- 最终能单独提取 `caseRuleResults`

### 10.4 scoring

新增测试覆盖：

- case `P0` 规则不满足触发硬门槛
- case `P1` 规则不满足不单独触发硬门槛

### 10.5 report

新增测试覆盖：

- `result.json` 包含 `case_rule_results`
- HTML 报告展示“用例规则结果”区块
- 报告中能看见优先级与硬门槛状态

## 11. 风险与取舍

### 11.1 不做 AST evaluator 的风险

当前 case 规则中的 `ast` 只被用作轻量信号和 agent 提示，而不承担真正 AST 语义判定。这意味着部分“满足”结论将依赖 agent，而不是完全本地确定。

这是有意取舍。原因是：

- 当前需求只要求支持已有字段
- 通用 AST evaluator 的设计和验证成本明显高于当前目标
- 现有系统已经具备 agent 辅助判定和人工复核兜底链路

### 11.2 case 规则动态接入的复杂度

运行时 pack 会让规则注册链路从“纯静态”变为“静态 + 动态”。这是本轮主要结构性变化，但它可以换来：

- 单条工作流内统一规则语义
- 更低的报告和评分改造成本
- 未来 requirement 类 case 的复用能力

## 12. 最终决策

本轮采用以下设计决策：

1. 在 `taskUnderstandingNode` 中补齐自动 patch 生成能力，并生成统一有效 patch 路径。
2. 将 `expected_constraints.yaml` 解析为运行时 case rule pack，而不是旁路校验结果。
3. 不实现通用 AST evaluator，只支持当前字段，并将复杂语义判定交给 agent 辅助链路。
4. 用例 `P0` 规则不满足时触发硬门槛。
5. 在 `result.json` 和 HTML 报告中新增 case rule 独立结果展示。

该方案可以在最小破坏现有规则主链的前提下，满足 `cases/requirement_004` 的新需求，并为后续 requirement 类用例提供统一接入方式。
