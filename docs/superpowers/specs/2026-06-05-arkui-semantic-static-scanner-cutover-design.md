# ArkUI 语义静态扫描器一次性切换设计

## 背景

`taskId=1111` 的本地结果暴露了当前静态规则的结构性问题：一多规则需要判断 ArkUI 表达式在 `sm/md/lg/xl` 下的语义值，但现有扫描器只提供“组件名、链式属性名、属性参数字符串”。因此很多实际合规的代码被误判为固定值或递减值，例如：

- `this.isLargeScreen ? 3 : 2` 被当成非断点表达式。
- `this.getDisplayCount()` 被当成不可解析固定 helper。
- `SideBarContainer(this.isLargeScreen ? Embed : Overlay)` 的构造参数没有映射到 `type`。
- `Tabs`、`GridRow/GridCol`、`Swiper` 等规则依赖组件上下文，但当前 evaluator 只能在字符串层面做局部判断。
- `ARKTS-FORBID-006` 已可由编译校验覆盖，继续保留文本规则只会引入重复风险和误报。

继续在 `staticEvaluator.ts` 中加正则或特判会把问题扩散到更多边界。需要迁移到新的语义扫描模型，并一次性切换，不保留旧的 ArkUI 字符串判定路径。

## 目标

- 建立新的 ArkUI semantic scan index，作为 `arkui_static` 规则唯一输入。
- 对 ArkUI 组件、构造参数、链式属性、父子关系、所在组件/方法、行号和代码片段建立统一 IR。
- 把属性参数从裸字符串升级为表达式 IR，并支持断点域求值。
- 统一识别断点状态来源，不依赖固定变量名白名单。
- 支持纯 helper 内联，例如 `getDisplayCount()`、`getCategoryLanes()`、`getGridColHeight()` 等无副作用、无参数或简单参数 helper。
- 将一多组件规则改成语义谓词：规则只基于断点值、适用性和组件上下文判定。
- 删除 `ARKTS-FORBID-006` 规则和相关单测，避免与编译校验重复。
- 输出仍使用现有 `EvaluatedRule`、`RuleAuditResult`、`result.json` schema，不改变报告/评分融合接口。

## 非目标

- 不设计 feature flag、兼容模式、双跑比对或运行时回退。实现完成后 `arkui_static` 直接切换到新扫描器。
- 不引入完整 ArkTS 编译器链路，也不依赖 DevEco/ArkTS 专有解析器。
- 不改变规则包 YAML 的 rule id、评分 profile 或 result schema。
- 不把无法证明违规的规则强行判为失败；语义不完整时优先 `不涉及` 或 `未接入判定器`。
- 不处理 Agent 规则的自然语言判断优化，本设计只覆盖确定性静态扫描。
- 不继续实现 `ARKTS-FORBID-006` 的文本或语义扫描；该规则由编译校验覆盖。

## 总体方案

新增 `arkui/semantic` 扫描模块，替代现有 `staticScanner.ts + staticEvaluator.ts` 中组件规则的字符串判定。

解析层可以按完整 parser 的分层方式设计：先得到可遍历的源码结构，再投影成规则所需的 ArkUI 语义事实。但对外 IR 不暴露完整 AST，也不把暂时不用的数据类型写入接口。所有模型字段必须服务于当前规则判定、调试定位或 helper/断点求值。

新的流水线：

```text
WorkspaceFile[]
  -> source parser model
  -> ArkUI component tree
  -> expression IR
  -> symbol and helper index
  -> breakpoint fact graph
  -> semantic rule predicates
  -> EvaluatedRule[]
```

实现上采用完整 parser 风格的边界管理，但只保留必要语义事实，而不是在 evaluator 内直接用正则判定。

## 模块划分

### 1. Source Parser Model

文件：`src/rules/evaluators/arkui/semantic/sourceModel.ts`

职责：

- 保留原始源码、去注释/字符串后的结构源码、行列映射。
- 提供 parser 基础能力：查找匹配的 `()[]{}`，支持字符串、模板字符串、注释跳过。
- 提供当前规则需要的 token-level 工具：读取标识符、成员表达式、顶层参数切分、顶层对象属性切分。
- 不产出完整语言 AST，不暴露函数体语句、类型声明、import graph 等当前 ArkUI 规则不使用的数据。

