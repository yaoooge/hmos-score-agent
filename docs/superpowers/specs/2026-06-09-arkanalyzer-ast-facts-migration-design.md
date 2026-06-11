# ArkAnalyzer AST Facts 一次性迁移设计

## 背景

当前评分流程已经有三类静态规则能力：

- `arkui_static`：一多 ArkUI 组件与断点规则，主要依赖 `staticScanner.ts` 提取组件调用、链式属性和少量上下文。
- `arkts_static`：ArkTS 语言规则，依赖 `lightScanner.ts` 提取类、接口、变量、枚举、赋值等轻量 facts。
- `regex` / `arkui_extra` / `case_constraint_precheck`：补足文本模式、ArkUI 特例和 agent 前置证据。

这些实现可以跑通多数规则，但本质上仍是手写静态分析器：组件树、表达式、类型、方法、状态依赖和调用关系都要在本仓库内重复模拟。随着规则集扩大，继续加正则和局部 parser 会带来两个问题：

- 评分稳定性不足：同一语义在 helper、常量、状态字段或链式调用中稍有变化，就可能被判为未知或误判。
- 维护成本过高：ArkUI 组件规则、ArkTS 语言规则、性能规则分别维护自己的扫描逻辑，重复处理文件遍历、作用域、表达式和源码定位。

新获得的 ArkAnalyzer 工具已经能在示例工程中构建跨模块 Scene、解析类和方法、产出 ArkUI `@Component` ViewTree。`MultiShoppingPriceComparison` 样例工程的分析结果为 71 个文件、547 个类、1427 个方法、40 棵 ViewTree，耗时约 3.81s。它适合作为评分流程中的统一 AST/Scene 事实源。

本设计将当前手搓静态分析器一次性迁移为“基于 ArkAnalyzer facts 的规则判定”，让 evaluator 消费归一化 AST facts，而不是直接扫描源码字符串。

## 目标

- 在评分流程中新增 ArkAnalyzer 分析阶段，生成统一 `ArkFactsIndex`。
- 将 `arkui_static` 的组件扫描、属性提取、父子关系、ViewTree 上下文改为消费 ArkAnalyzer ViewTree facts。
- 将 `arkts_static` 的类、接口、枚举、变量、方法、继承和作用域 facts 改为消费 ArkAnalyzer Scene facts。
- 将现有 regex 规则中能由 AST 稳定表达的规则迁移到 `arkts_static` 或新的 AST-backed evaluator。
- 删除或停用当前重复的手写扫描器实现，保留的源码级工具只用于行号回填、片段截取和 ArkAnalyzer 输出缺口补偿。
- 保持现有规则 ID、YAML rule pack、`EvaluatedRule`、评分融合和报告 schema 不变。
- 一次性完成 evaluator 输入切换，避免长期双轨逻辑导致维护分裂。
- 在中间产物中落盘 ArkAnalyzer 原始摘要、归一化 facts 和每条规则 trace，方便人工复核。

## 非目标

- 不在本仓库内重新实现完整 ArkTS parser。
- 不改变评分业务语义、风险 taxonomy 或分数融合策略。
- 不把语义性强、需要业务意图判断的规则强行变成确定性失败。
- 不要求 ArkAnalyzer 直接输出本仓库规则所需的最终格式；本仓库通过 adapter 归一化。
- 不迁移 Web 资源内部 CSS/JS 解析能力；Web 资源规则仍由现有文件读取或后续专门解析器处理。
- 不把工具失败静默判为通过；工具不可用时规则返回可解释的 `未接入判定器` 或进入 agent-assisted 复核。

## 设计原则

- **Analyzer 是事实源，不是规则引擎。** ArkAnalyzer 只负责给出 AST/Scene/ViewTree facts，规则判断仍留在 hmos-score-agent。
- **Evaluator 只消费归一化 facts。** 不让规则直接依赖 ArkAnalyzer 原始 JSON 字段，避免工具输出变化污染评分逻辑。
- **一次切换，短期可回滚。** 代码层一次迁移到 facts 输入；发布层可通过环境变量关闭 ArkAnalyzer 分析阶段以应急，但不保留长期双写 evaluator。
- **未知优先复核。** 对表达式、调用链或语义意图无法证明的场景，返回 `未接入判定器` 或 agent evidence，不误报失败。
- **证据必须可解释。** 每个结论必须能给出文件、行号、组件/方法路径、原始片段和决策输入。

