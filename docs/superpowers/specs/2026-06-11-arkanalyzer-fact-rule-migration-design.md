# ArkAnalyzer Fact Rule Migration Design

## Goal

将当前适合结构化判断的规则迁移到 ArkAnalyzer facts 判定或 facts 辅助判定，减少手写 ArkTS/ArkUI 静态扫描器的职责，同时保留配置、文本、Web 资源、布局意图类规则的必要非 facts 判定边界。

本方案基于：

- 原始 ArkAnalyzer 报告：`/private/tmp/multi-shopping-arkanalyzer-output/scene-summary.json`
- 当前规则覆盖矩阵：`docs/rules/arkanalyzer-rule-coverage-matrix.md`
- 当前 facts 接入实现：`src/rules/arkfacts/*`、`src/rules/evaluators/arkui/astFacts.ts`、`src/rules/evaluators/arkts/astFacts.ts`

## Principles

1. Facts 只承载和规则判定强相关的信息，不把原始 ArkAnalyzer 全量 IR 搬进评分流程。
2. 结构事实优先确定性判定；表达式不透明时输出 `未接入判定器` 并提供 Agent 复核证据，不静态误杀。
3. 原始手写 scanner 只保留不可由 ArkAnalyzer facts 稳定表达的边界：配置文件、源码文本模式、Web/CSS 资源、跨文件业务语义、布局意图。
4. 每迁移一类规则，必须同时删除或降级对应旧 scanner 逻辑，避免双轨长期漂移。
5. 规则结果必须保持 patch scope，只评价本次改动涉及的业务文件。

## Current Scene Summary Capability

原始报告已经稳定提供：

- 工程文件和类概要：文件、类名、方法名、`fieldCount`。
- ArkUI ViewTree：页面/组件树、组件名、父子层级、BuilderParam、自定义组件/系统组件区分。
- ArkUI 属性：属性名、部分 `uses` 值、属性调用 `stmt`、`create` 调用。
- 状态引用：`stateValues` 和 `stateValuesTransfer`。

原始报告当前不足：

- 类字段只有数量，没有字段名、类型、访问修饰符和 initializer。
- 类型继承、接口实现、变量声明、赋值流、enum 成员、对象字面量初始化不完整。
- 很多 ArkUI 属性 `uses` 为空，只能看出属性被调用，无法还原表达式值。
- ArkUI constructor args 混在 `create.stmt` 中，当前 compact facts 没有稳定拆出 `GridRow({ columns })`、`GridCol({ span })` 等参数。

## Target Fact Model

保留现有 `ArkFactsIndex` 总体形状，只做强相关最小增量。

### ArkUI Facts

`ArkComponentFact` 保持作为规则判定主入口，增强属性来源和组件关系：

```ts
interface ArkComponentFact {
  id: string;
  viewTreeId: string;
  name: string;
  kind: "system" | "custom" | "builderParam" | "unknown";
  filePath: string;
  line?: number;
  parentId?: string;
  childIds: string[];
  attributes: ArkAttributeFact[];
  stateRefs: string[];
}
```

`ArkAttributeFact` 增加最小定位和不透明表达式信息：

```ts
interface ArkAttributeFact {
  name: string;
  source: "constructor" | "modifier" | "create" | "synthetic" | "unknown";
  expr?: ArkExpressionFact;
  line?: number;
  stmt?: string;
  opaqueReason?: "empty_uses" | "multiple_uses" | "unresolved_temp" | "unsupported_ir";
}
```

只允许保留 `stmt` 的短文本，作为调试和 Agent 证据，不作为业务规则直接解析的长期接口。确定性规则必须依赖 `expr`、`source`、组件层级、属性名。

`ArkExpressionFact` 可增加两类强相关表达：

```ts
type ArkExpressionFact =
  | ExistingExpressionKinds
  | { kind: "opaque"; raw?: string; reason: string }
  | { kind: "arkuiObject"; properties: Record<string, ArkExpressionFact> };
```