关键接口：

```ts
export interface SourceModel {
  filePath: string;
  original: string;
  structural: string;
  lineAt(index: number): number;
  sliceOriginal(start: number, end: number): string;
}
```

### 2. ArkUI Component Model

文件：`src/rules/evaluators/arkui/semantic/componentModel.ts`

职责：

- 解析 ArkUI DSL 组件调用。
- 建立组件实例、构造参数、链式属性、children 范围、父子关系。
- 识别组件所在 `struct`、`@Builder` 方法、普通方法。
- 为构造参数建立 property alias，例如：
  - `SideBarContainer(arg0)` -> `type`
  - `GridRow({ columns, gutter, breakpoints })` -> 对象属性
  - `GridCol({ span, offset })` -> 对象属性
  - `List({ space, lanes, divider })` -> 对象属性
  - `Swiper()` + `.displayCount(...)` -> 链式属性

关键接口：

```ts
export interface ArkuiSemanticIndex {
  files: SemanticFile[];
  components: SemanticComponent[];
  symbols: SymbolIndex;
  breakpoints: BreakpointFacts;
}

export interface SemanticComponent {
  id: string;
  component: string;
  filePath: string;
  line: number;
  range: SourceRange;
  childrenRange?: SourceRange;
  parentId?: string;
  childIds: string[];
  owner: ComponentOwner;
  constructorArgs: ExprNode[];
  properties: SemanticProperty[];
  syntheticProperties: SemanticProperty[];
}

export interface SemanticProperty {
  name: string;
  source: "constructor" | "chain" | "synthetic";
  line: number;
  range: SourceRange;
  expr: ExprNode;
  rawText: string;
}
```

字段约束：

- `SemanticFile` 只保留 `filePath`、`componentCount` 和必要的 unsupported expression 摘要。
- `ComponentOwner` 只保留 owner kind 与 name，例如 `struct Index`、`builder itemBuilder`、`method build`。
- `SemanticComponent` 不保存完整源码副本；需要展示时通过 `filePath + range` 从 `SourceModel` 切片。
- `SemanticProperty` 不保存类型信息、decorator、import 信息等当前规则不用的数据。

### 3. Expression IR

文件：`src/rules/evaluators/arkui/semantic/expressionModel.ts`

职责：

- 将属性参数和 helper return expression 解析为轻量表达式树。
- parser 可按完整表达式优先级实现，但节点类型只保留规则求值需要的信息。

支持节点：

```ts
type ExprNode =
  | LiteralExpr
  | IdentifierExpr
  | MemberExpr
  | CallExpr
  | NewExpr
  | ConditionalExpr
  | BinaryExpr
  | ObjectExpr
  | ArrayExpr
  | UnaryExpr
  | UnknownExpr;
```

节点字段约束：

- 所有节点只保留 `kind`、`range`、`rawText` 和求值必需字段。
- literal 只保留可比较值；无需保留 token 原始类型以外的语法细节。
- call 只保留 callee、arguments、是否可内联 helper 的后续事实，不保留 type arguments。
- object/array 只保留顶层 entries/items；不保存未使用的 trivia、comments、decorators。
- `UnknownExpr` 必须保留 raw text、range、reason，用于 debug artifact 和 `未接入判定器` 决策。

必须支持：

- 字符串、数字、布尔、资源引用 `$r(...)`。
- 成员引用 `CommonConstants.WIDTH_LG`、`SideBarContainerType.Embed`。
- 三元表达式。
- `===`、`!==`、`>=`、`<=`、`>`、`<`。
- object literal `{ sm: 4, md: 8 }`。
- array/member index `ClassifyConstants.SWIPER_DISPLAY_COUNT[2]`。
- simple call `this.getDisplayCount()`。
- `new BreakpointType(a, b, c).getValue(x)`。

不支持表达式必须保留为 `UnknownExpr`，并带 raw text 与行号。

### 4. Symbol And Helper Index