## 总体架构

新增 `src/rules/arkfacts/` 作为统一事实层。

```text
CaseInput
  -> collectEvidence
  -> ArkAnalyzerRunner
  -> ArkAnalyzerAdapter
  -> ArkFactsIndex
  -> rule evaluators
  -> EvaluatedRule[]
  -> score fusion / report
```

模块划分：

- `src/rules/arkfacts/runner.ts`
  通过项目 npm 依赖中的 ArkAnalyzer API 分析远端工程落地目录，读取原始 `scene-summary.json`，并做错误隔离。显式脚本路径只用于调试兼容。
- `src/rules/arkfacts/collector.ts`
  封装 ArkAnalyzer Scene/ViewTree API，生成 adapter 可消费的 scene summary。
- `src/rules/arkfacts/adapter.ts`
  将 ArkAnalyzer 原始 JSON 转为内部 `ArkFactsIndex`。
- `src/rules/arkfacts/types.ts`
  定义稳定 facts schema。
- `src/rules/arkfacts/cache.ts`
  按 `CollectedEvidence` 和工程路径缓存分析结果。
- `src/rules/arkfacts/debugWriter.ts`
  写入中间态 facts、trace、unresolved expressions。
- `src/rules/evaluators/arkui/astEvaluator.ts`
  替换当前 `arkui/staticEvaluator.ts` 内的字符串组件扫描依赖。
- `src/rules/evaluators/arkts/astEvaluator.ts`
  替换当前 `arkts/lightScanner.ts` facts 依赖。

`evaluationDispatcher.ts` 的 detector mode 可以保持不变：

- `arkui_static` 继续表示一多 ArkUI 静态规则。
- `arkts_static` 继续表示 ArkTS 静态规则。
- `arkui_extra` 的两个特例可以迁入 AST facts 后删除该 mode，或在同一轮迁移中改为转发到 `arkui_static`。
- `regex` 只保留无法通过 AST facts 表达、且确实需要文本模式的少数规则。

## ArkFactsIndex

内部 facts schema 必须小而稳定，只暴露确定性规则需要的信息。不要为了“将来可能给 agent 看”而提前保存语义角色、自然语言分类、完整调用读写图或大段源码。Agent 辅助判定需要的证据应从这些最小 facts 按规则临时组装，而不是进入基础事实模型。

```ts
export interface ArkFactsIndex {
  files: ArkSourceFileFact[];
  declarations: ArkDeclarationFact[];
  methods: ArkMethodFact[];
  viewTrees: ArkViewTreeFact[];
  components: ArkComponentFact[];
  diagnostics: ArkFactDiagnostic[];
}
```

### File / Class / Method Facts

```ts
export interface ArkSourceFileFact {
  relativePath: string;
  hasViewTree: boolean;
}

export interface ArkDeclarationFact {
  id: string;
  name: string;
  filePath: string;
  kind: "class" | "struct" | "interface" | "enum" | "namespace" | "unknown";
  line?: number;
  extendsNames: string[];
  implementsNames: string[];
  fields: ArkFieldFact[];
  enumMembers?: ArkEnumMemberFact[];
}

export interface ArkMethodFact {
  name: string;
  filePath: string;
  kind: "method" | "function" | "builder" | "lifecycle" | "unknown";
  line?: number;
  parameters: ArkParameterFact[];
  assignments: ArkAssignmentFact[];
}

export interface ArkFieldFact {
  name: string;
  line?: number;
  typeText?: string;
  initializer?: ArkExpressionFact;
  accessModifier?: "public" | "private" | "protected";
}

export interface ArkEnumMemberFact {
  name: string;
  line?: number;
  initializer?: ArkExpressionFact;
}

export interface ArkParameterFact {
  name: string;
  typeText?: string;
  optional: boolean;
}

export interface ArkAssignmentFact {
  target: string;
  line?: number;
  value?: ArkExpressionFact;
}
```

这些 facts 覆盖当前已迁移 `arkts_static` 规则所需的最小结构：名称冲突、继承关系、字段访问修饰符、枚举成员、参数和赋值。调用图、throw、循环热点、静态/readonly 标记等不进入基础 facts；后续若有确定性规则真正消费，再按规则需求新增窄字段。

### ViewTree / Component Facts