`arkuiObject` 只用于组件 constructor/create 参数对象，例如 GridRow/GridCol/SideBarContainer/Tabs。

### ArkTS Facts

只为计划迁移的 ArkTS 规则补字段，不补泛用 AST：

```ts
interface ArkDeclarationFact {
  id: string;
  name: string;
  filePath: string;
  kind: "class" | "struct" | "interface" | "enum" | "namespace" | "typeAlias" | "unknown";
  line?: number;
  extendsNames: string[];
  implementsNames: string[];
  fields: ArkFieldFact[];
  enumMembers?: ArkEnumMemberFact[];
}

interface ArkNamedValueFact {
  name: string;
  filePath: string;
  line?: number;
  kind: "variable" | "function" | "method" | "parameter";
  typeText?: string;
  initializer?: ArkExpressionFact;
  scope: "topLevel" | "class" | "method" | "unknown";
}
```

第一阶段不要求实现 `ArkNamedValueFact`，除非推进 ArkTS 规则迁移。当前重点是 ArkUI。

## Rule Migration Buckets

### Bucket A: Facts-Only ArkUI Modifier Rules

这些规则适合转成 facts 主判定。旧的 `staticScanner.ts` 对应组件调用/链式属性解析可以删除或只作为测试 fixture fallback。

规则：

- `OM-LIST-MUST-01`
- `OM-WATERFLOW-MUST-01`
- `OM-SWIPER-MUST-01`
- `OM-SWIPER-MUST-02`
- `OM-SWIPER-MUST-03`
- `OM-GRID-MUST-01`
- `OM-SIDEBAR-MUST-01`
- `OM-SIDEBAR-MUST-02`
- `OM-TABS-MUST-01`
- `OM-TABS-MUST-02`
- `OM-TABS-MUST-03`
- `OM-LIST-SHOULD-01`
- `OM-LIST-SHOULD-02`
- `OM-WATERFLOW-SHOULD-01`
- `OM-GRIDROW-SHOULD-01`
- `OM-ROWCOLUMN-SHOULD-03`

判定策略：

- 由 `ArkFactsIndex.components` 生成 `ArkuiFactComponentIndex`。
- 属性存在和值可解释时，直接按现有 `ArkuiRuleSpec` 判定。
- 属性存在但 `expr.kind === "opaque"` 时，输出 `未接入判定器`，并附组件、属性名、`stmt` 短证据。
- 属性缺失时，根据规则适用性决定 `不涉及` 或 `不满足`，不回退文本扫描。

需要清理：

- 删除 `staticScanner.ts` 中 ArkUI 组件调用解析对这些规则的依赖。
- `runArkuiStaticRule` 不再调用 `buildArkuiStaticScanIndex` 作为默认路径。
- 测试 fixture 改为直接构造 `ArkFactsIndex`。

### Bucket B: Facts-Only ArkUI Constructor Rules After Field Addition

这些规则适合 facts 判定，但必须先补 constructor/create 参数对象。

规则：

- `OM-GRIDROW-MUST-01`
- `OM-GRIDROW-MUST-02`
- `OM-GRIDCOL-MUST-01`
- `OM-SIDEBAR-MUST-03`
- `OM-HOVER-MUST-05`

判定策略：

- `create` 调用参数转成 `source: "constructor"` 或 `source: "create"` 的 attributes。
- `GridRow({ columns, breakpoints })` 必须产生 `columns`、`breakpoints`。
- `GridCol({ span, offset })` 必须产生 `span`、`offset`。
- `SideBarContainer({ type })` 必须产生 `type`。
- `FolderStack({ upperItems })` 必须产生 `upperItems`，同时 child `id` modifier 必须可读。

需要清理：

- 删除旧 scanner 对 `argumentText` 的手写字符串拼接和组件参数解析。
- `ArkuiComponentInstance.argumentText` 逐步废弃，改为 facts 属性数组；保留兼容层只用于历史测试，不能再新增依赖。

### Bucket C: Facts-Assisted ArkUI Intent Rules

这些规则适合用 facts 提供候选和证据，但不适合 facts-only。

