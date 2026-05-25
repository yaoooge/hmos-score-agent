# Risk Review Taxonomy 覆盖缺口分析

## 数据范围

数据来源：`GET http://8.136.155.63:3000/dashboard/analysis/risk-review-calibrations?page=1..7&pageSize=500`

统计时间：2026-05-25

全量记录：
- 总数：3245
- 规则风险：2207
- rubric 自由风险：1038
- 人工同意：3054
- 人工不同意：191

## 已出现的风险类型

### 规则风险

规则风险主要集中在以下族：

| 规则族 | 数量 | 主要含义 |
| --- | ---: | --- |
| EXP | 536 | 体验链路、一多交互、浅层窗口、导航栈、弹窗形态、搜索/结果联动 |
| OFFICIAL-LINTER | 432 | 官方 linter 风格、性能、安全、跨设备颜色/对比度等 |
| ARKTS | 367 | ArkTS 语言约束、性能约束、类型/语法/装饰器等 |
| CMP | 321 | ArkUI 组件适配，如 List/Grid/Swiper/Tabs/WaterFlow/Sheet 等 |
| RSP | 317 | 断点系统、断点阈值、监听方式、GridRow/GridCol 基础适配 |
| CST | 108 | 场景内组件推荐值，如 Grid/List/Swiper/Tabs/WaterFlow 参数 |
| MALL | 82 | 电商场景需求规则，如隐私弹窗、登录授权、订单/购物车体验 |
| HM-REQ / HM | 11 | 医疗/停车等任务特定能力，如地图、定位、openLink、AtomicServiceWeb |
| ADAPT / HOV / FOLD / WEB | 24 | 折叠屏、悬停态、Web/Native 断点同步、特定适配策略 |
| REQ | 9 | 通用需求类硬规则 |

结论：这些规则族大多不需要成为 taxonomy 一级分类。taxonomy 应表达“风险本质”，规则族继续表达“触发来源”。例如 `MALL-MUST-03` 的真实风险是“指定 Kit/API/组件使用偏离”，不是新增“电商风险”。

### rubric 自由风险

rubric 自由风险可归并到当前 taxonomy 的主类：

| 归并类型 | 数量 | 当前覆盖 |
| --- | ---: | --- |
| 布局/断点/一多适配 | 189 | `UI_LAYOUT_OR_BREAKPOINT_MISMATCH` |
| 需求未实现/不完整 | 179 | `REQUIREMENT_NOT_IMPLEMENTED` / `REQUIREMENT_PARTIALLY_IMPLEMENTED` |
| 语言/静态质量 | 118 | `LANGUAGE_CONSTRAINT_VIOLATION` / `BUILD_OR_RESOURCE_ISSUE` |
| 可维护性 | 109 | `READABILITY_OR_MAINTAINABILITY_RISK` |
| API/Kit/指定组件偏离 | 90 | `API_USAGE_DEVIATION` |
| 错误处理/校验 | 88 | `ERROR_HANDLING_OR_VALIDATION_RISK` |
| 数据/状态一致性 | 74 | `DATA_STATE_CONSISTENCY_RISK` |
| 构建/资源/工程配置 | 71 | `BUILD_OR_RESOURCE_ISSUE` |
| 性能/生命周期 | 64 | `PERFORMANCE_OR_LIFECYCLE_RISK` |
| 安全/隐私 | 3 | `SECURITY_OR_PRIVACY_RISK` |
| 外部服务集成 | 3 | `EXTERNAL_SERVICE_INTEGRATION_RISK` |

## 当前 taxonomy 覆盖结论

当前 `references/risks/risk-taxonomy.yaml` 的一级分类总体足够，不建议新增大量一级 code。

原因：
- 现网新增规则族多是规则来源、行业场景或功能场景，不是新的风险本质。
- 新增过多一级分类会增加 rubric agent 和 rule agent 对齐成本，反而降低稳定性。
- 当前 canonical 去重逻辑依赖“同一问题归到稳定 code”，分类过细会让同一问题更容易被拆散。
- 用户要求保留“多个规则触发同一维度时重复扣分”的特性，因此 taxonomy 不应把规则族强行合并为评分维度，只负责定义风险本质。

## 覆盖偏弱点

当前不是“缺少大类”，而是以下类别的描述和 `matchHints` 不足，导致 agent 在不同行业/场景下可能归类不稳定。

### 1. 指定 Kit/API/组件硬口径表达不足

