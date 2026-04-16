# 规则集应用说明

本文件用于指导评审时，如何将 `arkts_internal_rules.yaml` 中的规则应用到 HarmonyOS / ArkTS / ArkUI 代码评分过程中。

## 适用范围

当前说明仅针对以下规则集：

- `must_rules`
- `should_rules`
- `forbidden_patterns`

评审时不要引用未出现在当前规则集中的规则，也不要沿用更旧版本中已经被删除或替换的规则编号。

## 规则层原则

最终得分不是“rubric 分 + 独立规则分”，而是：

> 基础 rubric 得分 + 规则层修正结果（受硬门槛与总分上限约束）

规则处理优先级：

1. 平台强约束（HarmonyOS NEXT / ArkTS / ArkUI）
2. `must_rules`
3. `forbidden_patterns`
4. `should_rules`

说明：
- `must_rules` 用于识别 ArkTS 语言约束、类型系统约束、模块系统约束，以及当前规则集中明确列为“要求”的编程规范是否满足。
- `forbidden_patterns` 用于标记高风险反模式，这些模式通常比一般建议项更适合直接进风险提示或人工复核。
- `should_rules` 用于提示当前规则集中的受限能力、迁移建议以及命名/格式/风格层面的可维护性问题。

## 三类规则怎么处理

### must_rules
处理原则：
- 明显违反时，至少降低相关评分项分数。
- 若违反项属于编译失败级、类型系统破坏级、平台约束直接冲突或高风险控制流错误，可进入硬门槛候选。
- 报告中应写出规则 ID、规则摘要、证据、影响项和处理结果。

当前规则集中的 `must_rules` 覆盖以下内容：
- 属性访问与索引约束
- Symbol / 受限标准库接口
- `#private`、`var`、`any` / `unknown`
- call signature / construct signature / intersection type / conditional type / infer / `this` type
- 构造函数字段声明、结构类型、对象字面量类型、数组字面量推断
- function expression / class expression
- implements / extends 关系限制
- 动态对象布局、类型断言、运算符限制
- 解构、`for..in`、逗号运算符限制
- throw / catch 类型约束
- 嵌套函数、独立 `this`、generator、spread 限制
- enum / namespace / declaration merging 限制
- `require` / UMD / ambient module / import assertions / `.ts/.js -> .ets` 反向依赖
- 禁止绕过类型检查
- 单行多个变量定义或赋值
- `Number.NaN` 判断必须使用 `Number.isNaN()`
- 明显可替换为数组方法的样板遍历代码

### should_rules
处理原则：
- 作为评分修正因素使用。
- 一般不直接触发硬门槛。
- 若集中出现，说明代码迁移质量、工程风格或 ArkTS 思维不稳定，应在“主要问题”中归纳。

当前规则集中的 `should_rules` 包含三大类：

1. **受限能力与迁移建议**
- 避免依赖全局作用域或 `globalThis`
- 仅在必要跨语言场景中受控使用 `ESObject`
- 不应将 `class` 当作普通对象值使用

2. **命名规范**
- 命名应清晰表达意图，避免单字母、非标准缩写和中文拼音
- 类名、枚举名、命名空间名采用 `UpperCamelCase`
- 变量名、方法名、参数名采用 `lowerCamelCase`
- 常量名、枚举值名使用全大写下划线风格
- 布尔命名建议使用 `is` / `has` / `can` / `should` 前缀，并避免否定式命名

3. **格式与风格规范**
- 空格缩进、避免 tab
- 行宽建议不超过 120 字符
- 条件和循环建议使用大括号
- `switch` 缩进、表达式换行、空格规则、单引号风格
- 对象字面量换行、`else/catch` 位置、大括号同一行
- 类属性显式访问修饰符
- 浮点数前后 0 不省略
- 数组类型使用 `T[]` 而不是 `Array<T>`

### forbidden_patterns
处理原则：
- 一旦命中，必须进入“规则违规标记”。
- 同时进入风险项评估；必要时进入人工复核。
- 不能只写“疑似不规范”，应明确说明命中的是哪一种高风险模式。

