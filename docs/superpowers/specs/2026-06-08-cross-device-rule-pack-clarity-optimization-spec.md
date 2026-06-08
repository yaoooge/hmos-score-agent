# 一多规则集可判定性优化方案

## 背景

`references/rules/cross-device-adaptation.yaml` 是一多适配任务的内部规则包，当前规则覆盖面较广，但自然语言描述中混合了硬性约束、推荐实践、场景判断和 UI 语义推断。交给 agent 复核时，部分规则容易在 `pass`、`fail`、`notApplicable`、`review` 之间波动。

本方案逐条梳理规则描述的清晰度和可执行性，标出当前可保留的规则、需要优化的规则，以及建议如何在现有 YAML 字段内修改规则文案。后续实施只修改 `references/rules/cross-device-adaptation.yaml` 的现有文案字段，不新增或删除字段，不改变前后功能流程。

## 目标

- 降低 agent-assisted 判定中的语义漂移和偶发误判。
- 让每条规则具备明确的适用性、失败条件和证据要求。
- 将 `must_rules` 与 `should_rules` 的严重度语气对齐，避免 P1 建议项被当成硬失败。
- 为后续只修改 YAML 文案提供逐条落地清单。

## 非目标

- 本方案不直接修改 `cross-device-adaptation.yaml`。
- 后续实施不得新增、删除或重命名 YAML 字段。
- 后续实施不得修改 `detector.kind`、`detector.mode`、`detector.config.check`、`targetPatterns`、`profile`、`priority` 等会影响规则执行流程或评分流程的字段。
- 不调整评分权重、riskCode 或报告 schema。
- 不修改静态判定器、agent 路由、证据收集、扫描范围或规则启用顺序。
- 不判断 HarmonyOS 官方推荐本身是否正确，只评估当前规则是否适合稳定交给 agent 判定。

## 结论摘要

### 总体判断

- `OK`：规则边界较清楚，主要依赖明确组件、属性或 API，可以保留当前语义。
- `需澄清`：规则方向合理，但存在适用范围、术语或 pass/fail 边界不清，需要补充文案。
- `需调整`：规则语义过强、现有证据范围与规则目标不匹配，或与其他规则存在口径冲突，需要在现有 YAML 文案中收窄适用性、补充 review 条件或弱化语气。

### 最高优先级问题

1. `should_rules` 中大量规则仍使用“必须 / 禁止 / 一律判定失败”，与 `priority: P1`、`impact: light` 不一致。
2. Web 规则当前只基于 `**/*.ets` 证据，却要求判断 Web 资源中的 CSS/JS 媒体查询、相对单位和宫格列数；在不改扫描流程的前提下，需要在文案中明确“资源不可见时进入 review，不凭猜测 fail”。
3. Tabs、Hover、Flex、GridCol 等规则依赖“主导航 / 展示类 / 交互类 / 合理设置 / 需要响应式适配”等语义判断，未提供静态识别口径。
4. 横向断点与 Web 断点口径不一致：ArkUI 规则包含 `xl:[1440,+∞)`，Web 规则将 `lg` 写为 `[840,+∞)`。

## 逐条优化建议

