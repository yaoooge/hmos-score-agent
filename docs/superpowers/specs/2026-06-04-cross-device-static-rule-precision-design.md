# 一多静态规则精度优化设计

## 背景

对官网一多示例工程 `MultiShoppingPriceComparison-master` 运行 `cross-device-adaptation` 规则包后，静态结果中出现多类误报。读代码后可以将问题分为两类：

- 样例代码确实没有按当前规则显式建模，例如部分 `SideBarContainer` 和 `GridRow gutter`。
- 静态判定器没有准确理解 ArkUI 代码语义，例如构造参数对象解析被逗号截断、只按变量名识别断点表达式、局部 `Tabs` 被当成主导航、`foldStatusChange` 被统一当成自定义悬停态。

本设计只处理第二类问题：提升解析器与适用性过滤精度，并修订 `OM-SWIPER-MUST-03` 的规则语义。真实代码不规范的问题继续保留为规则命中。

## 目标

- 修复 ArkUI 构造参数对象读取，使 `List({ space: new BreakpointType(a, b, c).getValue(x) })`、`GridRow({ columns: new BreakpointType(a, b, c).getValue(x) })` 等表达式不被对象内逗号截断。
- 用表达式语义识别断点值，不依赖固定变量名白名单。
- 将常见断点值容器、简单三元表达式和常量数组引用解析为可比较的断点值。
- 为一多组件规则增加适用性过滤，避免把局部控件或非目标场景按全局布局规则判失败。
- 修订 `OM-SWIPER-MUST-03`：多元素展示时 `nextMargin` 或 `prevMargin` 至少配置一个即可；只有两者都缺失才失败。
- 保持现有规则引擎输出结构不变，减少误报但不降低真实违规命中能力。

## 非目标

- 不引入完整 ArkTS parser 或 TypeScript 编译器依赖。
- 不重写整个 `arkui_static` evaluator。
- 不改变 `RuleEngineOutput`、`StaticRuleAuditResult`、报告 schema 或评分融合逻辑。
- 不把 `SideBarContainer`、`GridRow gutter` 等真实实现问题降级。
- 不处理 agent 辅助规则的最终判断，只处理确定性静态规则。

## 问题拆解

### 构造参数解析过浅

当前 `readObjectProperty` 能读取简单对象字段，但在对象字段值不是 `{}`、`[]`、`()` 开头时，会遇到第一个逗号或右花括号就停止。这会误读以下表达式：

```ts
List({
  space: new BreakpointType(A[0], A[1], A[2]).getValue(layoutSize)
})
```

实际值应是完整 `new BreakpointType(...).getValue(...)`，但当前只截到 `new BreakpointType(A[0]`。这会导致表达式事实识别无法看到 `.getValue(...)` 和断点 selector。

### 断点表达式识别过度依赖变量名

当前断点识别主要依赖变量名正则。这样会产生两个问题：

- 变量名没有包含 `breakpoint` 字样时，即使表达式明显在与 `sm/md/lg/xl` 比较，也可能被当成固定值。
- 变量名包含 `breakpoint` 字样时，即使不是断点语义，也可能被误认为响应式表达式。

断点识别应基于表达式使用方式，而不是变量名本身。变量名只能作为低置信度提示，不应成为必须条件。

### 规则适用性过宽

部分规则的自然语言目标是特定场景，但静态实现只按组件名触发：

- `Tabs` 主导航规则命中了购物袋内部局部 tabs。
- 自定义悬停态规则命中了普通折叠/分屏状态处理。
- `Swiper` 多元素边距规则命中了 `displayCount(1)` 的详情页单图轮播。
- `List divider` 规则把缺省未设置 divider 与“多列时仍保留 divider”混为一谈。

这些场景应先判断是否适用，再进入满足/不满足判定。

## 推荐方案

### 方案 A：轻量解析器增强加规则过滤