文件：`src/rules/evaluators/arkui/semantic/symbolIndex.ts`

职责：

- 收集常量、静态只读常量、顶层 const、组件内字段、`@StorageProp/@StorageLink/@State`。
- 收集同一 `struct` 内 helper 方法。
- 判断 helper 是否可安全内联。

helper 可内联条件：

- 同一 `struct` 内调用，形式为 `this.method()` 或无歧义 `method()`。
- 方法无参数，或参数来自当前表达式可替换。
- 方法体只包含：
  - `return expr`
  - `if (condition) return expr; ... return expr`
  - 不包含赋值、事件注册、异步、循环、对象修改、副作用调用。
- 返回表达式可解析为 `ExprNode`。

不能内联时，保留 call expr；如果 call name 已被判定为断点 helper，可给出 `responsive-but-unknown-values` 事实，但不能直接判为失败。

### 5. Breakpoint Fact Graph

文件：`src/rules/evaluators/arkui/semantic/breakpointFacts.ts`

职责：

- 从 AppStorage 写入、StorageProp 消费、常量定义和比较表达式中推导断点语义。
- 不以变量名白名单作为唯一依据。

断点域：

```ts
export type BreakpointKey = "sm" | "md" | "lg" | "xl";

export interface BreakpointValue<T = SemanticValue> {
  values: Partial<Record<BreakpointKey, T>>;
  unknown: boolean;
  responsive: boolean;
  reasons: string[];
}
```

断点来源识别：

- `AppStorage.setOrCreate('currentBreakpoint', breakpoint)`。
- `@StorageProp('currentBreakpoint') currentBreakpoint`。
- `@StorageProp('isLargeScreen')`、`@StorageProp('isMediumScreen')` 等布尔派生状态。
- helper 中的阈值判断：`widthVp >= BREAKPOINT_LG`。
- 常量值：`WIDTH_SM='sm'`、`WIDTH_MD='md'`、`WIDTH_LG='lg'`、`WIDTH_XL='xl'`。
- 表达式中对 `sm/md/lg/xl` 或等价常量的比较。

布尔派生状态示例：

```ts
isMediumScreen = breakpoint !== WIDTH_SM
// => sm=false, md=true, lg=true, xl=true

isLargeScreen = breakpoint === WIDTH_LG || breakpoint === WIDTH_XL
// => sm=false, md=false, lg=true, xl=true
```

### 6. Semantic Evaluator

文件：`src/rules/evaluators/arkui/semantic/semanticEvaluator.ts`

职责：

- 替代组件类 `ArkuiRuleSpec` 的字符串 evaluator。
- 每条规则通过语义谓词执行。
- 输出 `EvaluatedRule`，包含 `matchedFiles`、`matchedLocations`、`matchedSnippets` 和结构化 `preliminaryData`。

规则结果原则：

- 确认违规：`不满足`。
- 确认适用且满足：`满足`。
- 场景不适用：`不涉及`。
- 场景适用但关键表达式无法求值，且不能证明违规：`未接入判定器`，交给 Agent。

## 规则迁移标准

### breakpoint_aware

原规则：

```text
属性是否按断点动态设置
```

新判定：

- 取属性的 `BreakpointValue`。
- 若存在至少两个断点值不同，判满足。
- 若所有可知断点值相同，且表达式不依赖断点，判不满足。
- 若表达式依赖断点但值不可展开，判满足或未接入：
  - 只要求“动态设置”的规则，判满足。
  - 要求具体值映射的规则，判未接入。

### non_decreasing

新判定：

- 可得到数值断点序列时，按 `sm <= md <= lg <= xl` 判定。
- 缺少某些断点时，用已知顺序比较，不因缺省直接失败。
- 表达式明显响应式但数值不可展开时，判未接入。
- 固定数值是否满足由规则定义决定：
  - 对 `columns/displayCount/lanes`，固定值不是递减，但若规则要求按断点区分，则由对应规则另行检查。
  - 当前 `OM-SWIPER-MUST-01`、`OM-LIST-MUST-01` 只检查非递减，不把固定值作为递减失败。

### exists

新判定：