| 规则 ID | 当前状态 | 波动风险 | 主要问题 | 优化建议 |
|---|---|---:|---|---|
| OM-CONFIG-MUST-01 | OK | 低 | `deviceTypes` 的失败条件明确，但“建议 2in1”可能被 agent 误读为必须。 | 保留规则；在 fail 条件中明确“仅缺少 phone 或 tablet 失败，缺少 2in1 不失败”。 |
| OM-BREAKPOINT-MUST-01 | 需澄清 | 中 | 与 Web 断点规则口径不完全一致；同时覆盖自定义断点和 GridRow breakpoints，边界较宽。 | 明确本规则只检查 ArkUI/Native 横向断点；补充 `xl` 是否强制；与 OM-WEB-MUST-04 对齐。 |
| OM-BREAKPOINT-MUST-02 | OK | 低 | 排除“断点系统自身初始化”是合理的，但需要稳定识别基础设施代码。 | 保留规则；补充基础设施识别例子，如 `registerBreakpoints`、`BreakpointSystem.register`、断点常量定义文件。 |
| OM-BREAKPOINT-MUST-03 | 需澄清 | 中 | “断点值分发工具类”依赖功能识别，agent 可能把普通配置对象误判为分发工具。 | 在现有文案中补充适用性：仅当类/函数同时具备多个断点值入参和按当前断点返回值的方法时适用。 |
| OM-BREAKPOINT-MUST-04 | 需澄清 | 中 | 页面组件、工具类、自定义断点来源之间的边界清楚，但 `onAreaChange` 作为尺寸来源是否一律失败容易争议。 | 明确只在 `onAreaChange` 结果被用于 sm/md/lg/xl 布局分支时失败；普通测量、动画、埋点不适用。 |
| OM-BREAKPOINT-MUST-05 | 需调整 | 中 | 允许 `display.on('change')`，但 Web 同步规则只允许 window/mediaquery，存在口径冲突。 | 仅改文案统一口径：若保留 `display.on('change')`，在 OM-WEB-MUST-03 文案中也写明该来源可作为合规证据；不改 detector 配置。 |
| OM-BREAKPOINT-MUST-06 | 需澄清 | 中 | `onWindowStageCreate` 内直接注册失败，但 `loadContent` 回调内注册合规；静态证据容易混淆。 | 增加判定：需要看注册调用是否位于 `loadContent` success callback 或页面 `aboutToAppear` 内，不得仅因外层函数名失败。 |
| OM-GRIDROW-MUST-01 | OK | 低 | `breakpoints.value` 标准值明确。 | 保留规则；补充允许空配置时 notApplicable，只有显式自定义 breakpoints.value 才检查值。 |
| OM-LIST-MUST-01 | OK | 低 | 非递减列数序列明确。 | 保留规则；补充仅适用于 `lanes` 随断点配置或可解析为断点序列的 List。 |
| OM-WATERFLOW-MUST-01 | OK | 低 | 非递减列数序列明确。 | 保留规则；补充 `columnsTemplate` 字符串解析口径，如 `1fr 1fr` 计为 2 列。 |
| OM-SWIPER-MUST-01 | OK | 低 | 非递减 `displayCount` 明确。 | 保留规则；补充无法解析具体序列时进入 review，不直接 fail。 |
| OM-SWIPER-MUST-02 | 需澄清 | 中 | 全屏滑动切换场景排除依赖语义判断。 | 明确全屏场景静态特征：Swiper 高度/宽度 100%、页面顶层、子项撑满页面、垂直方向切换等。 |
| OM-SWIPER-MUST-03 | 需澄清 | 中 | 与 OM-SWIPER-MUST-02 一样依赖全屏场景排除；`displayCount` 动态值难解析时会波动。 | 复用全屏排除口径；明确仅当确定存在 `displayCount >= 2` 且两侧 margin 都缺失时失败。 |
| OM-GRID-MUST-01 | OK | 低 | 非递减列数序列明确。 | 保留规则；补充 `columnsTemplate` 计列规则，避免字符串解析差异。 |
| OM-SIDEBAR-MUST-01 | 需调整 | 中 | `showSideBar` 固定不变一律失败过强，部分场景可能始终展示或始终隐藏是合理的。 | 改为仅对页面级辅助导航/筛选侧栏适用；补充可豁免场景，如内容型固定双栏、业务明确单栏。 |
| OM-SIDEBAR-MUST-02 | 需调整 | 中 | 所有断点 `sideBarWidth` 相同即失败过强，固定窄侧栏或图标栏可能合理。 | 不改 priority；在 `rule` 和 `decisionCriteria` 文案中补充适用条件：仅当侧栏承载可读文本/列表，且 md/lg/xl 宽度跨度明显时要求变化。 |
| OM-SIDEBAR-MUST-03 | 需调整 | 中 | 强制 sm Overlay、md/lg Embed，可能不适用于所有交互模型。 | 在现有文案中收窄为页面级主从布局侧栏适用；局部抽屉、固定图标侧栏等无法确认场景进入 review。 |
| OM-TABS-MUST-01 | 需澄清 | 高 | 仅主导航 Tabs 应适用，但规则可能命中局部 Tabs。 | 增加主导航识别条件：页面顶层 Tabs、包含多个 TabContent 页面、承担一级页面切换；局部筛选/详情 Tabs 不适用。 |
| OM-TABS-MUST-02 | 需澄清 | 高 | 与 OM-TABS-MUST-01 同源，局部 Tabs 易误杀。 | 复用主导航适用性；明确只检查适用实例的 `vertical` 与 `barPosition` 联动。 |
| OM-TABS-MUST-03 | 需澄清 | 高 | “barWidth/barHeight 按断点设置”未给目标值，固定值失败过强。 | 明确推荐值：lg/xl 侧边导航 `barWidth=96`、`barHeight='100%'`；sm/md 底部导航允许固定高度。 |
| OM-GRIDROW-MUST-02 | 需调整 | 高 | 强制 `columns` 必须按断点对象配置，固定 12 列一律失败不合理；固定 12 列配合 GridCol span/offset 响应式也常见。 | 不改 priority；在文案中收窄为“若 columns 用于响应式列数，则序列非递减；固定 12 列时不因 columns 固定直接失败，GridCol span/offset 另按对应规则判断”。 |
| OM-GRIDCOL-MUST-01 | 需澄清 | 高 | 标题说 span 必须不同，正文又允许 span 相同但 columns 不同，标题与判定不一致。 | 改名为“GridCol 实际占比应按断点体现响应式差异”；判定以 `span/columns` 比值为准。 |
| OM-FLEX-MUST-01 | 需澄清 | 高 | “合理设置”非常主观；所有子组件相同 flexGrow/flexShrink 即失败过强。 | 在现有文案中定义适用性：仅当 Flex 内同时存在弹性内容区和固定留白/操作区时适用；单一均分工具栏不适用。 |
| OM-HOVER-MUST-01 | 需澄清 | 高 | “展示类/交互类组件”需要语义分类，静态判断不稳定。 | 增加组件分类表：展示类如 `Video/XComponent/Image/Canvas/Web`，交互类如 `Button/Slider/TextInput/控制栏`；无法分类进入 review。 |
| OM-HOVER-MUST-02 | 需澄清 | 中 | “未处理折痕避让导致覆盖”包含结果判断，静态证据难证明是否覆盖。 | 改为检查机制：使用 FolderStack/FoldSplitContainer 自动避让，或自定义实现读取 crease region 并参与尺寸/位置计算。 |
| OM-HOVER-MUST-03 | OK | 低 | FolderStack 全屏条件列举较清楚。 | 保留规则；补充如果 FolderStack 本身位于已撑满的父容器，也可通过父链证据判 pass。 |
| OM-HOVER-MUST-04 | 需澄清 | 高 | upperItems 是否遗漏展示类组件依赖语义分类。 | 复用 OM-HOVER-MUST-01 分类表；只能确认交互组件进入 upperItems 时 fail，无法确认遗漏时 review。 |
| OM-HOVER-MUST-05 | OK | 低 | upperItems 字符串与子组件 id 匹配条件明确。 | 保留规则；补充 id 动态表达式无法解析时进入 review。 |
| OM-HOVER-MUST-06 | 需澄清 | 高 | primary/secondary 的内容分类依赖语义。 | 复用展示类/交互类分类表；无法分类时 review，不直接 fail。 |
| OM-HOVER-MUST-07 | OK | 低 | 半折叠状态和横屏方向两个条件明确。 | 保留规则；补充 LANDSCAPE 枚举别名和方向判断封装函数识别。 |
| OM-HOVER-MUST-08 | OK | 低 | API 使用要求明确。 | 保留规则；补充如果通过项目封装函数调用 `getCurrentFoldCreaseRegion`，应判 pass。 |
| OM-HOVER-MUST-09 | OK | 低 | 注册和取消监听配对要求明确。 | 保留规则；补充 callback 引用或匿名回调的匹配策略。 |
| OM-WEB-MUST-01 | 需澄清 | 中 | Web 容器“按断点动态设置”可能误伤 `width('100%')/height('100%')` 这类自适应配置。 | 明确 `100%`、`layoutWeight`、父容器自适应可判 pass；只禁止固定 vp 宽高且无响应式约束。 |
| OM-WEB-MUST-02 | 需调整 | 高 | 要求 Native 断点同步到 Web，但无法仅凭 ETS 判断 Web 是否已有 CSS 自适应或是否需要 Native 同步。 | 在现有文案中补充适用性：仅当 Web 内容依赖 Native 注入断点或可见证据表明 Web 侧无独立媒体查询时适用；否则进入 review。 |
| OM-WEB-MUST-03 | 需调整 | 中 | 与 OM-BREAKPOINT-MUST-05 的 `display.on('change')` 口径冲突。 | 仅改文案与 OM-BREAKPOINT-MUST-05 对齐；明确允许同一套标准监听来源作为合规证据。 |
| OM-WEB-MUST-04 | 需调整 | 高 | 当前证据范围只有 ETS，但规则目标包含 Web 资源；断点范围缺少 xl，与 Native 规则不一致。 | 不改 targetPatterns；在 `rule`/`decisionCriteria.review` 文案中明确：只有 ETS 中能定位并读取 Web 资源断点证据时才判定，否则进入 review；断点范围文案与 OM-BREAKPOINT-MUST-01 对齐。 |
| OM-WEB-MUST-05 | 需调整 | 高 | 当前证据范围只有 ETS，但规则目标包含 Web CSS；“height/width 形式”描述也不够标准。 | 不改 targetPatterns；在文案中明确违规模式为“可见 CSS 媒体查询中使用非标准纵向断点表达式”，无法读取 Web 资源时 review。 |
| OM-LIST-SHOULD-01 | 需调整 | 高 | P1 规则却写“必须/禁止/一律判定不满足”；且具体间距值过硬。 | 在现有文案中改语气为“建议”；保留固定值作为推荐，不作为硬失败。 |
| OM-LIST-SHOULD-02 | OK | 低 | 多列保留 divider 的问题明确。 | 保留为 P1；明确未设置 divider 与显式 undefined 都算 pass，只有多列且显式保留 divider 时不满足。 |
| OM-WATERFLOW-SHOULD-01 | OK | 低 | 动态切换列数使用 SLIDING_WINDOW 的条件较明确。 | 保留为 P1；明确静态列数不变化时 notApplicable。 |
| OM-WATERFLOW-SHOULD-02 | 需澄清 | 中 | “图片或卡片类 WaterFlow”“等效约束”依赖语义判断。 | 在现有文案中补充适用性：FlowItem 根节点包含 Image/卡片容器/固定比例内容时适用；列出等效属性白名单。 |
| OM-NAVIGATION-SHOULD-01 | 需澄清 | 中 | “合理比例”没有范围，只说必须设置 navBarWidth。 | 将规则名改为“Split 模式建议显式设置 navBarWidth”；如保留合理比例，应给出推荐范围或示例。 |
| OM-GRIDROW-SHOULD-01 | 需调整 | 高 | “必须且只能通过 gutter 控制”过强，padding 作为页面外边距可能合理。 | 改为：GridRow 子项间距应优先通过 gutter；页面容器 padding 不作为替代失败条件。 |
| OM-GRIDCOL-SHOULD-01 | 需澄清 | 中 | “需要在大屏居中展示”依赖设计意图。 | 在现有文案中补充适用性：仅当 GridRow/GridCol 已用于大屏居中布局，或存在断点条件下两侧留白逻辑时适用。 |
| OM-GRIDROW-SHOULD-02 | 需调整 | 高 | 标题说必须用栅格，正文又允许固定 maxWidth 不涉及；`maxWidth/maxWidth/width/height` 有重复和表述错误。 | 修正文案；只禁止“依赖断点条件动态切换 constraintSize 宽度以模拟居中”的反模式，不禁止固定最大行宽。 |
| OM-FLEX-SHOULD-01 | 需澄清 | 中 | “等间距均分布局”依赖语义，固定 margin/padding 是否用于间距难判。 | 明确适用实例：工具栏/菜单栏中多个同类子项均分；其他 Flex 布局不适用。 |
| OM-FLEX-SHOULD-02 | 需澄清 | 中 | “内容可能溢出容器宽度”需要运行时尺寸或设计语义。 | 改为检查静态高风险形态：多个固定宽子项横向排列且无横向滚动/换行；无法判断时 review。 |
| OM-ROWCOLUMN-SHOULD-01 | 需澄清 | 中 | “需要按比例分配空间”依赖布局意图。 | 明确只在兄弟子组件承担比例布局且存在固定 vp 宽高导致总宽/高溢出的证据时不满足。 |
| OM-ROWCOLUMN-SHOULD-02 | 需调整 | 高 | 使用 if 条件配合断点控制显隐不一定错误，强制 displayPriority 过窄。 | 改为推荐项：优先使用 displayPriority；允许断点条件显隐作为合规方案，除非出现尺寸变化导致截断。 |
| OM-ROWCOLUMN-SHOULD-03 | 需澄清 | 中 | “固定元素间的空白”可由 Blank、Spacer、justifyContent、margin 等实现，Blank 不是唯一合理方式。 | 改为“建议使用 Blank 或等效弹性占位”；明确固定空容器才不满足。 |
| OM-SCROLL-SHOULD-01 | 需澄清 | 中 | “横向可延伸内容”依赖内容数量和尺寸；规则名只写 Scroll，但正文允许横向 List。 | 改名为“横向延伸内容应使用横向滚动容器”；保留 Scroll+Row 与 List horizontal 两种 pass。 |
| OM-ASPECTRATIO-SHOULD-01 | 需澄清 | 中 | “需要保持宽高比”依赖内容类型。 | 在现有文案中补充适用性：图片、视频、封面、地图、预览卡片等视觉内容；普通文本卡片不适用。 |
| OM-ASPECTRATIO-SHOULD-02 | 需调整 | 高 | 要求所有 aspectRatio 按断点不同不合理，很多内容应保持固定比例。 | 改为“当不同断点设计稿要求不同比例时建议切换”；默认固定 aspectRatio 应判 OK。 |
| OM-HOVER-SHOULD-01 | 需澄清 | 中 | 与 OM-HOVER-MUST-08/02 有重叠，且 creaseRegion 数组下标表述不够清楚。 | 在现有文案中说明其与 OM-HOVER-MUST-02/08 的关系，并明确 rect.top/rect.height 与上下半屏计算公式。 |
| OM-WEB-SHOULD-01 | 需调整 | 高 | 当前证据范围只有 ETS，但规则目标包含 Web 资源；“全部使用固定 px”与“布局关键属性”边界不清。 | 不改 targetPatterns；在文案中限定关键布局属性，如 width、height、margin、padding、gap、grid/flex basis；无法读取 Web 资源时 review。 |
| OM-WEB-SHOULD-02 | 需调整 | 高 | 当前证据范围只有 ETS，但规则目标包含 CSS Grid；列数必须递增也可能过强，固定列数 + 自适应宽度可能合理。 | 不改 targetPatterns；在文案中改为“宫格列数应随断点非递减或使用 auto-fit/auto-fill 自适应”；无法确认 Web 布局时 review。 |
| OM-WEB-SHOULD-03 | 需调整 | 高 | 当前证据范围只有 ETS，但规则目标包含 Web 轮播实现；Web 轮播组件形态多，displayCount 未必是统一概念。 | 不改 targetPatterns；在文案中明确仅检查可见的 Web 轮播实现证据，无法识别轮播库或资源不可见时 review。 |

