# 规则包 YAML 导出设计

## 1. 背景

当前仓库中的规则包以 TypeScript 运行时定义形式存在，核心来源包括：

- `src/rules/packs/arkts-language/*`
- `src/rules/packs/arkts-performance/*`
- `src/rules/engine/rulePackRegistry.ts`

这些规则已经可以被评分流程直接消费，但仓库中还没有对应的“规则集 YAML”导出产物。用户希望直接从 `rules/packs` 中已有的规则文件生成规则集 YAML，并将结果放到 `reference/` 目录下，以便后续查阅或作为规则集输入使用。

本次工作重点是保证导出结果与当前真实生效的运行时规则一致，而不是手写一份容易漂移的静态文档。

## 2. 目标

本次设计目标如下：

1. 基于当前已注册的规则包，自动生成每个 pack 一个 YAML 文件。
2. 生成目录固定为仓库根目录下的 `reference/`。
3. 导出格式只保留用户明确需要的字段，不引入示例中不相关的说明性字段。
4. YAML 中的规则内容直接来源于当前运行时 `RegisteredRule` 定义，避免人工重复维护。
5. 导出过程可重复执行，在规则包更新后重新生成最新 YAML。

## 3. 非目标

本次明确不做以下事项：

- 不补齐示例中未明确要求的字段，例如 `usage`、`source_reference`、`category`、`severity`、`rationale`
- 不改变当前规则包注册方式
- 不修改评分流程对运行时规则的消费逻辑
- 不将 YAML 作为新的运行时单一来源替代 TypeScript 规则定义

## 4. 导出范围

当前导出范围仅覆盖已在 `rulePackRegistry` 中注册的规则包：

- `arkts-language`
- `arkts-performance`

后续如果新增规则包，只要完成注册并补充导出元数据，即可自动进入导出结果。

## 5. 输出结构

### 5.1 文件位置与命名

每个 pack 生成一个文件，命名直接使用 `packId`：

- `reference/arkts-language.yaml`
- `reference/arkts-performance.yaml`

### 5.2 YAML 顶层字段

每个 YAML 文件只保留以下顶层字段：

- `name`
- `version`
- `summary`
- `rule_pack_meta`
- `must_rules`
- `should_rules`
- `forbidden_patterns`

其中 `rule_pack_meta` 只保留以下字段：

- `pack_id`
- `source_name`
- `source_version`

### 5.3 规则项字段

每条规则只保留以下字段：

- `id`
- `rule`
- `detector_kind`
- `detector_config`
- `fallback_policy`

字段映射如下：

- `id` <- `RegisteredRule.rule_id`
- `rule` <- `RegisteredRule.summary`
- `detector_kind` <- `RegisteredRule.detector_kind`
- `detector_config` <- `RegisteredRule.detector_config`
- `fallback_policy` <- `RegisteredRule.fallback_policy`

### 5.4 分组映射

运行时规则来源与 YAML 字段的映射固定如下：

- `must_rule` -> `must_rules`
- `should_rule` -> `should_rules`
- `forbidden_pattern` -> `forbidden_patterns`

## 6. 生成方式

### 6.1 数据来源

导出脚本不直接扫描文件文本，而是复用当前运行时注册结果：

1. 调用 `getRegisteredRulePacks()` 获取当前全部已注册 pack
2. 读取一份新增的 pack 级导出元数据映射
3. 将 pack 和 rules 映射为目标 YAML 结构
4. 序列化后写入 `reference/`

这样可以确保导出内容与当前真实生效规则保持一致，避免“源码和导出文档不同步”的问题。

### 6.2 额外元数据

由于当前 `RegisteredRulePack` 只包含：

- `packId`
- `displayName`
- `rules`

且 `RegisteredRule` 不包含 `version`、`source_name`、`source_version`，因此需要新增一份很小的导出元数据表，为每个 pack 提供：

- `name`
- `version`
- `summary`
- `rule_pack_meta.pack_id`
- `rule_pack_meta.source_name`
- `rule_pack_meta.source_version`

这份元数据只承担导出展示职责，不参与规则执行。

## 7. 测试策略

实现前先补测试，至少覆盖以下内容：

1. 导出脚本会生成 `reference/arkts-language.yaml` 和 `reference/arkts-performance.yaml`
2. 生成文件可被 YAML 正常解析
3. 顶层字段存在且结构正确
4. 三类规则分组数量与运行时 registry 保持一致
5. 抽样规则的 `id`、`rule`、`detector_kind`、`detector_config`、`fallback_policy` 映射正确

## 8. 实施边界

本次实现将新增一个独立导出工具脚本和对应测试，不会改动现有评分、规则判定和报告生成链路。生成完成后，`reference/` 中的 YAML 作为当前规则包的可读导出结果存在，后续需要刷新时重新执行导出脚本即可。
