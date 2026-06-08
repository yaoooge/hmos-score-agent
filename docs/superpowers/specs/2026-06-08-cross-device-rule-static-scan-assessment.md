# 一多规则静态扫描能力评估与优化建议

## 背景

`references/rules/cross-device-adaptation.yaml` 的规则描述已经从“组件出现即硬判”优化为更强调适用场景、已确认布局意图、人工复核边界的表述。当前 `arkui_static` evaluator 仍主要按组件名、属性名、构造参数文本和少量正则做结论，因此需要重新定义每条规则的静态扫描策略。

本 spec 面向后续实现：逐条说明是否适合静态扫描、扫描路径、静态扫描能否直接产生确定性结论、是否需要修改现有静态评估器、是否需要 rule agent 二次判定。

## 当前阻塞

新版规则包目前存在一个 YAML 结构问题：

- `OM-FLEX-SHOULD-02` 的 `decisionCriteria.pass` 第一项被解析成对象而不是字符串，导致 `listRegisteredRules({ enabledPackIds: ["cross-device-adaptation"] })` 校验失败。
- 需要先把该项改为纯字符串，例如：`满足建议：多个固定宽子项横向排列的 Flex 设置 wrap: FlexWrap.Wrap，或提供横向滚动能力`。

这个问题不影响本文对原始 YAML 的分析，但会阻断规则 registry 正常加载。

## 总体策略

静态扫描器不应直接追求“读懂所有写法”。建议引入三类输出：

- `deterministic`：证据足够强，可以直接产出 `满足`、`不满足` 或 `不涉及`。
- `evidence_for_agent`：可以定位组件、属性、表达式、断点信号或可疑反模式，但不能稳定判定规则是否适用或是否满足。
- `not_supported`：静态层只做宽泛预检，不尝试给最终结论。

当前解析器实现边界：

- `staticScanner` 是轻量组件索引器，只记录组件调用、构造参数文本、链式属性文本、行号和非常粗的断点上下文。
- `readObjectProperty` 已经通过括号深度读取对象字段值；继续在这个局部函数上追加更多分支，会让字符串解析器越来越脆弱。
- `isResponsiveExpression` 只是响应式信号识别，不是语义证明。`isLargeScreen`、`isMediumScreen`、`getDisplayCount()`、`ResourceUtil.*()` 等多样写法不应靠名称白名单直接判满足或不满足。

因此后续实现不要在现有解析器上做零散补丁。建议只做两类稳态调整：

- **降级策略调整**：遇到封装表达式、方法调用、无法解析常量、页面级适用性不明时，输出 `evidence_for_agent`，不直接失败。
- **边界清晰的解析替换**：如果确实需要提升解析能力，应抽出独立的 ArkUI 表达式/组件证据收集模块，用统一接口替换现有局部正则判断，而不是继续修补 `readObjectProperty`、`isResponsiveExpression` 或单条规则里的正则。

规则描述包含“已确认”“无法确认进入人工复核”“固定间距有业务理由”等语义时，静态层不应只因属性缺失或固定值直接判失败。

## 规则逐条建议