继续使用现有轻量扫描器，但把“读取 ArkUI 构造参数字段”和“表达式事实识别”拆成更稳的工具函数。适用性过滤仍在 `arkui_static` evaluator 内完成。

优点：

- 改动小，符合当前架构。
- 不引入新依赖，风险可控。
- 可以通过现有样例和单元测试快速锁定误报。

缺点：

- 仍不是完整语法树，复杂表达式只能保守处理。

### 方案 B：引入 TypeScript/ArkTS AST 解析

使用编译器 AST 解析 `.ets`，从语法树读取组件、属性、构造参数和表达式。

优点：

- 长期表达能力更强。
- 可以减少字符串扫描的边界问题。

缺点：

- `.ets` 语法和 ArkUI builder 代码不一定能被标准 TypeScript parser 稳定解析。
- 引入依赖和适配成本较高，不适合当前只修误报的目标。

### 选择

采用方案 A。当前问题集中在少数解析和适用性边界，轻量增强足够解决；完整 AST 解析留作后续大规模规则引擎升级时再评估。

## 详细设计

### 1. ArkUI 构造参数字段读取

新增或改造对象字段读取工具，要求能按嵌套深度读取字段值：

```ts
readObjectPropertyValue(argumentText: string, propertyName: string): string | undefined
```

读取规则：

- 定位 `propertyName:` 后，从值起点开始扫描。
- 同时维护 `()`、`[]`、`{}`、字符串和模板字符串状态。
- 只有在三类括号深度均为 0 时，顶层 `,` 或对象字段结束 `}` 才终止当前字段。
- 支持字段值为函数调用、new 表达式、三元表达式、对象字面量、数组字面量和枚举引用。

示例：

```ts
readObjectPropertyValue(
  "{ space: new BreakpointType(A[0], A[1], A[2]).getValue(layoutSize), scroller: s }",
  "space",
)
// => "new BreakpointType(A[0], A[1], A[2]).getValue(layoutSize)"
```

### 2. 断点表达式事实识别

在现有 `hasBreakpointExpression` 基础上增加小型表达式事实函数：

```ts
interface ResponsiveExpressionFact {
  responsive: boolean;
  reason: string;
  byBreakpoint?: Partial<Record<"sm" | "md" | "lg" | "xl", string>>;
}
```

识别原则：

- 表达式中出现 `sm/md/lg/xl` 字面量、断点枚举、`BreakpointConstants.BREAKPOINT_*` 或等价常量时，相关标识符可被推断为断点变量。
- 标识符作为断点值容器的 selector 使用时可被推断为断点变量，例如 `valueByBreakpoint.getValue(selector)`、`new BreakpointType(a, b, c).getValue(selector)`。
- 三元表达式、`if` 条件或 `switch` 条件把同一个标识符与多个断点值比较时，该标识符可被推断为断点变量。
- 常量数组引用能被解析时参与事实计算，例如 `GRID_ROW_COLUMNS[5]`。
- 变量名包含 `breakpoint`、`bp` 等词只能提高置信度，不能作为唯一依据；换成任意名称，只要表达式结构满足上述条件，也必须识别。

对无法展开的表达式，仍可在命中断点变量或 `.getValue(...)` 时判定为 responsive；只有需要比较数值序列的规则才要求展开成具体值。

### 3. 非递减数值比较

`non_decreasing` 规则需要处理以下形态：

```ts
{ sm: 4, md: 8, lg: 12 }
new BreakpointType(3, 6, 8).getValue(layoutSize)
new BreakpointType(BreakpointConstants.GRID_ROW_COLUMNS[5], BreakpointConstants.GRID_ROW_COLUMNS[6], BreakpointConstants.GRID_ROW_COLUMNS[1]).getValue(layoutSize)
```

判定策略：

