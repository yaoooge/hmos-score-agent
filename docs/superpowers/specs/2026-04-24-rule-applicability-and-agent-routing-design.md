# 规则适用性判定与 Agent 路由设计

## 1. 背景

当前规则工作流中存在两类问题：

1. `text_pattern` 规则只有“违规命中正则”，缺少“是否存在适用场景”的表达能力，因此当规则未命中时，系统只能统一给出“满足”，无法区分“代码合规”和“当前项目根本不涉及该规则”。
2. `not_implemented` 规则虽然在规则定义中标记为 `fallback_policy: "agent_assisted"`，但在 `ruleEngine` 中，如果没有直接证据，会被提前降级为 `不涉及`，导致这类规则不会进入 `rule agent` 做二次判定。

用户期望将规则判定语义调整为：

1. 接入了正则且没有检测到相关代码场景的规则，应判为 `不涉及`
2. 接入了正则且检测到相关代码场景、同时没有违规命中的规则，应判为 `满足`
3. 没有正则、当前无法静态稳定判定的规则，应统一交给 `rule agent` 做二次验证

## 2. 目标

本次设计目标如下：

1. 为 `text_pattern` 规则新增“适用场景正则”能力，使规则可以区分 `满足` 与 `不涉及`
2. 保持现有 `text_pattern` 规则的兼容性，不要求一次性为全部旧规则补齐新字段
3. 让普通静态规则中的 `not_implemented` 项稳定进入 `assistedRuleCandidates`
4. 保持现有 `case_rule -> rule agent` 的链路不变
5. 为后续逐条补齐 ArkTS 规则的“适用场景定义”预留稳定接口

## 3. 非目标

本次明确不做以下事项：

- 不一次性重写全部 ArkTS 规则定义
- 不把现有所有 `text_pattern` 规则都强制迁移到新双正则模型
- 不重构 `rule agent` 协议、prompt 或返回 schema
- 不改变评分引擎对 `满足 / 不满足 / 不涉及 / 待人工复核` 的消费方式
- 不引入 AST 级适用性分析

## 4. 设计原则

### 4.1 适用性与违规性分离

一条规则是否“适用”，与是否“违规”，是两个不同问题。`text_pattern` 规则需要分别表达：

- 哪些代码结构说明这条规则适用
- 哪些代码结构说明这条规则被违反

### 4.2 兼容优先

当前仓库里已有大量只带 `patterns` 的规则。如果要求一次性补齐所有规则，改动面过大且风险高。本次只增加能力，不强制改旧规则行为。

### 4.3 Agent 只接手静态无法稳定判定的规则

如果规则没有任何静态判定器，就不应在本地层面擅自给出 `不涉及`。这类规则应该稳定进入 `rule agent`，由二次判定链路决定输出结果或回退为人工复核。

## 5. 规则模型改造

### 5.1 `text_pattern` 新增可选字段

在 `RegisteredRule.detector_config` 中，为 `text_pattern` 规则增加可选字段：

- `applicabilityPatterns?: string[]`

字段语义如下：

- `patterns`: 违规命中正则。命中表示该规则被违反。
- `applicabilityPatterns`: 适用场景正则。命中表示当前代码存在与该规则相关的实现或语法场景。

### 5.2 三态判定语义

当 `text_pattern` 规则配置了 `applicabilityPatterns` 时，判定逻辑调整为：

1. 未命中任何 `applicabilityPatterns` => `不涉及`
2. 命中 `applicabilityPatterns`，且命中 `patterns` => `不满足`
3. 命中 `applicabilityPatterns`，且未命中 `patterns` => `满足`

### 5.3 兼容模式

当 `text_pattern` 规则未配置 `applicabilityPatterns` 时，保持当前兼容语义：

1. 命中 `patterns` => `不满足`
2. 未命中 `patterns` => `满足`

这样可以保证旧规则不因本次能力升级而批量变成 `不涉及`。

## 6. `textPatternEvaluator` 行为调整

### 6.1 文件过滤

仍沿用当前 `fileExtensions` 的过滤逻辑，只在允许的文件范围内判定。

### 6.2 命中扫描

评估器需要分两轮扫描：

1. 扫描 `applicabilityPatterns`
2. 扫描 `patterns`

两轮扫描都复用当前的注释剥离逻辑与按行定位逻辑，避免新旧规则在注释处理上出现分叉。

### 6.3 输出语义

返回结果约束如下：

- `不满足`: 继续沿用当前命中证据输出，包含 `matchedFiles`、`matchedLocations`、`matchedSnippets`
- `满足`: 若由“有适用场景但无违规”得出，结论文案需明确说明“存在适用场景，未发现违规命中”
- `不涉及`: 若由“无适用场景”得出，结论文案需明确说明“未发现该规则的适用场景”

