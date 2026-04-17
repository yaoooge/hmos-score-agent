# ArkTS 高性能规则包设计

## 1. 背景

当前仓库已经有一个已注册的静态规则包 `arkts-language`，用于承载 ArkTS 语言适配与编程规范规则。用户希望参考现有规则包的目录命名和文件结构，将 PDF 文档《ArkTS高性能编程实践-学习ArkTS语言-基础入门 - 华为HarmonyOS开发者》转换成一个新的独立规则包，而不是继续并入 `arkts-language`。

本次设计只覆盖 PDF 中明确写出的性能建议，不额外引入 PDF 之外的 ArkTS 常识或延伸规则。目标是在现有规则引擎结构下，新增一套来源清晰、可注册、可测试的 ArkTS 性能规则包。

## 2. 目标

本轮设计目标如下：

1. 新增一个独立的规则包 `arkts-performance`。
2. 目录结构与现有 `arkts-language` 一致，保持 `must.ts`、`should.ts`、`forbidden.ts` 三文件组织方式。
3. 严格只采纳 PDF 中明确出现的性能建议，不做额外规则扩展。
4. 对可以稳定用文本特征识别的反模式，落成 `text_pattern` 规则。
5. 对需要更多语义分析或上下文判断的建议，落成 `not_implemented` 的 `pending` 规则。
6. 让新规则包接入现有注册与规则引擎测试链路，不破坏已有 `arkts-language` 包行为。

## 3. 非目标

本轮明确不做以下事项：

- 不引入 PDF 之外的性能规范或最佳实践
- 不为性能规则新增 AST 级分析器
- 不重构现有规则引擎执行流程
- 不修改最终评分结果 schema
- 不把本次性能规则并入 `arkts-language`
- 不追求所有 PDF 建议都在首版具备完全自动判定能力

## 4. 设计原则

### 4.1 规则来源必须可追溯

所有新增规则必须能在 PDF 原文中找到直接依据。首版不做“根据常识补全”，以避免规则来源边界变得模糊。

### 4.2 结构复用优先于新建特殊机制

新规则包沿用已有规则包组织方式与注册方式，避免为单个性能规则集引入额外的目录层级或专用加载逻辑。

### 4.3 可稳定识别优先

对于 PDF 中的建议，只要可以从代码示例或语法形态中提炼出稳定的文本模式，就优先落成 `text_pattern`。无法稳定识别时，宁可显式标记为 `pending`，也不引入高误报的伪检测规则。

### 4.4 规则语气尊重原始文档

由于 PDF 主要表达的是“建议”“推荐”“避免”等性能实践，而不是 ArkTS 语言硬性限制，因此新规则包应以 `should` 和 `forbidden` 为主，不为了凑齐三类文件而强行制造 `must` 规则。

## 5. 规则包设计

### 5.1 包标识与展示名

新增规则包定义如下：

- `packId`: `arkts-performance`
- `displayName`: `ArkTS 高性能编程实践`

### 5.2 目录结构

新增目录与文件：

```text
src/rules/packs/arkts-performance/
  must.ts
  should.ts
  forbidden.ts
```

文件结构与现有 `src/rules/packs/arkts-language` 保持一致，以降低维护成本并保持项目内部规则包形态统一。

### 5.3 文件职责

- `must.ts`
  首版保留为合法的空规则数组。原因是 PDF 内容不适合被解释为硬性必选约束。
- `should.ts`
  用于承载推荐型性能建议，以及当前无法稳定做文本检测、但 PDF 中明确提出的性能实践。
- `forbidden.ts`
  用于承载可直接从反例或坏味道中稳定识别的性能反模式。

## 6. 规则映射方案

### 6.1 `should.ts` 规则

建议首版包含以下规则：

1. `ARKTS-PERF-SHOULD-001`
   不变变量推荐使用 `const` 声明。
   形态：`pending`

2. `ARKTS-PERF-SHOULD-002`
   `number` 类型变量初始化后应避免整型与浮点型混用。
   形态：`text_pattern`

3. `ARKTS-PERF-SHOULD-003`
   数值计算应避免溢出到 `INT32` 范围外。
   形态：`pending`

4. `ARKTS-PERF-SHOULD-004`
   循环中应提取不变量，减少重复属性访问次数。
   形态：`pending`

5. `ARKTS-PERF-SHOULD-005`
   性能敏感场景中建议通过参数传递替代闭包捕获函数外变量。
   形态：`pending`

6. `ARKTS-PERF-SHOULD-006`
   涉及纯数值计算时推荐使用 `TypedArray`。
   形态：`pending`

### 6.2 `forbidden.ts` 规则

建议首版包含以下规则：

1. `ARKTS-PERF-FORBID-001`
   禁止使用可选参数 `?` 作为性能敏感函数参数形式。
   形态：`text_pattern`

2. `ARKTS-PERF-FORBID-002`
   禁止使用联合类型数组。
   形态：`text_pattern`

3. `ARKTS-PERF-FORBID-003`
   禁止在数值数组字面量中混用整型和浮点型。
   形态：`text_pattern`