```ts
export interface ArkViewTreeFact {
  id: string;
  component: string;
  filePath: string;
  nodeCount: number;
}

export interface ArkComponentFact {
  id: string;
  viewTreeId: string;
  name: string;
  kind: "system" | "custom" | "builderParam" | "unknown";
  filePath: string;
  attributes: ArkAttributeFact[];
  stateRefs: string[];
  line?: number;
}

export interface ArkAttributeFact {
  name: string;
  expr?: ArkExpressionFact;
  line?: number;
  source: "constructor" | "modifier" | "synthetic" | "unknown";
}
```

`ArkComponentFact` 是 `arkui_static` 的主要输入，覆盖 `GridRow`、`GridCol`、`List`、`WaterFlow`、`Swiper`、`Tabs`、`SideBarContainer`、`Navigation`、`Flex`、`Row`、`Column`、`Scroll`、`FolderStack`、`FoldSplitContainer`、`Web` 等组件规则。

不在基础组件事实中保存 `semanticRole`、完整 snippet、父子 id 或 agent 分类字段。当前确定性规则只消费组件名、文件、属性和状态引用；页面级侧栏、主导航、视觉内容、交互控件等判断应由具体规则按需从 ViewTree summary 或源码证据临时组装，无法确定时返回复核证据。

### Expression Facts

ArkAnalyzer 输出中很多属性目前以 IR stmt 和 `uses` 表示。Adapter 需要将这些 uses 解析为可比较的表达式事实。表达式 facts 只保留规则判定需要的语义值，不保存完整 AST trivia、类型参数、注释或未消费的子树。

```ts
export type BreakpointKey = "sm" | "md" | "lg" | "xl";

export type ArkExpressionFact =
  | { kind: "literal"; value: string | number | boolean | null; unit?: string }
  | { kind: "enum"; name: string }
  | { kind: "resource"; name: string }
  | { kind: "object"; properties: Record<string, ArkExpressionFact> }
  | { kind: "array"; items: ArkExpressionFact[] }
  | { kind: "symbol"; name: string; resolved?: ArkExpressionFact }
  | { kind: "call"; callee: string; args: ArkExpressionFact[] }
  | { kind: "breakpointValue"; values: Partial<Record<BreakpointKey, ArkExpressionFact>> }
  | { kind: "unknown"; reason: string; raw?: string };
```

Adapter 需要支持：

- 字面量：`true`、`false`、数字、字符串、百分比、`vp`。
- 枚举：`BarPosition.Start`、`SideBarContainerType.Embed`、`WaterFlowLayoutMode.SLIDING_WINDOW`。
- 资源引用：`$r('app.float.xxx')` 或 ArkAnalyzer uses 中的 `'app.float.xxx'`。
- 简单数组和对象：`{ sm: 4, md: 8, lg: 12 }`、`['320vp', '600vp']`。
- 状态字段：`this.isLargeScreen`、`this.currentBreakpoint`。
- 常量：顶层 const、`static readonly`、常量类字段。
- helper 调用：无副作用 getter、同类方法、简单 `getValue(currentBreakpoint)`。

无法还原的表达式在基础 fact 中只保留 reason 和可选 raw；完整 stmt、uses 和源码片段只写入 `unresolved-expressions.json`，避免常规 facts 膨胀。

## ArkAnalyzer Runner

本工程必须在 `package.json/package-lock.json` 中声明 `arkanalyzer` 依赖。现网部署时通过 `npm install` 安装，不依赖开发机上的 `/private/tmp`、全局 npm 包或手工构建产物。

Runner 负责从评分 case 构建工具配置。

输入：

- `caseInput.generatedProjectPath`
- `CollectedEvidence.caseDir`
- SDK 路径配置：优先 `HMOS_ARKANALYZER_SDK_PATHS`，否则从 `HMOS_ARKANALYZER_SDK_HOME` 或 `OHOS_SDK_HOME` 推导 `openharmony/ets`、`hms/ets`。
- 忽略目录：`build`、`.hvigor`、`oh_modules`、`.preview`、`.test`，复用当前规则评估忽略策略。

输出目录：

```text
<caseDir>/intermediate/arkanalyzer/
  config.json
  scene-summary.json
  ark-facts.json
  diagnostics.json
  rule-traces.json
  unresolved-expressions.json
```

运行策略：