- 属性存在即满足。
- 构造参数 synthetic property 也算存在。
- 对 `GridRow gutter` 必须检查对象中同时有 `x` 和 `y`，不能只看 `gutter` 字段名。

### contains / contains_all

新判定：

- 枚举/member/literal 都转换成 comparable value。
- `breakpoints` 标准值可从数组或常量引用解析。

## 一多重点规则语义

### Tabs 主导航

适用性：

- 只检查页面级 Tabs。
- 判断依据包括：包含多个 `TabContent`；分支承载页面入口、`Navigation/NavDestination`、大型页面区域；或已显式使用断点属性控制 tabs。
- 局部详情页签、筛选页签、单页内部业务分组默认不适用。

判定：

- `vertical` 在大屏应与小屏不同。
- `barPosition` 在大屏应与小屏不同。
- `barWidth/barHeight` 至少一个维度按断点变化；若两者都固定则失败。

### SideBarContainer

适用性：

- 只要出现 `SideBarContainer` 即适用。

属性映射：

- 构造参数 0 映射为 `type`。
- `.sideBarWidth()`、`.minSideBarWidth()`、`.maxSideBarWidth()` 都作为 width 证据。
- `.showSideBar()` 单独检查，不能由 `type/width` 代替。

判定：

- `type` 必须在小屏和大屏间区分 Overlay/Embed。
- width 必须按断点变化。
- showSideBar 必须显式配置并按断点变化；缺失仍判不满足。

### Swiper

适用性：

- `displayCount` 可确定存在大于 1 的断点时，多元素相关规则适用。
- `displayCount` 固定为 1 时，多元素边距和 indicator 规则不适用。

判定：

- `displayCount` 数值序列非递减。
- 多元素时 `indicator(false)` 或 indicator 按断点变化均可。
- 多元素时 `prevMargin` 或 `nextMargin` 至少一侧存在即可。

### GridRow / GridCol

GridRow:

- `columns` 可解析为断点数值序列时检查非递减。
- `columns` 使用 `isMediumScreen/isLargeScreen` 三元表达式时必须求值。
- `gutter` 必须显式包含 x/y。

GridCol:

- 计算 `span/columns` 占比。
- 如果 GridRow columns 响应式且 GridCol span 固定，但实际占比变化，判满足。
- 全宽卡片或单列场景可判不涉及。
- 仅在适用且占比没有变化时判不满足。

### List

- `lanes` 求值后检查非递减。
- `space` 必须按断点变化；固定值判不满足。
- `divider` 仅在多 lanes 且显式配置 divider 时检查；未配置 divider 不判失败。

## ARKTS-FORBID-006 删除

该规则不再由文本规则或 ArkUI semantic scanner 实现，原因是对象类型 call signature 已由编译校验覆盖。继续保留独立文本规则会与编译校验重复，并造成 typed arrow callback 等误报。

删除范围：

- 从 `references/rules/arkts-language.yaml` 移除 `ARKTS-FORBID-006`。
- 从 `src/scoring/scoringEngine.ts`、`src/scoring/scoreFusion.ts` 的规则等级/融合配置中移除该 id。
- 删除 `tests/rule-engine.test.ts` 中只服务于 `ARKTS-FORBID-006` 的单测断言。
- 更新包含该 id 的聚合测试期望，确保规则注册表和评分融合不再出现该 id。

## 一次性切换策略

实现完成后：

- `runArkuiStaticRule` 对组件类规则直接调用 semantic evaluator。
- 删除旧 `ArkuiStaticScanIndex` 在组件类规则中的使用。
- 删除旧的 `hasBreakpointExpression/readObjectProperty/isInstanceSatisfied` 字符串判定链。
- 工程级文本规则可以保留在现有 evaluator，但需要统一使用新的 `SourceModel` 工具，不再各自维护 balanced scanner。
- 测试一次性更新为新语义结果。
- `ARKTS-FORBID-006` 直接删除，不迁移到 semantic evaluator。

不保留：

- feature flag
- legacy fallback
- 新旧结果对照输出
- “旧规则失败但新规则通过时保守失败”的兼容策略

## Debug Artifact