当前规则集中的 `forbidden_patterns` 覆盖以下内容：
- 弱类型逃逸：`any`、`unknown`、`@ts-ignore`、`@ts-nocheck`、关闭严格检查、`as any`
- 动态对象布局：动态增删属性、方法重绑定、`prototype` 赋值、`in`
- 动态属性访问：数字键、普通字符串键、索引签名、索引访问类型、未声明字段访问
- 不受支持类型特性：intersection / conditional / infer / `this` type / mapped type / structural typing
- 不受支持声明形式：function expression、class expression、嵌套函数声明、generator、独立 `this`、调用/构造签名类型
- 解构与动态语法：解构赋值、解构声明、解构参数、`for..in`、for 外逗号运算符、`with`
- 异常值滥用：抛出非 `Error` 值、在 catch 中依赖 `any` / `unknown`
- 模块系统违规：`require`、UMD、ambient module、模块通配符、import assertions、`.ts/.js` 反向依赖 `.ets`
- 枚举与命名空间滥用：混合类型枚举、运行时表达式初始化枚举、声明合并、命名空间运行时对象化
- 动态标准库接口：`eval`、`__proto__`、`__defineGetter__`、`Function.apply`、`Function.call`、`new.target`、`as const`
- 条件表达式赋值
- `finally` 非正常结束（`return` / `break` / `continue` / 抛出未处理异常）

## 报告中的写法要求

当发现规则命中时，报告中必须包含以下信息：

### 规则违规标记
- 规则来源：`platform` / `must_rule` / `should_rule` / `forbidden_pattern`
- 规则 ID：例如 `ARKTS-MUST-006`
- 规则摘要：直接使用或忠实转述当前规则集中的 `rule` / `pattern`
- 影响项：引用规则中已有的 `affects`
- 处理结果：降分 / 风险提示 / 硬门槛候选 / 人工复核
- 证据：文件路径、代码片段、diff 位置或明确结构事实

如果证据不足：
- 只能写“待人工复核”
- 不能把推测写成已确认违规

## 当前规则集下的高优先关注点

以下内容来自当前规则集本身，评审时可优先检查：

### 高优先 must 关注点
- `ARKTS-MUST-006`：仍使用 `any` / `unknown`
- `ARKTS-MUST-017`：运行时修改对象布局
- `ARKTS-MUST-021`：抛出非 `Error` 值，或 catch 参数继续写 `any` / `unknown`
- `ARKTS-MUST-025`：继续使用 `require`、UMD、ambient module、import assertions，或存在 `.ts/.js -> .ets` 反向依赖
- `ARKTS-MUST-026`：使用 `@ts-ignore`、`@ts-nocheck` 或其他方式绕过类型检查
- `ARKTS-MUST-027`：使用 ArkTS 明确限制的动态标准库接口
- `ARKTS-MUST-028`：多个变量定义或赋值写在一行
- `ARKTS-MUST-029`：使用 `== Number.NaN` / `!= Number.NaN`
- `ARKTS-MUST-030`：明显可改为 `forEach` / `map` / `filter` / `find` / `reduce` 的样板遍历

### 高优先 forbidden 关注点
- `ARKTS-FORBID-001`：弱类型逃逸
- `ARKTS-FORBID-002`：动态对象布局
- `ARKTS-FORBID-007`：异常值滥用
- `ARKTS-FORBID-008`：模块系统违规
- `ARKTS-FORBID-010`：动态标准库接口
- `ARKTS-FORBID-011`：条件表达式赋值
- `ARKTS-FORBID-012`：`finally` 非正常结束

## 硬门槛识别建议

### G1 高密度静态错误
关注：
- `must_rules` / `forbidden_patterns` 在类型系统、模块系统、对象布局方面密集命中
- 代码明显无法通过 ArkTS 编译或类型检查

若证据充分，应设置总分上限 69。

### G2 明显不符合 ArkTS 基本约束
关注：
- 大量 TS 动态能力被直接搬进 ArkTS
- 出现结构类型、动态对象、`require`、`@ts-ignore`、非 Error throw 等成体系违规

若证据充分，应设置总分上限 69。

### G3 严重工程风险
关注：
- 违反规则同时引出明显稳定性、异常传播、模块边界或运行时风险
- 如动态对象布局、异常值滥用、受限标准库接口、`finally` 非正常结束等

若成立，应设置总分上限 79。

### G4 Bug 修复任务中的误修或过修
仅在 `bug_fix` 场景关注：
- 为了“修复”而引入 `any`、忽略注释、动态属性访问、模块违规等新问题
- 改动与问题点不匹配，同时引入规则层高风险写法

若成立，应设置总分上限 59。

## 人工复核触发条件

满足任一条件时，应提示需要人工复核：

- 证据不足，无法确认是否真正命中规则
- `continuation` / `bug_fix` 缺少上下文，无法判断原工程约束
- 同时命中多条规则，但影响范围和主次关系不清晰
- 触发任意硬门槛候选
- 总分落在 68-71、78-81、88-91 临界带
- rubric 结论与规则层结论明显冲突

## 推荐写法

应写成：
- 证据是什么
- 命中了当前规则集中的哪条规则
- 这条规则影响哪个评分项
- 最终如何影响档位、风险和总分