- 可解析为具体序列时，按 `sm -> md -> lg -> xl` 比较。
- 三参数 `BreakpointType(a, b, c)` 默认映射为 `sm=a, md=b, lg=c`。
- 常量数组引用能解析为数值时参与比较。
- 无法解析为具体数值但能确认是断点响应表达式时，不直接判失败，返回 `未接入判定器`，由现有 agent-assisted 路径复核。

本阶段优先修复确定性误报：例如 `3/6/8` 不应判为下降。

### 4. 适用性过滤

新增局部过滤函数，不改变 YAML 结构：

```ts
function isRuleApplicableToInstance(
  ruleCheck: string,
  instance: ArkuiComponentInstance,
  scanIndex: ArkuiStaticScanIndex,
): boolean
```

过滤规则：

#### Tabs 页面级导航规则

`tabs_vertical_by_breakpoint`、`tabs_bar_position_by_breakpoint`、`tabs_bar_size_by_breakpoint` 只对页面级导航适用。判定不能依赖文件名、组件名或具体业务组件名。

满足以下任一条件时视为适用：

- `Tabs` 位于页面或导航容器的顶层主体区域，且其多个 `TabContent` 分支承载互相独立的页面区域。
- `Tabs` 的 `TabContent` 分支包含导航目的地、页面根容器或独立业务入口，而不是同一页面内的局部列表、筛选或详情分组。
- 代码显式按断点设置 `vertical`、`barPosition`、`barWidth` 或 `barHeight`，说明该 `Tabs` 正在承担响应式导航职责。

以下场景默认不适用：

- 局部业务页签，例如详情区、筛选区、表单分组或单个页面内的分类列表。
- `Tabs` 的所有内容分支共享同一局部数据上下文，且没有页面级导航证据。

#### Hover 悬停态规则

`custom_hover_*` 规则只在自定义悬停态布局适用。仅出现 `foldStatusChange` 不足以触发。

满足以下任一条件时视为适用：

- 文件或组件中同时出现 `FOLD_STATUS_HALF_FOLDED` 与 `LANDSCAPE` / `LANDSCAPE_INVERTED`。
- 使用 `getCurrentFoldCreaseRegion`、`FolderStack`、`FoldSplitContainer`、`upperItems`。
- 折叠状态逻辑直接驱动布局区域尺寸、位置、显隐或上下半屏分配。

以下场景默认不适用：

- 仅在折叠或分屏时关闭页面、退出能力、同步状态。
- 只监听 `FOLD_STATUS_FOLDED`，不处理半折叠悬停态布局。

#### Swiper 多元素边距规则

`swiper_margins_for_multi_display` 只在 Swiper 可能出现多元素展示时适用。

不适用：

- `displayCount` 可确定为固定 `1`。
- 全屏页面切换类 Swiper，且没有多元素展示证据。

适用：

- `displayCount` 可确定存在 `>= 2` 的断点值。
- `displayCount` 是响应式表达式但无法确定是否始终为 1。

#### List divider 规则

`list_divider_by_lanes` 只在显式配置了 `divider` 且 `lanes` 可能 `>= 2` 时判定。

不适用或满足：

- 未设置 `divider`。缺省无分割线，不等同于多列时保留 divider。

失败：

- `lanes` 可能 `>= 2`，且 `divider` 固定为非 `undefined` / 非断点响应表达式。

### 5. `OM-SWIPER-MUST-03` 规则语义修订

当前规则描述要求多元素展示必须同时设置 `prevMargin` 和 `nextMargin`。这过于严格。

修订后语义：

> Swiper 多元素展示时应设置前后边距或至少一侧边距，以露出相邻内容并提示可横向滑动。`displayCount >= 2` 时，`prevMargin` 和 `nextMargin` 至少配置一个即可；若两者都缺失，判定失败。若 `displayCount` 固定为 1，规则不涉及。

对应静态判定：