现网样本：
- 未使用 MapKit MapComponent，使用静态图标/文本模拟地图。
- 未使用 FunctionalButton 获取手机号授权。
- 未使用 AtomicServiceWeb / AtomicServiceEnhancedWeb，改用普通 Web。
- 未使用 openLink 跳转花瓣地图，改用 startAbility。
- 硬编码拼音映射替代 Kit。
- 自定义本地同名函数、HTTP endpoint 或模拟实现替代指定能力。

建议仍归入：`API_USAGE_DEVIATION`

需要补强：
- 明确“规则要求指定 Kit/API/组件/调用方式时，pass 必须有真实 import、符号调用或可追溯到 Kit 的封装”。
- 明确“Axios、HTTP endpoint、本地同名函数、静态占位、Mock、自绘/静态图标不能等价为指定 Kit/API/组件”。

### 2. 浅层窗口、导航栈、弹窗状态类风险容易分散

现网样本：
- 浅层窗口搜索链路缺失。
- 横竖屏切换时未处理导航栈。
- 返回按钮未清理 popup 状态。
- 弹窗形态在大屏/小屏未切换。
- 半模态弹窗底部 padding 未按断点适配。

建议归类：
- 若是断点/窗口/弹窗布局策略：`UI_LAYOUT_OR_BREAKPOINT_MISMATCH`
- 若是导航栈、popup 可见状态、返回状态未同步：`DATA_STATE_CONSISTENCY_RISK`
- 若是任务明确要求的完整交互链路缺失：`REQUIREMENT_PARTIALLY_IMPLEMENTED`

需要补强：
- 在三个类别的 `matchHints` 中加入浅层窗口、导航栈、弹窗状态、popup 状态、横竖屏切换等词。
- skill 中明确优先级：先判断是否为明确需求缺失，再判断是否为状态一致性，最后判断是否为布局/断点参数偏差。

### 3. 折叠屏 / 悬停态 / fold crease 表达不足

现网样本：
- 未处理半折叠横屏悬停态。
- 未使用 `display.getCurrentFoldCreaseRegion()` 获取折痕区域。
- 未实现垂直断点或宽高比判断。
- 未处理折痕区域避让。

建议归入：`UI_LAYOUT_OR_BREAKPOINT_MISMATCH`

需要补强：
- 该类描述中加入折叠屏、悬停态、折痕区域、垂直断点、窗口形态。
- 不建议新增 `FOLDABLE_ADAPTATION_RISK`，否则会和 `UI_LAYOUT_OR_BREAKPOINT_MISMATCH` 高度重叠。

### 4. Web/Native 断点同步类风险表达不足

现网样本：
- Native 断点未同步给 Web 组件。
- Web CSS media query 与系统断点范围不一致。
- Web 内使用固定 px 导致无法随视口自适应。
- H5 容器未使用任务要求的元服务 Web 组件。

建议归类：
- Web/Native 断点不同步：`UI_LAYOUT_OR_BREAKPOINT_MISMATCH`
- 指定 Web 容器/API 未使用：`API_USAGE_DEVIATION`
- 外部 H5 服务接入参数/配置不完整：`EXTERNAL_SERVICE_INTEGRATION_RISK`

需要补强：
- 在 `UI_LAYOUT_OR_BREAKPOINT_MISMATCH` 增加 Web/Native 断点同步、CSS media query、相对单位。
- 在 `API_USAGE_DEVIATION` 增加 AtomicServiceWeb、Web 容器等泛化描述，不写死具体业务。

### 5. 行业场景规则不应进入 taxonomy 一级分类

现网样本：
- MALL：隐私弹窗、手机号授权、购物车/订单提示、下拉刷新、分页加载、筛选/视图切换、route_map、RouterMap。
- HM-REQ：地图、定位权限、当前位置、openLink。
- 停车/H5 商城：AtomicServiceWeb。

建议：
- 不新增 `MALL_RISK`、`MEDICAL_RISK`、`PARKING_RISK` 等行业分类。
- 行业规则只作为 `sourceRuleId` / `canonicalRuleRef` 保留，canonical taxonomy 按风险本质归类。

## 建议修改方式

### references/risks/risk-taxonomy.yaml

只做轻量补强，不新增一级 code。

建议补强以下条目：

