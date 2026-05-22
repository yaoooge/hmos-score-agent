# Risk Taxonomy Usage

`risks` 是报告中的高信号问题列表，不是所有扣分依据或代码坏味道的清单。输出风险前必须先做归并和阈值判断。

## 选择规则

- 风险必须优先从评分流程提供的 risk taxonomy 中选择 `risk_code`、`level` 和 `title`。
- 选择到 taxonomy 条目时，`level` 和 `title` 必须与 taxonomy 完全一致，不要改写成近义标题，不要自行升级或降低风险等级。
- 只有确实无法匹配 taxonomy 时，才可以省略 `risk_code`；此时 `title` 必须简洁稳定，不要使用一次性措辞。
- 如果一个事实既可解释为需求完成度问题，也可解释为指定能力、接口或平台用法偏离，优先选择更贴近根因的 taxonomy 风险，不要同时输出两个近义风险。

## Taxonomy

| risk_code | level | title | 使用口径 |
|---|---|---|---|
| REQUIREMENT_NOT_IMPLEMENTED | high | 需求未实现 | 需求目标、关键约束、验收点或必要业务回调没有在生成代码中落地。 |
| REQUIREMENT_PARTIALLY_IMPLEMENTED | medium | 需求实现不完整 | 需求已有部分实现，但关键路径、边界场景、交互分支、接口承诺或兜底逻辑缺失。 |
| API_USAGE_DEVIATION | high | 核心 API 使用偏离 | 关键能力没有按要求使用框架 API、平台接口、指定 Kit、指定调用方式或官方推荐接入方式。 |
| LANGUAGE_CONSTRAINT_VIOLATION | medium | 语言约束违规 | ArkTS / TypeScript 类型、语法、空值处理或语言约束不符合要求。 |
| UI_LAYOUT_OR_BREAKPOINT_MISMATCH | medium | 布局或断点不匹配 | 布局、断点、列表、网格、资源化样式或响应式策略与要求不一致。 |
| PERFORMANCE_OR_LIFECYCLE_RISK | medium | 性能或生命周期风险 | 存在重复计算、热点路径低效、存储无界增长、监听释放不完整或生命周期状态清理不稳。 |
| BUILD_OR_RESOURCE_ISSUE | medium | 构建或资源问题 | 构建流程、资源引用、配置、依赖、模块边界、包名或无效导入存在问题。 |
| READABILITY_OR_MAINTAINABILITY_RISK | low | 可读性或可维护性下降 | 命名、结构、注释、重复代码、硬编码配置或状态管理方式影响后续 review 和维护。 |
| DATA_STATE_CONSISTENCY_RISK | medium | 数据或状态一致性风险 | 异步流程、全局状态、缓存、持久化数据或多份状态之间缺少一致性保障。 |
| ERROR_HANDLING_OR_VALIDATION_RISK | medium | 错误处理或校验不足 | 异步失败、接口异常、认证失败、输入格式或边界值缺少明确处理。 |
| SECURITY_OR_PRIVACY_RISK | high | 安全或隐私风险 | 敏感信息、用户隐私、凭据、权限或安全边界处理不充分。 |
| EXTERNAL_SERVICE_INTEGRATION_RISK | medium | 外部服务集成风险 | 外部服务的配置、调用时机、参数、端侧与服务端职责划分或接入方式不完整。 |
| EVALUATION_METADATA_RISK | high | 评审元数据风险 | 任务类型、评分上下文、rubric 元数据或评审输入与实际代码变更不一致。 |

## 归并规则

- 同一组代码位置、同一条证据链、同一个根因只输出一个风险；不要把同一事实拆成多个近义风险。
- 规则违规类风险由规则融合阶段生成；rubric agent 不要用自由风险重复表达同一条规则编号已经覆盖的事实。
- 只有存在规则之外的独立运行时、数据流、状态或边界后果时，才另列 rubric 风险。

## 输出阈值

- 低置信度、轻微风格、局部可读性、轻微重复代码、可能但未证实的性能问题，默认写入 `rationale`、`main_issues` 或扣分说明，不进入 `risks`。
- 风险必须至少满足以下条件之一：对应明确扣分项的 `deduction_trace`；有真实 `generated/` 代码位置和可复核后果；触发 hard gate 候选；会导致功能链路、数据状态、异常处理或平台约束出现明确问题。

## 输出前自检

按以下顺序自检，只保留通过自检的风险：

1. 证据事实是否清晰。
2. 是否能映射到 taxonomy code。
3. 是否已被规则风险覆盖。
4. 是否达到风险输出阈值。