4. `ARKTS-PERF-FORBID-004`
   禁止通过超大容量初始化或大跨度下标写入制造稀疏/退化数组。
   形态：`text_pattern`

5. `ARKTS-PERF-FORBID-005`
   禁止在循环等热点路径中直接抛出异常。
   形态：`text_pattern`

### 6.3 `must.ts` 规则

首版不新增 `must` 规则，文件中导出空数组即可：

- `arktsPerformanceMustRules: RegisteredRule[] = []`

这样既保持统一结构，又避免把建议型性能规则误标为硬性语言要求。

## 7. 检测器设计

### 7.1 文本规则

首版所有可自动判定的性能规则都使用现有 `text_pattern` 检测器，沿用当前工厂创建出的统一配置：

- `fileExtensions: [".ets"]`
- `fallback_policy: "agent_assisted"`

这保证新包只对 ArkTS 源文件生效，不会误扫 JSON、图片或其他资源文件。

### 7.2 Pending 规则

以下类型的建议首版不强行转成正则：

- 需要判断变量后续是否变化的 `const` 建议
- 需要理解循环体重复访问开销的常量提取建议
- 需要判断是否处于性能敏感场景的闭包建议
- 需要理解“纯数值计算上下文”的 `TypedArray` 建议
- 需要识别实际溢出风险的数值运算建议

这些规则统一通过 `createPendingRule` 接入，明确表示“已纳入规则包，但当前版本尚未提供稳定静态判定器”。

## 8. 基础设施改动

### 8.1 规则工厂改造

当前 [`src/rules/packs/shared/ruleFactories.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/packs/shared/ruleFactories.ts) 将 `pack_id` 固定写死为 `"arkts-language"`。如果直接复用，会导致新规则包中的规则仍被错误归属到旧包。

因此需要将工厂函数改为显式接收 `packId`：

- `createPendingRule(packId, ruleSource, ruleId, summary)`
- `createTextRule(packId, ruleSource, ruleId, summary, patterns)`

改造后：

- `arkts-language` 规则包调用时显式传入 `"arkts-language"`
- `arkts-performance` 规则包调用时显式传入 `"arkts-performance"`

这属于为支持多规则包所必需的基础设施修正，而不是无关重构。

### 8.2 规则包注册

需要修改 [`src/rules/engine/rulePackRegistry.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/engine/rulePackRegistry.ts)，新增 `arkts-performance` 相关导入与注册项。

目标注册结构如下：

```ts
{
  packId: "arkts-performance",
  displayName: "ArkTS 高性能编程实践",
  rules: [
    ...arktsPerformanceMustRules,
    ...arktsPerformanceShouldRules,
    ...arktsPerformanceForbiddenRules,
  ],
}
```

## 9. 测试设计

### 9.1 注册测试

需要更新 [`tests/rule-pack-registry.test.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-pack-registry.test.ts)，验证：

1. `arkts-performance` 已成功注册
2. 新规则包的 `packId` 和 `displayName` 正确
3. `must.ts`、`should.ts`、`forbidden.ts` 三个源文件存在
4. 至少抽样校验一条 `should` 规则和一条 `forbidden` 规则的：
   - `detector_kind`
   - `summary`
   - `detector_config.fileExtensions`
5. `listRegisteredRules()` 的总数随着新包增加而变化

测试应避免写成大而脆的全量快照，只断言关键计数与关键规则。

### 9.2 规则引擎测试

需要更新 [`tests/rule-engine.test.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts)，构造 `.ets` 样例，验证新规则包中的 `text_pattern` 规则能够实际命中。

建议至少覆盖：

- 可选参数函数，命中 `ARKTS-PERF-FORBID-001`
- 联合类型数组，命中 `ARKTS-PERF-FORBID-002`
- 数值数组混合整型和浮点，命中 `ARKTS-PERF-FORBID-003`

同时保留已有测试对于 `.ets` 文件范围和忽略路径行为的约束，不让新包扩大扫描面。

### 9.3 Pending 行为测试

无需为每条 `pending` 规则构造命中样例，但应确保：

- `pending` 规则能出现在注册结果中
- `detector_kind` 为 `not_implemented`
- 运行规则引擎时，这些规则能正确返回“未接入判定器”

## 10. 验收标准

完成标准如下：

1. 新增并注册独立规则包 `arkts-performance`
2. 规则内容严格只来自指定 PDF
3. 可稳定检测的反模式实现为 `text_pattern`
4. 无法稳定检测的建议实现为 `pending`
5. 现有 `arkts-language` 包行为保持不变
6. 注册测试与规则引擎测试通过

## 11. 实施顺序

建议实施顺序如下：

1. 改造规则工厂，支持显式传入 `packId`
2. 更新 `arkts-language` 调用，保持现有行为
3. 新增 `arkts-performance` 三个规则文件
4. 在 `rulePackRegistry.ts` 中注册新规则包
5. 更新注册测试
6. 更新规则引擎测试
7. 运行测试并确认回归安全