保留并升级 `intermediate/arkui-static-scan`：

- `semantic-index.json`
- `breakpoint-facts.json`
- `rule-traces.json`
- `unsupported-expressions.json`

每个 rule trace 必须包含：

- inspected components
- applicable components
- evaluated properties
- breakpoint values
- decision reason
- matched locations

这能让后续误报分析直接看到“为什么判定”。

## 测试策略

### 单元测试

新增测试文件：

- `tests/arkui-semantic-source-model.test.ts`
- `tests/arkui-semantic-expression.test.ts`
- `tests/arkui-semantic-breakpoints.test.ts`
- `tests/arkui-semantic-evaluator.test.ts`
- 更新 `tests/rule-engine.test.ts` 中与 `ARKTS-FORBID-006` 相关的断言。

覆盖：

- nested object/array/call/ternary 参数切分。
- `isLargeScreen/isMediumScreen/currentBreakpoint` 求值。
- helper 内联。
- `SideBarContainer` 构造参数映射。
- GridRow/GridCol 占比计算。
- Swiper displayCount 和 margin。
- Tabs 页面级适用性。
- `ARKTS-FORBID-006` 不再注册，且相关规则融合配置不再引用该 id。

### 回归样本

必须加入 fixture：

- `taskId=1111` 最小复现代码片段。
- `MultiShoppingPriceComparison-master` 当前扫描用例。
- `multi-travel-accommodation-master` 当前扫描用例。

验收目标：

- `taskId=1111` 中以下规则不再误报：
  - `OM-LIST-MUST-01`
  - `OM-SWIPER-MUST-01`
  - `OM-TABS-MUST-01/02/03`
  - `OM-SIDEBAR-MUST-02/03`
  - `OM-GRIDROW-MUST-02`
  - `OM-GRIDCOL-MUST-01`
- `taskId=1111` 中以下规则仍保留：
  - `OM-SIDEBAR-MUST-01`
  - `OM-LIST-SHOULD-01`
  - `OM-GRIDROW-SHOULD-01`
  - official linter findings
- 官网样例工程不出现明显新增误报。
- 所有 `不满足` 结论必须包含 `位置：path:line`。

### 全量测试

必须通过：

```bash
npm run build
node --import tsx --test tests/arkui-static-evaluator.test.ts tests/rule-engine.test.ts
npm test
```

如果沙箱阻止 `127.0.0.1` 监听，按现有流程在非沙箱环境重跑 `npm test`。

## 实施顺序

1. 建立 `SourceModel` 和 balanced scanning 工具。
2. 建立 expression IR parser。
3. 建立 symbol/helper index。
4. 建立 breakpoint fact graph。
5. 建立 semantic component model。
6. 迁移组件类 ArkUI 一多规则到 semantic evaluator。
7. 删除 `ARKTS-FORBID-006` 规则、评分配置引用和相关单测。
8. 删除旧组件类字符串判定路径。
9. 更新 debug artifacts。
10. 补齐回归 fixtures 和全量测试。

## 风险与约束

- parser 仍可能遇到完整语言边界，因此必须明确 `UnknownExpr` 行为：不能证明违规时不要判失败。
- 语义模型必须避免“为未来可能需要”而保存完整 AST 字段；新增字段需要能对应到当前规则、debug artifact 或 helper/断点求值。
- helper 内联必须保守，发现副作用或复杂控制流立即放弃。
- 一次性切换会集中影响大量一多规则，因此需要先补足语义层单测，再删除旧路径。
- 规则 YAML 不大改，但 rule spec 需要升级为语义谓词配置，避免继续用 `requirement` 字符串表达复杂规则。

## 验收标准

- 新 semantic evaluator 成为 ArkUI 组件规则唯一入口。
- 旧组件字符串判定函数被删除或不再被调用。
- `ARKTS-FORBID-006` 不再出现在注册规则、确定性结果、风险融合配置或相关单测中。
- `taskId=1111` 中 G1 must 违规数量不再由 helper/断点布尔误读放大。
- result.json 的规则风险项可通过 `位置：path:line` 定位。
- 全量测试通过。