本次不要求把“适用场景命中位置”单独写入新的证据索引结构；静态层只需输出正确的三态结论。

## 7. `not_implemented` 规则路由调整

### 7.1 当前问题

当前 `ruleEngine` 会把普通静态规则中：

- `result === "未接入判定器"`
- 且没有直接证据文件

的项，提前改写为：

- `result: "不涉及"`

这会导致未接入判定器的规则直接退出 `assistedRuleCandidates`。

### 7.2 目标行为

对普通静态规则中的 `not_implemented` 项：

- 保留 `staticRuleAuditResults` 中的 `未接入判定器`
- 保证其进入 `assistedRuleCandidates`
- 不再因为“无直接证据”而被本地层面自动改写为 `不涉及`

### 7.3 Case Rule 边界

`runtimeRules` / `case_rule` 的现有分流语义保持不变。它们本来就应进入 `assistedRuleCandidates`，本次不额外扩展或收缩这部分行为。

## 8. 工作流影响

本次不调整工作流图，仅调整候选规则生成条件。

现有链路：

`ruleAuditNode -> ruleAgentPromptBuilderNode -> ruleAssessmentAgentNode -> ruleMergeNode`

在改造后将具备以下行为：

1. `text_pattern + applicabilityPatterns` 的规则可在静态层直接产生 `不涉及`
2. 旧 `text_pattern` 规则保持现有 `满足 / 不满足` 语义
3. `not_implemented` 规则稳定进入 `rule agent`

`ruleMergeNode`、评分融合和报告生成不需要改协议，只需要消费新的候选集合与静态结果。

## 9. 规则包落地策略

### 9.1 本轮改造范围

本轮只实现框架能力与路由修正，不强制批量修改所有 ArkTS 规则。

### 9.2 后续补齐策略

后续可以按规则价值逐步为 `arkts-language` 中适合区分“满足 / 不涉及”的 `text_pattern` 规则补充 `applicabilityPatterns`，例如：

- 类型断言类规则
- 模块导入类规则
- 枚举、接口、构造签名类规则

不适合靠简单文本模式表达“适用场景”的规则，可以继续保持旧模式，或转为更强的结构化判定器。

## 10. 测试策略

实现前先补测试，至少覆盖以下场景：

1. `text_pattern` 规则配置 `applicabilityPatterns`，且代码中不存在适用场景时，结果为 `不涉及`
2. `text_pattern` 规则配置 `applicabilityPatterns`，且代码中存在适用场景但没有违规命中时，结果为 `满足`
3. `text_pattern` 规则配置 `applicabilityPatterns`，且存在适用场景并命中违规时，结果为 `不满足`
4. 未配置 `applicabilityPatterns` 的旧 `text_pattern` 规则保持原有兼容语义
5. `not_implemented` 规则即使没有静态直接证据，也会进入 `assistedRuleCandidates`
6. `not_implemented` 规则不会再在静态层被自动改写为 `不涉及`

## 11. 风险与缓解

### 11.1 风险：旧规则误判为 `不涉及`

如果错误地把“未命中违规”直接解释为“无适用场景”，会造成大量回归。

缓解方式：

- `applicabilityPatterns` 仅作为可选字段
- 没有配置该字段的旧规则保持兼容

### 11.2 风险：`not_implemented` 候选量上升

把未接入判定器规则全部交给 `rule agent` 后，候选量可能变多。

缓解方式：

- 本轮只修正既有规则的错误降级逻辑
- 后续再根据实际成本评估是否需要候选上限、优先级或更细粒度的适用性过滤

### 11.3 风险：Agent 证据不足

部分 `not_implemented` 规则进入 `rule agent` 时可能没有直接静态证据文件。

缓解方式：

- 继续复用当前 fallback evidence 机制
- 允许 `rule agent` 输出 `uncertain`
- `ruleMergeNode` 继续保留本地回退为 `待人工复核` 的能力

## 12. 实施边界

本次实现预计改动以下区域：

- `src/rules/evaluators/textPatternEvaluator.ts`
- `src/rules/ruleEngine.ts`
- `src/rules/engine/ruleTypes.ts` 或相关类型定义
- `src/rules/packs/shared/ruleFactories.ts` 或规则配置读取逻辑
- `tests/rule-engine.test.ts`
- 如有必要，补充更细粒度 evaluator 单测

本次不要求同步修改所有规则包定义，只要求框架能力可用，并保证“没有正则的规则交给 agent”这一主流程生效。