| 规则 | 是否静态扫描 | 扫描路径 | 确定性结论 | 需改 evaluator | Agent 二次判定 | 优化建议 |
|---|---|---|---|---|---|---|
| OM-CONFIG-MUST-01 | 是 | `**/src/main/module.json5`，仅 HAP `module.type=entry` | 可直接判 `deviceTypes` 是否包含 `phone` 和 `tablet`；`2in1` 缺失不失败 | 小改 | 条件需要 | 直接字段解析可确定；但 product 专用模块如 pc-only/2in1-only 是否适用应结合任务或模块角色交给 agent/上下文判定。 |
| OM-BREAKPOINT-MUST-01 | 是 | `**/*.ets` 中自定义断点常量、`GridRow.breakpoints.value`、断点系统注册 | 显式数值可确定；常量无法解析时不能硬判 | 需要 | 条件需要 | 发现 `300/768/1200` 等非推荐值可直接失败；常量或封装类边界不明时转 agent，不在现有解析器上补更多常量分支。 |
| OM-BREAKPOINT-MUST-02 | 是 | `**/*.ets` 中布局条件表达式、工具类、断点派发函数 | 明确 `width < 600`、`screenWidth >= 840` 可直接失败 | 小改 | 条件需要 | 保留确定性反模式。排除 `BreakpointSystem.register`、注释、非布局计算。封装函数是否用于布局可转 agent。 |
| OM-BREAKPOINT-MUST-03 | 证据扫描 | 断点值分发类、构造函数、`getValue`、`switch/if` 分发 | 不建议直接终判 | 需要 | 是 | 当前 `case_constraint_precheck` 合理。静态层提取候选类、参数个数、分支覆盖 sm/md/lg/xl，agent 判断是否为断点值分发工具。 |
| OM-BREAKPOINT-MUST-04 | 是 | 页面组件断点来源、`@StorageProp`、`@Env`、mediaquery、window listener、GridRow | 反模式可直接失败；合规封装只能给证据 | 需要 | 条件需要 | `isLargeScreen/isMediumScreen` 只能证明有封装，不能证明来源标准。需要追踪 AppStorage 初始化或转 agent。 |
| OM-BREAKPOINT-MUST-05 | 是 | `window.on('windowSizeChange')`、`mediaquery.matchMediaSync`、`display.on('change')`、`foldStatusChange` | 使用 fold/orientation 驱动断点更新可直接失败 | 小改 | 条件需要 | 保留反模式判定。仅发现 fold/orientation 但无法确认用于断点更新时转 agent。 |
| OM-BREAKPOINT-MUST-06 | 是 | EntryAbility、页面生命周期、`loadContent` 回调、`aboutToAppear` | 明确在 `loadContent` 前注册可失败；明确回调后可通过 | 需要 | 条件需要 | 当前正则窗口太短，不应继续扩大窗口补丁；无法用现有证据确认顺序时输出 review，不要默认满足。 |
| OM-GRIDROW-MUST-01 | 是 | `GridRow({ breakpoints: { value } })` | 显式数组可直接判；常量解析不到需 review | 需要 | 条件需要 | 当前只 `includes` 文本。缺少 `breakpoints` 时按规则通常不涉及；常量值不明时转 agent，不继续补局部常量解析。 |
| OM-LIST-MUST-01 | 是-证据 | `List.lanes`、构造参数 `lanes`、断点 map、三元表达式、helper 返回值 | 仅显式数值序列可确定；封装写法需 review | 需要 | 是 | `this.isLargeScreen ? 3 : 2`、`getCategoryLanes()`、资源数组都应作为证据给 agent；解析到下降序列才直接失败。 |
| OM-WATERFLOW-MUST-01 | 是-证据 | `WaterFlow.columnsTemplate`、断点 map、template 字符串 | 显式 template 列数序列可确定 | 需要 | 条件需要 | 只对直观字符串列数或已可解析 map 判定；封装常量或方法转 agent。 |
| OM-SWIPER-MUST-01 | 是-证据 | `Swiper.displayCount` | 显式数值/map/helper 可确定；方法返回需 review | 需要 | 是 | `getDisplayCount()` 是典型二次判定入口。静态层提取方法体附近证据，不直接失败。 |
| OM-SWIPER-MUST-02 | 是-证据 | 同一 `Swiper` 的 `displayCount` 和 `indicator` | `displayCount` 与 `indicator` 均显式时可确定 | 需要 | 是 | 多元素时 `indicator(false)` 可通过；单元素时 `Indicator.dot()` 可通过；任一侧封装时转 agent。 |
| OM-SWIPER-MUST-03 | 是-证据 | `Swiper.displayCount`、`prevMargin`、`nextMargin` | `displayCount>=2` 且两侧都缺失可失败；无法确认 displayCount 时 review | 需要 | 条件需要 | 当前只要有 margin 就满足较合理；要补充 `displayCount` 动态时不要直接失败。 |
| OM-GRID-MUST-01 | 是-证据 | `Grid.columnsTemplate` | 显式 template 序列可确定 | 需要 | 条件需要 | 只对直观字符串列数或已可解析 map 判定；常量/方法转 agent。 |
| OM-SIDEBAR-MUST-01 | 证据扫描 | 页面级 `SideBarContainer.showSideBar`、外层页面结构、断点信号 | 不建议直接失败，除非适用性和固定值都明确 | 需要 | 是 | 新规则限定页面级辅助导航。静态层识别页面级候选、showSideBar 表达式、visibility 条件，agent 判定是否页面级侧栏。 |
| OM-SIDEBAR-MUST-02 | 证据扫描 | 页面级 `SideBarContainer.sideBarWidth`、侧栏内容类型 | 不建议直接失败 | 需要 | 是 | 纯图标侧栏、固定窄侧栏、局部抽屉均需 agent 判断。静态层只提取 width 与内容组件。 |
| OM-SIDEBAR-MUST-03 | 证据扫描 | `SideBarContainer` 原始构造参数和 `type` 属性文本 | 只在页面级主从布局明确时可确定 | 需要 | 是 | 不要求现有解析器理解 positional type；保留原始参数如 `isLargeScreen ? Embed : Overlay` 给 agent，避免误判。 |
| OM-TABS-MUST-01 | 证据扫描 | 页面级主导航 `Tabs.vertical`、TabContent 数量、页面层级 | 不建议仅凭属性缺失失败 | 需要 | 是 | 新规则只适用于页面级主导航。局部筛选/详情 tabs 应过滤或转 agent。 |
| OM-TABS-MUST-02 | 证据扫描 | 页面级主导航 `Tabs.barPosition` 与 `vertical` 联动 | 不建议仅凭属性文本失败 | 需要 | 是 | `Breakpoint.BREAKPOINT_LG`、`isLargeScreen`、封装 getter 都作为证据；agent 判断 End/Start 是否匹配。 |
| OM-TABS-MUST-03 | 证据扫描 | 页面级主导航 `Tabs.barWidth/barHeight/barMode` | 不建议直接失败 | 需要 | 是 | 新描述允许底部固定高度，lg/xl 推荐侧栏。需要结合导航形态二次判定。 |
| OM-GRIDROW-MUST-02 | 是-证据 | `GridRow.columns` | 显式 map/固定 12 可确定；二值 boolean 封装需 review | 需要 | 条件需要 | 新描述允许固定 `columns:12` 且不作为响应式手段。静态层需识别固定值通过，动态封装转 agent。 |
| OM-GRIDCOL-MUST-01 | 证据扫描 | `GridCol.span` 与祖先 `GridRow.columns` 的原始表达式 | 部分可确定，但建议 review 优先 | 需要 | 是 | 只有显式数字 map 可计算占比；其他场景保留 span/columns 原文给 agent。 |
| OM-FLEX-MUST-01 | 证据扫描 | `Flex` 子组件、`flexGrow/flexShrink`、固定区/弹性区线索 | 不建议直接判失败 | 已有人工复核，需保留 | 是 | 当前 `MANUAL_APPLICABILITY_CHECKS` 合理。静态层提取 Flex 子项尺寸、grow/shrink、同级结构。 |
| OM-HOVER-MUST-01 | 证据扫描 | `FolderStack`、`FoldSplitContainer`、半折状态布局、展示/交互组件 | 不可直接确定 | 无需改模式 | 是 | 保持 `case_constraint_precheck`。静态层增加展示类/交互类组件候选证据。 |
| OM-HOVER-MUST-02 | 证据扫描 | `FolderStack/FoldSplitContainer`、`getCurrentFoldCreaseRegion`、尺寸位置计算 | 部分可确定，建议 agent | 无需改模式 | 是 | 自动避让组件可作为强通过证据；自定义计算需 agent 判断是否真的参与布局。 |
| OM-HOVER-MUST-03 | 是 | `FolderStack` 的 `width/height/expandSafeArea`，父容器尺寸 | 直接判定部分可行 | 需要 | 条件需要 | 新描述允许内部或父容器撑满。当前只查自身属性，需扩展父子尺寸证据；不明时 review。 |
| OM-HOVER-MUST-04 | 证据扫描 | `FolderStack.upperItems` 与展示类组件 id | 不可直接确定展示类语义 | 无需改模式 | 是 | 保持 case constraint。静态层列出 upperItems、id 组件类型和位置。 |
| OM-HOVER-MUST-05 | 是 | `FolderStack.upperItems` 和同文件组件 `.id()` | 可直接判 upperItems 是否有匹配 id | 小改 | 条件需要 | 当前可做确定性匹配；若 id 在外部 builder 或跨文件，转 agent/不确定。 |
| OM-HOVER-MUST-06 | 证据扫描 | `FoldSplitContainer.primary/secondary` 内容类型 | 不可直接确定内容语义 | 无需改模式 | 是 | 保持 case constraint。扫描 primary/secondary builder 名称和组件类型作为证据。 |
| OM-HOVER-MUST-07 | 是-证据 | 自定义悬停态文件中的半折状态和横屏条件 | 明确缺一项可失败，但适用性需确认 | 需要 | 条件需要 | 当前 `getCustomHoverFiles` 容易泛化。先确认自定义悬停态，再判半折+横屏。 |
| OM-HOVER-MUST-08 | 是-证据 | `getCurrentFoldCreaseRegion`、`px2vp`、折痕 rect 使用 | 明确自定义悬停态且完全缺失可失败 | 需要 | 条件需要 | 不应只因文件含 display 就判自定义悬停态。需输出 rect 是否参与 height/position 证据。 |
| OM-HOVER-MUST-09 | 是 | `display.on('foldStatusChange')` 与 `display.off` 清理 | 可直接判监听是否清理 | 小改 | 条件需要 | 若 listener 引用封装清理函数，静态可提取后转 agent；同函数内 off 可确定通过。 |
| OM-WEB-MUST-01 | 是-证据 | `Web.width/height/layoutWeight` 与父容器约束 | 固定 vp 宽高可失败；自适应证据可通过 | 需要 | 条件需要 | 新描述允许 100%、layoutWeight、父容器自适应。当前父容器不看，需扩展。 |
| OM-WEB-MUST-02 | 证据扫描 | `WebController.runJavaScript`、`javaScriptProxy`、断点变化回调 | 依赖 Web 内容是否需要 Native 断点 | 无需改模式 | 是 | 保持 case constraint。静态层提供 Web 组件、controller、同步调用、断点变量。 |
| OM-WEB-MUST-03 | 是-证据 | Web 断点同步来源，fold/orientation 反模式 | 明确反模式可失败；未发现同步不能总失败 | 需要 | 条件需要 | 新规则是“同步方式”而非“必须同步”。没有同步逻辑时应结合 OM-WEB-MUST-02 适用性转 agent。 |
| OM-WEB-MUST-04 | 是 | 可见 Web 资源 CSS `@media width` | 可直接判定读取到的资源 | 需要 | 条件需要 | 新描述强调“ETS 中能定位并读取 Web 资源”。找不到资源应 review/不涉及，不应通过。 |
| OM-WEB-MUST-05 | 是 | 可见 Web 资源 CSS 纵向断点 | 可直接判定读取到的资源 | 需要 | 条件需要 | 同上；`orientation`/height-width 可失败，`aspect-ratio` 可通过，资源不可见转 review。 |
| OM-LIST-SHOULD-01 | 证据扫描 | `List.space` 与断点表达式 | 不建议直接失败 | 需要 | 是 | 新描述允许固定间距有业务理由。静态层发现固定 space 时给建议证据，agent 判断业务理由/布局影响。 |
| OM-LIST-SHOULD-02 | 是-证据 | `List.lanes` 与 `divider` | 显式多列且 divider 非 undefined 可失败；其他 review | 需要 | 条件需要 | 未设置 divider 应通过；`lanes` 动态/方法时需 agent 判断是否多列。 |
| OM-WATERFLOW-SHOULD-01 | 是-证据 | `WaterFlow.columnsTemplate` 与 `layoutMode` | 动态列数明确且缺 SLIDING_WINDOW 可失败 | 需要 | 条件需要 | 先判断列数是否动态；列数固定则不涉及；动态封装无法解析则转 agent。 |
| OM-WATERFLOW-SHOULD-02 | 证据扫描 | WaterFlow/FlowItem 内容类型、`itemConstraintSize`、子项尺寸 | 不建议直接失败 | 已有人工复核，需增强证据 | 是 | 新描述需要图片/卡片类适用性。提取 FlowItem 根组件、Image/卡片、尺寸属性。 |
| OM-NAVIGATION-SHOULD-01 | 证据扫描 | `Navigation.mode` 是否 Split、`navBarWidth` | Split 明确且缺失可失败，无法确认转 agent | 需要 | 是 | 当前人工复核合理，但可增加 Split 明确场景的确定性。 |
| OM-GRIDROW-SHOULD-01 | 是 | `GridRow.gutter` | 可直接判是否显式配置；建议属性完整性可判 | 小改 | 否 | 新描述建议同时包含 `gutter.x/y`。当前 any gutter 即满足，需检查 x/y 或说明缺一项为建议风险。 |
| OM-GRIDCOL-SHOULD-01 | 证据扫描 | Grid 缩进布局、`GridCol.offset`、大屏留白 | 不可直接确定适用性 | 已有人工复核，需增强证据 | 是 | 静态层提取 offset、margin/padding、居中宽度限制、断点条件。 |
| OM-GRIDROW-SHOULD-02 | 是-证据 | `.constraintSize({ width/maxWidth })` 与断点条件、是否存在 GridRow/GridCol | 明确反模式可失败；存在栅格不能自动通过 | 需要 | 条件需要 | 当前只要工程存在 GridRow 就通过太宽。需判断同一布局区域是否用栅格承载居中。 |
| OM-FLEX-SHOULD-01 | 证据扫描 | `Flex.justifyContent`、同类子项、固定 margin/padding | 不建议直接失败 | 已有人工复核，需保留 | 是 | 等间距均分语义依赖 UI 意图。静态层只提取 Flex 子项数量、justifyContent、margin。 |
| OM-FLEX-SHOULD-02 | 证据扫描 | `Flex.wrap`、固定宽子项、横向滚动容器 | 不建议直接失败 | 已有人工复核，需保留 | 是 | 先修 YAML 字符串问题。静态层提取 fixed width 子项和 wrap/Scroll/List 横向证据。 |
| OM-ROWCOLUMN-SHOULD-01 | 证据扫描 | Row/Column/Flex 子项尺寸、`layoutWeight`、百分比宽高 | 不建议直接失败 | 已有人工复核，需保留 | 是 | 占比布局语义依赖兄弟关系。静态层提供布局树证据。 |
| OM-ROWCOLUMN-SHOULD-02 | 证据扫描 | `displayPriority`、断点条件显隐、`visibility/if` | 不建议直接失败 | 已有人工复核，需调整 | 是 | 新描述允许清晰断点显隐。静态层识别断点显隐作为通过候选证据而非失败。 |
| OM-ROWCOLUMN-SHOULD-03 | 是-证据 | `Blank`、固定空白 `Row/Column().width/height` | 明确固定空容器模拟空白可失败；仅有 Blank 可通过 | 需要 | 条件需要 | 当前只要出现 Blank 就全局通过太宽。需定位同一 Row/Column/Flex 内空白模式。 |
| OM-SCROLL-SHOULD-01 | 证据扫描 | 横向内容、`Scroll.scrollable(Horizontal)`、`List.listDirection(Axis.Horizontal)` | 不建议直接失败 | 已有人工复核，需增强证据 | 是 | 横向延伸语义依赖内容是否超宽。提取横向列表候选、固定宽子项、滚动容器。 |
| OM-ASPECTRATIO-SHOULD-01 | 证据扫描 | Image/Video/Canvas/Web/地图/卡片容器、固定宽高、自适应尺寸 | 不可直接确定视觉比例需求 | 无需改模式 | 是 | 保持 case constraint。静态层提供视觉组件和宽高/fit/constraintSize 证据。 |
| OM-ASPECTRATIO-SHOULD-02 | 证据扫描 | 已设置 `aspectRatio` 的组件、断点比例切换需求 | 不可直接确定是否需要不同断点比例 | 无需改模式 | 是 | 新描述明确很多统一比例内容不适用，必须 agent 判断内容类型和设计需求。 |
| OM-HOVER-SHOULD-01 | 证据扫描 | 自定义悬停态 rect.top/height 参与尺寸位置计算 | 不可直接确定完整布局质量 | 无需改模式 | 是 | 静态层可提取 rect 使用点，agent 判断上下半屏尺寸位置是否合理。 |
| OM-WEB-SHOULD-01 | 证据扫描 | 可见 Web CSS 布局属性单位 | 可对可见资源给局部确定性，但整体建议需 review | 无需改模式或新增 Web parser | 是 | 保持 case constraint，后续可加 CSS 轻量扫描作为 evidence，不直接全局失败。 |
| OM-WEB-SHOULD-02 | 证据扫描 | Web CSS Grid `grid-template-columns`、media query、auto-fit/auto-fill | 局部可确定，整体建议需 review | 无需改模式或新增 Web parser | 是 | 可见 CSS 中固定列数/递减列数作为证据；Web 轮播框架多样，交给 agent。 |
| OM-WEB-SHOULD-03 | 证据扫描 | Web 轮播实现、displayCount、indicator 显隐 | 不适合直接静态终判 | 无需改模式 | 是 | Web 侧框架差异大，静态层只识别常见 carousel/swiper 类名和配置。 |

