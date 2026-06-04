# src/rules Clean Structure Design

## 背景

`src/rules` 目录同时承载规则引擎编排、证据收集、规则包加载、静态 evaluator、case 约束、官方 linter 适配和若干内部工具函数。当前实现可以工作，但文件职责偏宽，常量、类型、解析校验和业务判定逻辑分散在多个大文件中，后续新增规则时容易扩大耦合。

本次重构只调整代码组织、命名和注释，不改变任何运行效果、输出结构、规则启用顺序、错误语义或导出函数签名。

## 目标

- 按职责拆分 `src/rules` 子目录，让每个目录有明确边界。
- 将常量、类型定义、解析校验工具、路径策略、输出映射等非业务判定逻辑从大文件中拆出。
- 为复杂边界添加简洁中文注释，解释“负责什么”和“不负责什么”。
- 保留旧路径兼容导出，降低一次性迁移风险。
- 使用现有测试和构建作为行为锁，确保重构前后结果一致。

## 非目标

- 不修改规则判定逻辑。
- 不修改 `RuleEngineOutput`、`StaticRuleAuditResult`、`RuleAuditResult` 等输出结构。
- 不修改 YAML 规则包格式。
- 不修改官方 linter、hvigor 或 evaluator 的对外调用方式。
- 不新增运行时依赖。

## 推荐架构

```text
src/rules/
  index.ts
  core/
  evidence/
  registry/
  rule-pack/
  case-constraints/
  evaluators/
  official-linter/
  types/
```

### core

规则引擎主编排层。负责收集证据、选择启用规则包、分发 evaluator，并组装规则审计输出。该层不直接解析 YAML，不直接实现具体静态检查。

计划文件：

- `src/rules/core/ruleEngine.ts`
- `src/rules/core/evaluationDispatcher.ts`
- `src/rules/core/ruleEngineOutput.ts`
- `src/rules/core/assistedRuleMapper.ts`

### evidence

证据收集层。负责把 workspace、original 和 patch 归一化为规则引擎可消费的稳定视图。

计划文件：

- `src/rules/evidence/collectEvidence.ts`
- `src/rules/evidence/patchScope.ts`
- `src/rules/evidence/pathPolicy.ts`
- `src/rules/evidence/types.ts`

### registry 与 rule-pack

`registry` 负责已加载规则包的注册、启用和 runtime case rule 归一化。`rule-pack` 负责 YAML 文件排序、读取、解析和字段校验。

计划文件：

- `src/rules/registry/rulePackRegistry.ts`
- `src/rules/registry/runtimeRuleNormalizer.ts`
- `src/rules/registry/constants.ts`
- `src/rules/rule-pack/yamlLoader.ts`
- `src/rules/rule-pack/yamlParser.ts`
- `src/rules/rule-pack/schema.ts`
- `src/rules/rule-pack/validators.ts`

### case-constraints

case 约束加载层。负责 expected constraints YAML 的解析和 `CaseRuleDefinition` 映射。

计划文件：

- `src/rules/case-constraints/loader.ts`
- `src/rules/case-constraints/parser.ts`
- `src/rules/case-constraints/mapper.ts`
- `src/rules/case-constraints/types.ts`

### evaluators

静态规则判定层。继续按规则域拆分：text pattern、project structure、case constraint、ArkTS、ArkUI、ArkUI extra。大文件优先拆成“规则规格/扫描器/具体检查/通用读取工具/调试输出”。

第一阶段仅迁移低风险入口并保留兼容导出；后续再拆最大 evaluator 文件。

### official-linter

官方 linter 适配层。`officialCodeLinter` 旧目录保留兼容导出，新结构按 config、run、parse、map、hvigor 分类。

## 兼容策略

旧路径文件保留为 re-export，例如：

```ts
export { collectEvidence } from "./evidence/collectEvidence.js";
export type { CollectedEvidence, WorkspaceFile } from "./evidence/types.js";
```

兼容路径包括：

- `src/rules/ruleEngine.ts`
- `src/rules/evidenceCollector.ts`
- `src/rules/caseConstraintLoader.ts`
- `src/rules/engine/rulePackRegistry.ts`
- `src/rules/engine/rulePackYamlLoader.ts`
- `src/rules/engine/ruleTypes.ts`
- `src/rules/officialCodeLinter/*`
- 已被测试或业务直接引用的 evaluator 文件

## 注释规范

- 目录入口或模块边界使用中文注释说明职责。
- 复杂解析、路径过滤、输出映射前添加中文注释说明语义。
- 简单赋值、直接转发、显而易见的工具函数不加注释。
- 注释描述约束和意图，不复述代码。

## 验证策略

每个迁移阶段运行相关测试；全部迁移后运行：

```bash
npm test
npm run build
```

判断标准：

- 测试和构建通过。
- 旧 import 路径仍可使用。
- 规则包加载顺序不变。
- 规则引擎输出字段不变。
- 现有 evaluator 的判定文本和结果不变。