- 默认超时 30s，超时后记录 diagnostic 并让 AST-backed 规则进入 `未接入判定器`。
- 对同一个 case 只运行一次，所有 evaluator 共享 facts。
- 如果 `caseDir` 不存在，则只在内存中缓存，不落盘。
- 默认直接调用项目依赖中的 ArkAnalyzer API。`HMOS_ARKANALYZER_SCRIPT_PATH`/`HMOS_ARKANALYZER_HOME` 仅用于调试兼容外部脚本，不能作为现网必需配置。
- 测试中可注入 fixture JSON，避免依赖真实 SDK 或远端工程。

## 规则迁移方案

### ArkUI 一多规则

`cross-device-adaptation.yaml` 中 `mode: arkui_static` 的规则全部改为消费 `ArkComponentFact`。

第一层：纯属性规则，直接确定性判定。

- `OM-GRIDROW-MUST-01`: `GridRow.breakpoints.value` 是否包含 320/600/840/1440。
- `OM-GRIDROW-MUST-02`: `GridRow.columns` 断点序列是否非递减。
- `OM-GRID-MUST-01`: `Grid.columnsTemplate` 列数是否非递减。
- `OM-GRIDCOL-MUST-01`: 结合父 `GridRow.columns` 和 `GridCol.span` 判断占比变化。
- `OM-LIST-MUST-01`: `List.lanes` 是否非递减。
- `OM-WATERFLOW-MUST-01`: `WaterFlow.columnsTemplate` 是否非递减。
- `OM-SWIPER-MUST-01/02/03`: `displayCount`、`indicator`、`prevMargin/nextMargin` 联动。
- `OM-HOVER-MUST-03/05`: `FolderStack` 全屏和 `upperItems` id 对齐。
- `OM-WEB-MUST-01`: `Web` 容器 `width/height/layoutWeight/parent` 自适应证据。

第二层：属性加上下文规则，确定性判定或 agent evidence。

- `OM-SIDEBAR-MUST-01/02/03`: 使用父子树、页面根、子组件内容判断是否页面级侧栏；无法确认时复核。
- `OM-TABS-MUST-01/02/03`: 使用 `Tabs` 深度、`TabContent` 数量、页面根关系判断是否主导航；局部 Tabs 不强判。
- `OM-FLEX-MUST-01` 和 `OM-FLEX-SHOULD-*`: 使用子组件属性和父子关系提供候选；职责不明时复核。
- `OM-ROWCOLUMN-SHOULD-*`: 使用父子树、固定尺寸、`layoutWeight`、`displayPriority`、`Blank` 证据减少误判。
- `OM-ASPECTRATIO-*`: 使用 Image/Video/Canvas/Web 等视觉组件语义给出候选，不直接替代设计意图判断。

第三层：工程/调用规则，使用 method facts。

- `OM-BREAKPOINT-MUST-01/02/04/05/06`
- `OM-HOVER-MUST-07/08/09`
- `OM-WEB-MUST-03`

这些规则不在第一批基础 facts 中强行支持。后续若迁移，应按具体规则补充最小调用或生命周期 facts；无法证明调用用途为断点布局时，保守进入复核。

### ArkUI Extra 规则

`arkui-extra.yaml` 两条规则迁到 facts：

- `ARKUI-MUST-001`: route_map 指向页面的 ViewTree root 必须为 `NavDestination`。
- `ARKUI-FORBID-001`: 同一 `ArkComponentFact` 的 attributes 中不得出现多个 `bindSheet`。

迁移后可以删除 `arkui/extraEvaluator.ts`，或让它薄封装调用 AST facts，最终移除 `arkui_extra` mode。

### ArkTS Language 规则

`arkts-language.yaml` 中已有 `arkts_static` 的规则直接切换 facts：

- `ARKTS-MUST-001`: 名称冲突。
- `ARKTS-MUST-004`: class/interface 继承约束。
- `ARKTS-SHOULD-002`: ESObject 使用范围。
- `ARKTS-SHOULD-003`: class as value。
- `ARKTS-SHOULD-005` 到 `ARKTS-SHOULD-010`: 命名、boolean 命名、spacing、枚举限制等。
- `ARKTS-FORBID-010/016/022`: 类属性访问修饰符、对象字面量初始化类、相关 AST 结构规则。

当前 regex 但适合 AST 化的规则迁入 `arkts_static`：