## 规则文案统一规范

### 适用性文案

不新增 `applicability` 等字段。每条规则只在现有 `rule`、`llmPrompt`、`decisionCriteria`、`rule_name` 中补充适用性、失败条件和 review 条件。建议把 `rule` 文案组织为：

```yaml
rule: >-
  [规则要求]。适用范围：[哪些组件/场景适用]。不适用范围：[哪些组件/场景不适用]。
  失败条件：[什么静态证据可判失败]。复核条件：[证据不可见或语义无法确认时进入 review]。
```

例如 Tabs 规则应在 `rule` 中写明“仅页面级主导航 Tabs 适用；局部筛选、详情页分段、内容区 Tabs 不适用；无法通过组件层级确认是否主导航时进入 review”。

### must 与 should 语气

`must_rules` 可以使用：

- 必须
- 不得
- 命中即判定失败

`should_rules` 建议使用：

- 建议
- 优先
- 不满足建议
- 记录轻风险

避免在 `should_rules` 中使用“一律判定失败”，否则 agent 会把 P1 规则理解为 P0 硬失败。

### decisionCriteria

当前大多数 `decisionCriteria` 只是重复规则名，建议改为证据化描述：

```yaml
decisionCriteria:
  pass:
    - 存在 GridRow breakpoints.value，且值精确为 ['320vp','600vp','840vp','1440vp']。
    - 未显式配置 GridRow breakpoints.value，使用系统默认断点。
  fail:
    - 显式配置 GridRow breakpoints.value，且任一阈值不是 320/600/840/1440vp。
  notApplicable:
    - 工程中不存在 GridRow，或 GridRow 未配置 breakpoints.value。
  review:
    - breakpoints.value 来自无法解析的运行时表达式。
```