- `displayCount` 固定为 1：`不涉及`。
- `displayCount` 可能 `>= 2`，`prevMargin` 或 `nextMargin` 任一存在且断点响应或固定合理值：`满足`。
- `displayCount` 可能 `>= 2`，两者都不存在：`不满足`。
- `displayCount` 无法解析，且 margin 也无法判断：返回 `未接入判定器`，由现有 agent-assisted 路径复核。

## 受影响规则

本阶段重点覆盖：

- `OM-SWIPER-MUST-02`
- `OM-SWIPER-MUST-03`
- `OM-TABS-MUST-01`
- `OM-TABS-MUST-02`
- `OM-TABS-MUST-03`
- `OM-GRIDROW-MUST-02`
- `OM-GRIDCOL-MUST-01`
- `OM-HOVER-MUST-07`
- `OM-HOVER-MUST-08`
- `OM-HOVER-MUST-09`
- `OM-LIST-SHOULD-01`
- `OM-LIST-SHOULD-02`

`OM-GRIDROW-SHOULD-01` 不纳入本次误报修复；未配置 `gutter` 的 GridRow 继续按当前规则判定。

## 测试策略

新增或扩展以下测试：

- `tests/arkui-static-scanner.test.ts`
  - 构造参数对象字段值包含嵌套逗号时能完整读取。
  - `aboutToDisappear(): void { display.off('foldStatusChange') }` 能被 cleanup 检查识别。

- `tests/arkui-static-evaluator.test.ts`
  - `new BreakpointType(A[0], A[1], A[2]).getValue(layoutSize)` 可被识别为响应式，且 `layoutSize` 不需要固定命名。
  - `new BreakpointType(3, 6, 8).getValue(layoutSize)` 对 `GridRow columns` 判为非递减。
  - 仅变量名包含 `breakpoint`，但没有断点比较、断点值容器或断点常量证据时，不应直接判为响应式。
  - `GridCol({ span: 1 })` 位于响应式 GridRow 中时不判失败。
  - 局部业务 tabs 不触发页面级 Tabs 规则失败。
  - 只有 `FOLD_STATUS_FOLDED` 的 fold listener 不触发自定义悬停态规则。
  - 未设置 `divider` 的多列 List 不触发 `list_divider_by_lanes` 失败。

- `tests/rule-engine.test.ts`
  - 使用一个小型 fixture 覆盖一多规则包误报收敛。

回归验证：

```bash
node --import tsx --test tests/arkui-static-scanner.test.ts tests/arkui-static-evaluator.test.ts tests/rule-engine.test.ts
npm run build
```

## 验收标准

- 以下通用误报场景不再判为 `不满足`：
  - 任意变量名作为断点 selector 的 `GridRow columns 3/6/8`。
  - 响应式 GridRow 下固定 `GridCol({ span: 1 })`，实际占比随 columns 变化。
  - 页面内局部业务 tabs。
  - 只处理折叠关闭、分屏退出或状态同步的非悬停态 `foldStatusChange`。
  - 带返回类型标注的生命周期清理函数，例如 `aboutToDisappear(): void`。
  - 未设置 `divider` 的多列 List。
  - 固定 `displayCount(1)` 的 Swiper 多元素边距规则。
- 以下真实或较可信问题仍保持命中：
  - `SideBarContainer` 未按断点显式控制。
  - 未配置 `GridRow gutter` 的 GridRow。
  - 多元素 Swiper 同时缺少 `prevMargin` 和 `nextMargin` 的场景。
- 现有输出 schema 和报告字段不变。
- 相关单元测试和 TypeScript 构建通过。

## 风险与缓解

- 风险：适用性过滤过强导致漏报。
  - 缓解：只对已确认误报类型加过滤；过滤条件写入单元测试，真实违规 fixture 保持命中。
- 风险：轻量表达式解析继续覆盖不了复杂 ArkTS。
  - 缓解：无法确定的复杂表达式不直接判失败，保留复核路径。
- 风险：规则描述与实现再次漂移。
  - 缓解：同步修改 YAML 规则文本和 evaluator 测试名，让测试表达规则语义。