规则：

- `OM-FLEX-MUST-01`
- `OM-WATERFLOW-SHOULD-02`
- `OM-NAVIGATION-SHOULD-01`
- `OM-GRIDCOL-SHOULD-01`
- `OM-FLEX-SHOULD-01`
- `OM-FLEX-SHOULD-02`
- `OM-ROWCOLUMN-SHOULD-01`
- `OM-ROWCOLUMN-SHOULD-02`
- `OM-SCROLL-SHOULD-01`
- `ARKUI-MUST-001`

判定策略：

- facts 判定组件是否存在、相关属性是否存在、父子布局关系是否存在。
- 若组件不存在，直接 `不涉及`。
- 若组件存在但适用性依赖业务布局意图，输出 `未接入判定器`，并给 Agent 提供结构化证据：
  - 组件名
  - 文件路径
  - 相关属性
  - 父组件和直接子组件
  - 不透明属性 `stmt`
- `ARKUI-MUST-001` 额外需要 routerMap/profile 配置，facts 只判页面根是否为 `NavDestination`。

需要清理：

- 删除这些规则中通过源码片段猜布局意图的分支。
- Agent payload 改用 facts evidence，不再塞长源码片段作为主证据。

### Bucket D: Keep Legacy / Text / Config

这些规则不应强行 facts 化。

保留原因：

- 配置文件：`OM-CONFIG-MUST-01`
- 断点来源/监听时序文本模式：`OM-BREAKPOINT-MUST-02/04/05/06`
- Web/CSS 资源：`OM-WEB-MUST-03/04/05`、`OM-WEB-SHOULD-01/02/03`
- 自定义悬停态 API/监听：`OM-HOVER-MUST-07/08/09`
- case constraint 语义规则：`OM-BREAKPOINT-MUST-03`、`OM-HOVER-MUST-01/02/04/06`、`OM-ASPECTRATIO-SHOULD-01/02`、`OM-HOVER-SHOULD-01`
- ArkTS regex 规则：暂保留，除非后续 ArkTS facts 补齐变量、类型、enum、赋值流。

清理原则：

- 这些规则可以继续走现有 evaluator。
- 不再把它们标记为 ArkAnalyzer 迁移缺口。
- 只允许在 Agent evidence 中附 facts 摘要，不改变主判定方式。

## Implementation Architecture

### New ArkUI Facts Evaluator

新增：

- `src/rules/evaluators/arkui/factIndex.ts`
- `src/rules/evaluators/arkui/factEvaluator.ts`
- `src/rules/evaluators/arkui/factEvidence.ts`

职责：

- `factIndex.ts`：从 `ArkFactsIndex` 建立组件、属性、父子关系索引。
- `factEvaluator.ts`：实现 Bucket A/B 确定性规则和 Bucket C facts-assisted 规则。
- `factEvidence.ts`：生成 Agent 复核证据，限制长度和字段。

改造：

- `staticEvaluator.ts` 只保留调度：
  - facts 可用且 check 属于 Bucket A/B/C：走 fact evaluator。
  - check 属于 Bucket D：走 legacy evaluator。
  - facts 不可用：按环境策略选择 legacy fallback 或 `未接入判定器`。

### Legacy Evaluator Split

将现有 `staticEvaluator.ts` 拆出：

- `legacyTextChecks.ts`：配置/文本/Web/监听类规则。
- `legacyArkuiScannerFallback.ts`：仅测试和临时 fallback 使用，不作为新规则依赖。

最终目标：

- `staticScanner.ts` 不再是 ArkUI 规则主路径。
- `argumentText`、手写括号匹配、源码链式调用解析逐步删除。

### ArkAnalyzer Adapter Enhancement

修改：

- `src/rules/arkfacts/collector.ts`
- `src/rules/arkfacts/adapter.ts`
- `src/rules/arkfacts/types.ts`

新增能力：