- `ARKTS-MUST-002`: 一个类中只允许一个 static 初始化块。
- `ARKTS-MUST-006`: throw/catch 约束。
- `ARKTS-MUST-008`: 多变量定义和多赋值一行。
- `ARKTS-MUST-009`: NaN 比较。
- 所有能由 AST 表达的 `ARKTS-FORBID-*` 类型、对象、数组、函数参数、类成员规则。

仍保留 regex 的候选仅限纯格式或文本风格规则；如果 ArkAnalyzer 能提供 token/position，则也应迁出 regex。

### ArkTS Performance 规则

`arkts-performance.yaml` 迁移优先级：

- `ARKTS-PERF-SHOULD-001`: `let_never_reassigned` 用符号写入 facts 判断，替代当前按文件赋值名匹配。
- `ARKTS-PERF-SHOULD-002/003/004`: 只有在规则实现确实需要时，再新增变量赋值历史、binary expression 或 loop body 的窄 facts；不要提前把完整读写图放进基础模型。
- `ARKTS-PERF-SHOULD-005`: 闭包捕获，仅在 ArkAnalyzer 能提供闭包捕获或 lambda 作用域事实时给出候选；否则进入复核，不为该 should 规则扩展通用 reads 图。
- `ARKTS-PERF-SHOULD-006`: TypedArray 建议，用数组用途和 numeric element facts 提供候选。
- `ARKTS-PERF-FORBID-001/002/003/004/005`: 可选参数、联合类型数组、数组字面量混用、稀疏数组、循环内 throw 逐条迁到 AST facts；每条规则只增加自身需要的最小字段。

性能类 should 规则允许更多 `未接入判定器`，但 forbidden 规则应做到确定性强判。

## 删除和保留策略

迁移完成后删除或停用：

- `src/rules/evaluators/arkui/staticScanner.ts`
- `src/rules/evaluators/arkts/lightScanner.ts`
- `arkui/extraEvaluator.ts` 中重复源码扫描逻辑
- 可由 AST facts 覆盖的 regex detector 配置
- 对应的 scanner 单测，改为 facts/evaluator 单测

保留但重命名职责：

- 源码片段截取、行号回填、patch scope 过滤工具。
- `case_constraint_precheck`，但它的 evidence 应来自 `ArkFactsIndex`，不再自己粗扫源码。
- 文本规则 evaluator，只处理真正无法 AST 化的文本模式。

## Patch Scope 与全工程分析

ArkAnalyzer 应分析全工程，因为跨文件常量、helper、ViewTree 和类型关系依赖全局 Scene。

规则判定仍按现有 patch scope 控制：

- `allWorkspaceFiles` 用于构建完整 facts。
- `workspaceFiles` / `changedFiles` / `patchLineNumbers` 用于决定规则是否计入本次改动。
- 对工程级规则如 `module.json5 deviceTypes`、route_map、全局断点系统，允许使用全工程 facts 直接判定。
- 对组件实例规则，只将 changed file 或 changed line 附近的组件作为主要匹配；需要父子树或引用常量时，从 scene summary 或源码上下文按规则临时派生，不放入基础 fact。

## 错误处理

ArkAnalyzer 失败分三类：

- 工具不可用：所有 AST-backed static rules 返回 `未接入判定器`，conclusion 写明 ArkAnalyzer 未配置或不可执行。
- 解析失败：记录失败文件，成功文件仍可产出 facts；涉及失败文件的规则进入复核。
- 表达式无法还原：规则获得 component/method evidence，但返回 `未接入判定器` 或 agent-assisted evidence，不直接失败。

不允许因为工具失败返回 `满足`。

## Debug 与可观测性

每个 case 写入：

- `scene-summary.json`: ArkAnalyzer 原始输出，便于复现。
- `ark-facts.json`: 内部归一化 facts。
- `diagnostics.json`: 工具失败、解析缺口、position 缺失、表达式未知原因。
- `rule-traces.json`: 每条规则的输入组件/方法、判定值、结果和原因。
- `unresolved-expressions.json`: 未解析表达式列表。

需要特别跟踪 ArkAnalyzer 当前输出缺口：