1. `API_USAGE_DEVIATION`
   - description 增加指定 Kit/API/组件硬口径。
   - matchHints 增加：指定 Kit、指定组件、真实 import、符号调用、可追溯封装、本地同名函数、Mock 替代、静态占位、HTTP endpoint、AtomicServiceWeb、MapComponent、FunctionalButton、openLink。

2. `UI_LAYOUT_OR_BREAKPOINT_MISMATCH`
   - description 增加窗口形态、折叠屏、悬停态、折痕区域、Web/Native 断点同步。
   - matchHints 增加：浅层窗口、半模态、弹窗形态、折叠屏、悬停态、折痕区域、垂直断点、横竖屏、Web 断点、CSS media query、相对单位、安全区避让。

3. `DATA_STATE_CONSISTENCY_RISK`
   - matchHints 增加：导航栈、popup 状态、弹窗状态、返回状态、横竖屏切换、页面栈、状态清理。

4. `REQUIREMENT_PARTIALLY_IMPLEMENTED`
   - matchHints 增加：交互链路不完整、核心链路缺失、空实现、无响应按钮、删除功能缺失、加载状态缺失、分页加载缺失。

5. `ERROR_HANDLING_OR_VALIDATION_RISK`
   - matchHints 增加：静默吞没、空 catch、仅 return 拦截、缺少用户提示、无确认对话框、误操作。

6. `READABILITY_OR_MAINTAINABILITY_RISK`
   - matchHints 增加：死代码、模板代码残留、目录组织不统一、技术栈混用、装饰器版本不一致、路由分支过多。

### 两个 agent skill

#### rubric agent

增加判定优先级：

1. 若问题已由 rule agent 以同一 `canonicalCode + evidence` 覆盖，则不输出重复 rubric risk。
2. 若规则或需求明确指定 Kit/API/组件/调用方式，且代码没有真实 import、符号调用或可追溯封装，归入 `API_USAGE_DEVIATION`。
3. 若核心功能链路完全不可用，归入 `REQUIREMENT_NOT_IMPLEMENTED`。
4. 若功能有部分实现但交互分支、边界、状态或兜底缺失，归入 `REQUIREMENT_PARTIALLY_IMPLEMENTED`。
5. 若问题主要来自断点、窗口形态、折叠屏、Web/Native 断点同步、组件响应式参数，归入 `UI_LAYOUT_OR_BREAKPOINT_MISMATCH`。
6. 若问题主要来自导航栈、popup、弹窗、缓存、全局状态同步，归入 `DATA_STATE_CONSISTENCY_RISK`。
7. 若问题主要来自异常吞没、校验、失败反馈、确认机制，归入 `ERROR_HANDLING_OR_VALIDATION_RISK`。

#### rule agent

增加输出归类要求：

1. 每个规则违规必须输出稳定的 `sourceRuleId`。
2. 每个规则违规必须映射到一个 canonical taxonomy code。
3. 行业/场景规则不得新增行业 taxonomy code，应按风险本质映射。
4. 多个规则触发同一维度时仍保留多条规则违规，继续参与扣分。
5. 只有当 rubric risk 与 rule violation 是同一代码位置、同一失败机制、同一 canonical code 时，才由融合阶段抑制 rubric risk，避免双倍扣分。
6. 同一维度下不同规则、不同证据、不同失败机制不得互相抑制。

## 不建议新增的分类

暂不新增：
- `FOLDABLE_ADAPTATION_RISK`
- `WEB_NATIVE_ADAPTATION_RISK`
- `INTERACTION_FLOW_RISK`
- `DESIGN_SYSTEM_COMPONENT_RISK`
- `MALL_RISK`
- `MEDICAL_RISK`
- `HOVER_STATE_RISK`

原因：
- 与现有 `UI_LAYOUT_OR_BREAKPOINT_MISMATCH`、`API_USAGE_DEVIATION`、`DATA_STATE_CONSISTENCY_RISK` 高度重叠。
- 会增加 agent 分类分歧。
- 会破坏“一个问题稳定落到一个 canonical code”的目标。

## 后续验证建议

1. 更新 taxonomy 后，用现网 3245 条风险做离线归类回放。
2. 验证 rubric 自由风险是否能稳定命中当前 12 个 score taxonomy code。
3. 抽样检查人工不同意的 191 条，区分“taxonomy 缺口”和“规则误报/证据不足”。
4. 对 `MALL/HM-REQ/ADAPT/HOV/WEB/FOLD` 等少量规则族重点验证，确保它们按风险本质归类，而不是变成行业分类。
