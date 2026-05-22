# Risk Taxonomy Usage

`risks` 是报告中的高信号问题列表，不是所有扣分依据、代码坏味道或低置信度猜测的清单。输出风险前必须先完成事实归并、taxonomy 选择和阈值判断。

## 决策流程

按以下顺序处理每个候选风险：

1. 归并事实：把同一根因、同一证据链、同一组代码位置的问题合并成一个候选风险。
2. 判断根因：优先选择最能解释问题来源的 taxonomy，而不是按表面症状拆分多个风险。
3. 匹配 taxonomy：优先从下方 taxonomy 中选择 `risk_code`、`level` 和 `title`。
4. 判断阈值：只有达到“输出阈值”的候选风险才进入 `risks`。
5. 自检去重：删除已被规则融合阶段覆盖的规则违规风险，以及重复、低置信度或轻微问题。

## 选择规则

- 匹配到 taxonomy 条目时，`risk_code`、`level` 和 `title` 必须使用 taxonomy 原值，不要改写标题，不要自行升级或降低等级。
- 只有确实无法匹配 taxonomy 时，才可以省略 `risk_code`；此时 `title` 必须简洁、稳定、可复用，不要使用一次性描述。
- 如果同一事实可解释为多个风险，选择更贴近根因的一项，不要同时输出近义风险。
- 如果问题本质是需求目标、验收点或关键业务回调缺失，优先选择需求类风险。
- 如果需求要求的框架 API、平台接口、指定 Kit 或官方接入方式被错误使用，优先选择 `API_USAGE_DEVIATION`。
- 如果代码可能无法编译、资源无法解析、模块导入无效或工程配置不一致，优先选择 `BUILD_OR_RESOURCE_ISSUE`。
- 如果主要问题是 ArkTS / TypeScript 语法、类型、空值或语言约束，优先选择 `LANGUAGE_CONSTRAINT_VIOLATION`。
- 如果问题只影响可读性、命名、结构或轻微重复，默认不进入 `risks`；只有明显影响后续 review 或维护时才选择 `READABILITY_OR_MAINTAINABILITY_RISK`。

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

- 同一组代码位置、同一条证据链、同一个根因只输出一个风险。
- 不要把同一事实拆成需求、接口、平台、状态、异常等多个近义风险。
- 规则违规类风险由规则融合阶段生成；rubric agent 不要用自由风险重复表达同一条规则编号已经覆盖的事实。
- 只有存在规则之外的独立运行时、数据流、状态、异常处理或平台约束后果时，才另列 rubric 风险。

## 输出阈值

候选风险必须至少满足以下条件之一，才可进入 `risks`：

- 对应明确扣分项的 `deduction_trace`。
- 有真实 `generated/` 代码位置和可复核后果。
- 触发 hard gate 候选。
- 会导致功能链路、数据状态、异常处理、安全隐私、外部服务集成或平台约束出现明确问题。

以下内容默认不进入 `risks`，应写入 `rationale`、`main_issues` 或扣分说明：

- 低置信度推测。
- 轻微风格或命名问题。
- 局部可读性问题。
- 轻微重复代码。
- 可能但未证实的性能问题。
- 不影响功能链路、构建、平台约束或用户可见行为的局部实现偏好。

## 输出字段规则

- 已匹配 taxonomy 的风险必须包含稳定 `risk_code`。
- 已匹配 taxonomy 的 `level` 和 `title` 必须与表格完全一致。
- 已匹配 taxonomy 时，`risk_category` 应与 taxonomy 的 `level` 相同。
- `description` 说明风险后果，不要只复述代码现象。
- `evidence` 给出可复核证据摘要；如包含行号，必须使用 `generated/` 工程文件真实行号，不要使用 patch hunk 行号。

## 输出前自检

按以下顺序自检，只保留通过自检的风险：

1. 证据事实是否清晰。
2. 是否已按根因归并。
3. 是否能映射到 taxonomy code。
4. 是否已被规则风险覆盖。
5. 是否达到风险输出阈值。
6. `level`、`title`、`risk_category` 是否与 taxonomy 一致。