## 推荐实施顺序

### 第一阶段：低风险文案修复

- 统一 `should_rules` 语气。
- 给 `OM-CONFIG-MUST-01` 明确 `2in1` 只是建议。
- 修正 `OM-GRIDCOL-MUST-01` 标题与正文不一致。
- 修正 `OM-GRIDROW-SHOULD-02` 中 `maxWidth/maxWidth/width/height` 的重复和歧义。

### 第二阶段：适用性补充

- 为 Tabs 规则补主导航识别边界。
- 为 Hover 规则补展示类/交互类组件分类表。
- 为 Flex、Row/Column、AspectRatio 规则补“适用场景”与“不适用场景”。
- 为 SideBarContainer 规则补页面级侧栏适用性。

### 第三阶段：规则语义文案收窄

- 在不改 priority 的前提下，收窄 `OM-GRIDROW-MUST-02` 文案，避免固定 12 列直接失败。
- 调整 `OM-ASPECTRATIO-SHOULD-02`，避免固定比例内容被误判。
- 调整 `OM-ROWCOLUMN-SHOULD-02`，允许断点条件显隐作为合规方式。
- 调整 `OM-GRIDROW-SHOULD-01`，允许页面外边距 padding 与 GridRow gutter 共存。

### 第四阶段：证据不足时的 review 文案

- Web 规则不改 `targetPatterns`，只在文案中明确：现有证据无法读取 Web 资源时进入 review，不凭推测 fail。
- 在文案中统一 `display.on('change')`、`window.on('windowSizeChange')`、`mediaquery.matchMediaSync` 的断点监听口径，不改检测流程。
- 对无法解析的动态表达式统一进入 `review`，不要由 agent 猜测 pass/fail。

## 验收标准

- 每条规则都能回答：什么时候适用、什么证据判 pass、什么证据判 fail、什么时候 review。
- P1 规则不再使用 P0 风格的失败语气。
- Web 规则在现有证据范围不足时有明确 review 文案，不要求改扫描范围。
- Tabs、Hover、Flex、AspectRatio 等语义型规则不再仅凭组件名直接判失败。
- 同一段代码不会因为 agent 对“主导航”“合理比例”“展示类组件”等词的理解不同而产生明显判定波动。