## 实现优先级建议

### 第一优先级：避免误判失败

- 修复 YAML 非字符串问题，恢复规则包加载。
- 为 `arkui_static` 增加 `needs_agent_review` 或等价的 `未接入判定器/待人工复核` 分支，不把封装表达式直接转失败。
- 对 Tabs、SideBarContainer、Flex、Row/Column、Scroll、aspectRatio 等适用性依赖强的规则，默认转 agent。

### 第二优先级：收敛静态扫描边界

- 不在 `readObjectProperty`、`isResponsiveExpression` 或单条规则正则里继续做局部补丁。
- 保留现有解析器作为“定位组件和原始表达式”的索引层。
- 将无法稳定解析的表达式统一降级为 agent 复核证据。
- 如需提升解析能力，单独设计可替换的证据收集模块，并通过测试覆盖组件调用、链式属性、构造参数、父子范围、字符串/注释剔除等基础能力。

### 第三优先级：证据结构化给 rule agent

建议 rule agent 输入中每条 review 规则只保留必要字段：

- `rule_id`
- `file`
- `line`
- `subject`
- `evidence`
- `question`

示例：

```json
{
  "rule_id": "OM-TABS-MUST-02",
  "file": "features/home/src/main/ets/view/Home.ets",
  "line": 46,
  "subject": "Tabs",
  "evidence": "barPosition=this.isLargeScreen ? BarPosition.Start : BarPosition.End; vertical=this.isLargeScreen",
  "question": "判断该 Tabs 是否为页面级主导航，以及 lg/xl 是否切换到侧边导航。"
}
```

## 验收标准

- `cross-device-adaptation.yaml` 可通过现有 rule pack validator。
- 对 57 条规则均能归入 `deterministic`、`evidence_for_agent` 或 `not_supported`。
- 对包含 `isLargeScreen/isMediumScreen/getDisplayCount()/ResourceUtil` 的表达式，静态层不直接输出 `不满足`，除非能解析出明确违反序列。
- 对官方一多示例重新扫描时，Tabs、SideBarContainer、Swiper displayCount、GridRow columns、List lanes 等封装写法不再被直接误判为失败，而是进入二次判定。
- 确定性反模式仍保持命中：硬编码断点宽度、错误 GridRow breakpoints、Web CSS 错误媒体查询、未清理 foldStatusChange 监听、GridRow 缺 gutter 等。