1. 保留组件父子关系。
2. 将 `create` 调用参数转为 `source: "create"` 或 `source: "constructor"` attributes。
3. 对 empty uses 生成 `opaque`，不要生成空字符串。
4. 保留短 `stmt`，只用于 debug/Agent evidence。
5. 对 `uses` 中的资源、枚举、数字、字符串、布尔值、断点对象做结构化表达。

不做：

- 不保存完整 IR。
- 不保存完整源码。
- 不做跨文件数据流分析。

## Migration Phases

### Phase 1: Facts Evidence Infrastructure

目标：facts schema 支持规则判定需要的最小信息。

完成标准：

- `ArkComponentFact` 有 parent/children。
- `ArkAttributeFact` 有 `source`、`stmt`、`opaqueReason`。
- empty uses 不再变成空字符串。
- debug artifacts 能显示 constructor/create/modifier 属性。

测试：

- fixture 覆盖 modifier 字面值、resource、enum、empty uses、BuilderParam、父子关系。

### Phase 2: Bucket A Migration

目标：ArkUI modifier 规则不再依赖 hand-written static scanner。

完成标准：

- Bucket A 规则全部从 `ArkFactsIndex` 判定。
- 复杂表达式稳定转 Agent。
- 删除对应旧 scanner 判定路径。

测试：

- 每类 requirement 至少一组 facts fixture：
  - `breakpoint_aware`
  - `non_decreasing`
  - `exists`
  - `contains`
  - `contains_all`
  - opaque expression defer

### Phase 3: Bucket B Constructor Args

目标：解决 GridRow/GridCol/SideBarContainer/FolderStack 的 constructor 参数缺口。

完成标准：

- E2E 中 `GridRow({ columns, breakpoints })` 不再丢失。
- `GridCol({ span })` 不再误判默认 span。
- `SideBarContainer({ type })` 可判定。
- `FolderStack({ upperItems })` 可与 child `id` 对齐。

测试：

- 用当前失败过的 E2E 形态建立 fixture。
- `OM-GRIDROW-MUST-01`、`OM-GRIDROW-MUST-02`、`OM-GRIDCOL-MUST-01` 必须有 regression tests。

### Phase 4: Bucket C Facts-Assisted

目标：把 Agent 辅助规则的 evidence 从源码片段升级为 facts 结构。

完成标准：

- Agent payload 中有组件/属性/父子结构摘要。
- 不再为了布局意图规则扫描长源码片段。
- 组件不存在时确定性 `不涉及`。

测试：

- 验证 payload 不包含过长源码。
- 验证候选组件和属性完整。

### Phase 5: Cleanup and Guardrails

目标：清理旧扫描器职责，防止新规则继续走手搓静态分析。

完成标准：

- `staticScanner.ts` 只保留 legacy fallback 或删除。
- 新增 lint/test 约束：Bucket A/B 规则不得调用 legacy scanner。
- 覆盖矩阵更新为新的迁移状态。
- E2E 使用主干 `.env` 加 ArkAnalyzer 开关跑通。

## Risk Controls

- 默认不把 opaque 表达式判为失败，避免稳定性倒退。
- facts 不可用时行为由环境变量控制：
  - 本地开发可 fallback legacy。
  - 生产可先 fallback legacy，待 E2E 稳定后切为 facts-required。
- 所有 facts 判定保留 `preliminaryData`，方便 dashboard 和人工审查。
- 清理旧 scanner 分阶段做，不能一次删除所有 text/config 逻辑。

## Acceptance Criteria

1. Bucket A 规则全部 facts 主判定，旧 ArkUI 组件 scanner 不参与。
2. Bucket B 规则 constructor args 可解释，不再出现 GridRow/GridCol 参数丢失导致的误判。
3. Bucket C 规则输出 facts-assisted 证据，Agent payload 更短且结构化。
4. Bucket D 规则保留 legacy/text/config 判定，并在覆盖矩阵中明确不属于 facts 主迁移范围。
5. `npm test`、`npm run build`、远端任务 E2E 均通过。
6. 规则覆盖矩阵更新，能看出 facts-only、facts-assisted、legacy-retained 三类边界。