- attribute `position` 在样例中序列化为 `[object Object]`，必须修复工具输出或在 adapter 中通过源码回查补行号。
- `uses` 能表达依赖，但不总能表达原始表达式，需要结合 stmt、源码片段和符号表还原。
- ViewTree 展开会把 routed builder 和自定义组件内联。基础 facts 只保留 `viewTreeId`；需要局部链判断的规则必须从 scene summary 或规则专属派生结构中计算，避免把跨组件节点误判为同一局部链。

## 测试策略

新增测试分层：

- `arkfacts-adapter.test.ts`: 使用 ArkAnalyzer fixture JSON 验证 facts schema、组件树、属性、类方法归一化。
- `arkfacts-position.test.ts`: 验证 position 缺失时的源码行号回填。
- `arkui-ast-evaluator.test.ts`: 覆盖 GridRow/List/Swiper/Tabs/SideBar/FolderStack/Web 等规则。
- `arkts-ast-evaluator.test.ts`: 覆盖现有 `arkts_static` 和迁移后的 regex 规则。
- `arkts-performance-ast.test.ts`: 覆盖 performance should/forbid 规则。
- `rule-engine-arkanalyzer-failure.test.ts`: 工具失败、超时、部分文件失败时结果可解释。
- `score-stability-arkanalyzer.test.ts`: 对同一 fixture 多次运行，验证 deterministic rule results 稳定。

回归要求：

- 现有 `arkui-static-evaluator.test.ts` 和 `arkts` 相关测试迁移到 AST fixtures 后仍覆盖原规则语义。
- 对至少一个真实样例工程运行 ArkAnalyzer fixture，验证 40+ ViewTree、大型 Navigation tree、跨模块组件不会导致规则超时。
- 结果 schema 不变化，`schema-validator` 继续通过。

## 迁移步骤

1. 引入 `arkfacts` 模块和 fixture-based adapter 测试。
2. 接入 ArkAnalyzer runner，支持真实工具运行和测试 fixture 注入。
3. 让 `collectEvidence` 或 rule evaluation context 能访问 `ArkFactsIndex`。
4. 将 `arkui_static` evaluator 改为消费 `ArkFactsIndex.components/viewTrees`。
5. 将 `arkui_extra` 两条规则迁到 AST facts，并移除重复扫描逻辑。
6. 将 `arkts_static` evaluator 改为消费 `ArkFactsIndex.declarations/methods`。
7. 将可 AST 化的 regex 规则迁移到 `arkts_static`，更新 YAML detector mode。
8. 将 `case_constraint_precheck` 的 evidence 来源替换为 `ArkFactsIndex`。
9. 删除旧 `staticScanner.ts`、`lightScanner.ts` 和相关重复测试。
10. 跑完整测试、真实样例评分和稳定性回归。

这是一轮一次性代码迁移，但实现 PR 可以按以上步骤组织提交。最终主干不保留旧扫描器和新 facts evaluator 的长期并行路径。

## 验收标准

- `arkui_static` 不再依赖 `staticScanner.ts` 的组件正则扫描。
- `arkts_static` 不再依赖 `lightScanner.ts` 的手写 ArkTS facts。
- `arkui_extra` 中的源码扫描逻辑被删除或并入 AST-backed evaluator。
- `references/rules/*.yaml` 中可 AST 化的 regex 规则已迁移 detector mode。
- 每条 AST-backed 规则都有 matched files、locations、snippets 或明确 unresolved reason。
- ArkAnalyzer 工具失败不会产生假阳性通过。
- 真实样例工程分析产物能落盘，ViewTree 和 rule trace 可人工复核。
- 现有评分输出 schema 不变，核心测试和新增 AST facts 测试通过。
- 执行npm run dev:api并构造远端用例完成e2e验证

## 风险与应对

- ArkAnalyzer 输出字段变化：通过 adapter 隔离，测试只锁定内部 `ArkFactsIndex`。
- 行号缺失影响报告：优先修复工具 position 序列化；短期用源码回查补定位。
- 全工程分析增加耗时：按 case 缓存 facts，只运行一次；超时进入可解释复核。
- ViewTree 内联导致上下文误判：规则必须使用 parent/viewTree/owner 三元上下文，不只看组件名。
- AST facts 无法还原复杂业务 helper：不强判，写入 unresolved expressions，让 agent 复核。

## 后续计划

本 spec 通过后，下一步编写 implementation plan，按“facts 层、ArkUI evaluator、ArkTS evaluator、regex 迁移、旧扫描器删除、回归验证”拆成可执行任务。
