# Hvigor 废弃 API 风险与 ArkUI Extra 规则集设计

Date: 2026-05-26

## Background

人工评级差异分析显示，当前自动评分对以下几类问题覆盖不足：

- 编译阶段已经能暴露废弃 API 使用，但评分报告没有把 patch 新增废弃 API 使用沉淀为风险项。
- 路由表页面缺少 `NavDestination`、实际跳转空白等 ArkUI 路由问题容易被静态路由文件存在性误判。
- 同一组件链上挂载多个 `bindSheet` 会导致只有最后一个 sheet 生效，核心交互不可用。

本设计先落地两个范围：

1. hvigor 编译 warning 中识别 patch 新增废弃 API 使用，生成中风险项并进入报告。
2. 构建默认启用的 `arkui-extra` 规则集，覆盖路由 `NavDestination` 和多 `bindSheet` 校验。

## Goals

- 当 hvigor build check 启用并实际运行时，从编译输出中解析废弃 API warning。
- 仅当 warning 指向 patch 新增行时，生成“新增代码使用废弃 API”的中风险项。
- 废弃 API 风险不触发硬门槛，不生成规则违规项，只作为 `risks` 进入最终报告。
- 新增 `references/rules/arkui-extra.yaml` 规则包，并默认对所有任务启用。
- 新增 ArkUI extra 确定性 evaluator，首批支持：
  - route map 页面根组件必须使用 `NavDestination`。
  - 同一组件链上不允许挂载多个 `bindSheet`。
- 保留并扩展 `references/rules/arkui-extra.md`，将它作为规则说明和人工/agent 审查参考。

## Non-Goals

- 不兼容不带行号的 deprecated warning；本轮只支持 hvigor 输出中的固定格式。
- 不解析所有编译 warning，只处理 `has been deprecated`。
- 不把废弃 API warning 作为 build failure 或 hard gate。
- 不做可视化功能测试、截图比对、像素级布局检测。
- 不在本轮实现运行冒烟。
- 不在本轮实现或文档化 `module.json5` 权限声明一致性检测。
- 不让 rubric agent 自由发现并新增 `arkui-extra` 规则；规则结果必须来自确定性 evaluator 或既有 rule-assessment 链路。

## Existing Constraints

- `officialCodeLinterNode` 已在 `ruleAuditNode` 后运行，能读取 `state.evidenceSummary.changedFiles` 和 `changedLineNumbersByFile`。
- `runHvigorBuildCheck` 已保留每个模块的 `stdoutExcerpt` 和 `stderrExcerpt`。
- `fuseRubricScoreWithRules` 当前会根据 hvigor build failure 生成高风险项和 `BUILD-CHECK` hard gate。
- 内置规则包已经从 `references/rules/*.yaml` 加载，默认启用规则包在 `src/rules/engine/rulePackRegistry.ts` 中配置。
- 现有 `DetectorKind` 仅包含 `text_pattern`、`project_structure`、`case_constraint`、`not_implemented`。
- 规则违规风险由 `scoreFusion` 根据 `RuleAuditResult` 统一生成。
- rubric agent 的 `risks` 会与规则违规风险做去重和 taxonomy 归一。

## Recommended Approach

采用“hvigor warning 后处理 + 新增确定性 ArkUI 规则集”的方案。

hvigor deprecated warning 不进入 `RuleAuditResult`，而是作为 build check 的附加诊断结果进入 `HvigorBuildCheckSummary`。评分融合阶段读取这些诊断，生成中风险项并附带证据。这样可以避免把 compiler warning 和规则包违规混在一起，也不会让废弃 API warning 触发 hard gate。

路由和 `bindSheet` 使用新的 `arkui-extra.yaml` 规则包表达，使用新的 `arkui_extra` evaluator 做确定性判定。它们是稳定、可复现、可回归测试的工程规则，不应只写进 rubric agent skill reference。

## Hvigor Deprecated API Detection

### Warning Format

只支持 hvigor 当前实际输出中的带行号格式。编译 `Test0526` 工程验证到的原始输出会带 ANSI 颜色码和 hvigor 外层 `WARN:` 包装，解析前应先去除 ANSI 控制字符。

去除 ANSI 后的 deprecated warning 形态为相邻两行：

```text
WARN: WARN: ArkTS:WARN File: /Users/guoyutong/DevecostudioProjects/Test0526/entry/src/main/ets/pages/Index.ets:9:18
 'showToast' has been deprecated.
```

解析字段：

- file：`/Users/guoyutong/DevecostudioProjects/Test0526/entry/src/main/ets/pages/Index.ets`
- line：`9`
- column：`18`
- apiName：`showToast`
- rawMessage：去除 ANSI 后的两行 warning 文本

建议正则：

```text
ArkTS:WARN\s+File:\s*(?<file>.+?):(?<line>\d+):(?<column>\d+)\s*\r?\n\s*'(?<apiName>[^']+)'\s+has been deprecated\.
```

解析时应对每个 module result 的 `stdoutExcerpt` 和 `stderrExcerpt` 分别去 ANSI 后整体扫描，而不是逐行扫描。

### Patch Attribution

只在以下条件全部满足时生成风险：

1. `HvigorBuildCheckSummary.enabled === true`
2. `buildCheckSource === "hvigor"`
3. 至少一个 module result 的 stdout/stderr 中匹配 deprecated warning
4. warning file 能从绝对路径归一化到 workspace 相对路径
5. warning line 命中 `evidenceSummary.changedLineNumbersByFile[file]`

如果 warning 文件不在 patch changed files 中，跳过。

如果 warning 行号不在新增行集合中，跳过。

不做 API 名称在 patch 文本中的 fallback 检索，因为当前 hvigor warning 一定带文件和行号。

路径归一化规则：

1. warning `file` 是绝对路径。
2. 如果路径位于 hvigor workspace 根目录下，先去掉 workspace 根目录前缀。
3. 如果路径位于当前构建模块目录下，归一化为从模块路径开始的 workspace 相对路径，例如：

```text
/Users/guoyutong/DevecostudioProjects/Test0526/entry/src/main/ets/pages/Index.ets
-> entry/src/main/ets/pages/Index.ets
```

4. 最终归一化结果必须能匹配 `evidenceSummary.changedLineNumbersByFile` 的 key，否则跳过该 warning。

### Data Model

扩展 `src/types.ts`：

```ts
export interface HvigorDeprecatedApiWarning {
  file: string;
  line: number;
  column: number;
  apiName: string;
  modulePath: string;
  moduleName: string;
  command: HvigorBuildCheckModuleResult["command"];
  message: string;
}

export interface HvigorBuildCheckSummary {
  // existing fields...
  deprecatedApiWarnings?: HvigorDeprecatedApiWarning[];
}
```

`deprecatedApiWarnings` 只保存 patch 归因后的 warning，不保存历史代码 warning。

### Risk Generation

在 `scoreFusion` 中新增构造逻辑：

- 所有废弃api使用聚合成一个风险。
- 风险等级：`medium`
- 风险标题：`新增代码使用废弃 API`
- evidence 最多列出 3 个 warning 位置，避免报告噪声。

扩展 taxonomy，避免废弃 API 和“指定 API 偏离”语义混在一起。

新增 `references/risks/risk-taxonomy.yaml` 条目：

```yaml
- code: DEPRECATED_API_USAGE
  level: medium
  title: 新增代码使用废弃 API
  description: 新增或修改代码使用了编译器标记为 deprecated 的 ArkTS/ArkUI API，后续版本可能移除或行为变化。
  primaryItem:
    dimension: 平台规范符合度
    item: HarmonyOS工程实践符合度
  matchHints:
    - deprecated
    - has been deprecated
    - 废弃 API
```

最终报告风险示例：

```json
{
  "level": "medium",
  "title": "新增代码使用废弃 API",
  "risk_code": "DEPRECATED_API_USAGE",
  "risk_category": "medium",
  "description": "新增代码使用了 1 处废弃 API，例如 entry/src/main/ets/pages/Index.ets:9 的 showToast，后续版本可能移除或行为变化。",
  "evidence": "hvigor warning: entry/src/main/ets/pages/Index.ets:9:18 'showToast' has been deprecated."
}
```

## ArkUI Extra Rule Pack

### Rule Pack File

新增：

```text
references/rules/arkui-extra.yaml
```

`rule_pack_meta.pack_id` 为 `arkui-extra`。

默认启用：

```ts
export const defaultEnabledRulePackIds = [
  "arkts-language",
  "arkts-performance",
  "arkui-extra",
] as const;
```

### Detector Kind

扩展 `DetectorKind`：

```ts
export type DetectorKind =
  | "text_pattern"
  | "project_structure"
  | "case_constraint"
  | "arkui_extra"
  | "not_implemented";
```

新增 evaluator：

```text
src/rules/evaluators/arkuiExtraEvaluator.ts
```

`detector_config.check` 支持：

- `route_navdestination`
- `multi_bindsheet_same_component`

### Rule: Route Map Page Must Use NavDestination

规则 ID：

```text
ARKUI-MUST-001
```

规则文本：

```text
组件包存在 routerMap 配置且 route_map.json 指向的子页面，页面根组件必须使用 NavDestination，否则路由跳转可能空白或页面栈异常。
```

YAML 草案：

```yaml
must_rules:
  - id: ARKUI-MUST-001
    rule: 组件包存在 routerMap 配置且 route_map.json 指向的子页面，页面根组件必须使用 NavDestination，否则路由跳转可能空白或页面栈异常。
    detector_kind: arkui_extra
    detector_config:
      check: route_navdestination
    fallback_policy: agent_assisted
    decision_criteria:
      pass:
        - route_map.json 指向的页面根组件使用 NavDestination。
      fail:
        - route_map.json 指向的页面未使用 NavDestination 作为根组件或 build 入口直接返回普通组件。
        - module.json5 配置了 routerMap，但对应 profile 文件缺失或不可读。
      not_applicable:
        - 当前模块没有 routerMap 配置，或 route_map.json 指向的页面不在本轮 patch 检查范围。
      review:
        - route map 或 buildFunction 无法和具体页面建立稳定关联。
```

判定链路：

1. 在 workspace 文件中查找 `**/src/main/module.json5`。
2. 解析其中 `module.routerMap`。
3. 将 `$profile:route_map` 解析到同模块下 `src/main/resources/base/profile/route_map.json`。
4. 解析 `routerMap[].pageSourceFile`。
5. 只检查以下页面：
   - 页面文件在 patch changed files 中；或
   - route map 文件在 patch changed files 中，且新增/修改 route 指向该页面。
6. 读取目标 `.ets` 文件。
7. 判定是否存在 `NavDestination(` 或 `NavDestination {` 作为页面 build 结构的一部分。

首版不做完整 ArkTS AST，只做强模式静态检测：

- pass：目标文件中存在 `NavDestination\s*(?:\(|\{)`。
- violation：目标文件存在且不包含 `NavDestination`。
- not_applicable：未找到 routerMap，或 route_map.json 指向的目标页面不在 patch 范围。
- violation：module.json5 配置了 routerMap，但对应 profile 文件缺失或不可读。
- review：首版不直接输出 review；route map 解析失败或路径无法归一时输出 `未接入判定器`，交给 rule-assessment agent 复审。

### Rule: No Multiple bindSheet on Same Component Chain

规则 ID：

```text
ARKUI-FORBID-001
```

规则文本：

```text
不支持在同一个 ArkUI 组件链上挂载多个 bindSheet，否则可能只有最后一个 sheet 生效，导致关键交互无法弹出。
```

YAML 草案：

```yaml
forbidden_patterns:
  - id: ARKUI-FORBID-001
    rule: 不支持在同一个 ArkUI 组件链上挂载多个 bindSheet，否则可能只有最后一个 sheet 生效，导致关键交互无法弹出。
    detector_kind: arkui_extra
    detector_config:
      check: multi_bindsheet_same_component
    fallback_policy: agent_assisted
    decision_criteria:
      pass:
        - 每个组件链最多挂载一个 bindSheet。
      fail:
        - 同一组件链上连续或链式出现多个 bindSheet。
      not_applicable:
        - 当前 patch 不涉及 bindSheet。
      review:
        - 代码格式无法稳定判断 bindSheet 是否属于同一组件链。
```

判定链路：

1. 只检查 patch changed files 中的 `.ets` 文件。
2. 对每个文件做轻量词法扫描，忽略字符串和注释。
3. 识别组件链上的 chained call。
4. 如果同一链段中 `.bindSheet(` 出现次数大于 1，则判定 `不满足`。

首版允许保守一些：

- 明确连续链式写法必须命中：

```ts
Column() {
}
.bindSheet(...)
.bindSheet(...)
```

- 如果中间穿插复杂条件、变量赋值或自定义 builder，无法稳定判断时输出 `未接入判定器`，交给 rule-assessment agent 复审；证据不足时不做激进误报。

## ArkUI Extra Markdown Reference

扩展：

```text
references/rules/arkui-extra.md
```

保留现有三段：

- builder 传递 this 作用域。
- routerMap 页面根组件必须是 `NavDestination`。
- 不支持一个组件挂多个 `bindSheet`。

## Scoring And Reporting Behavior

### ArkUI Extra Rule Violations

`ARKUI-MUST-001` 和 `ARKUI-FORBID-001` 输出为 `RuleAuditResult`，进入既有 `ruleMergeNode` 和 `scoreFusion`。

需要在 `scoreFusion.findPenaltyRules` 中为 `ARKUI-*` 规则增加影响映射：

- `ARKUI-MUST-001`
  - metricNames：平台规范符合度、ArkUI组织方式合理性、稳定性风险
  - ratio：`0.35`
  - severity：`medium`
- `ARKUI-FORBID-001`
  - metricNames：状态与数据流组织、稳定性风险、ArkUI组织方式合理性
  - ratio：`0.35`
  - severity：`medium`

首版不触发 hard gate。后续如验证路由缺失稳定导致页面空白，可再升级 `ARKUI-MUST-001` 为 P0/hard gate 候选。

### Deprecated API Risks

废弃 API 不进入 `RuleAuditResult`，因此不参与 rule violation stats。

它在 `risks` 中出现，并参与报告展示、风险 review 和后续人工评级差异分析。

所有 deprecated warning 聚合成一个风险，evidence 中列出最多 3 个位置，避免报告噪声。

## Error Handling

- hvigor 输出解析失败：忽略该行，不影响 build check 状态。
- `deprecatedApiWarnings` 为空：不生成风险。
- route map JSON 解析失败：对应规则输出 `未接入判定器`，conclusion 说明 route map 无法解析，并交给 rule-assessment agent 复审。
- module.json5 JSON5 解析首版可用宽松文本解析；只有确认没有 `routerMap` 时才视为不涉及。
- module.json5 配置了 `routerMap` 但对应 profile 文件缺失或不可读：`ARKUI-MUST-001` 输出 `不满足`，说明路由表配置无效。
- 目标页面文件缺失：`ARKUI-MUST-001` 输出 `不满足`，说明 route map 指向的页面不存在。
- bindSheet 扫描遇到语法不完整：只对强命中链式多 bindSheet 输出 `不满足`，否则不命中。

## Test Strategy

### Unit Tests

新增或扩展：

```text
tests/official-code-linter-node.test.ts
tests/official-code-linter-parser.test.ts
tests/score-fusion.test.ts
tests/rule-pack-yaml-loader.test.ts
tests/rule-engine.test.ts
```

测试点：

- hvigor stdout 中带 deprecated warning 且行号命中 patch 新增行时，`deprecatedApiWarnings` 有记录。
- deprecated warning 指向未改动文件时，不记录。
- deprecated warning 指向改动文件但非新增行时，不记录。
- score fusion 根据 `deprecatedApiWarnings` 生成 medium risk。
- `arkui-extra.yaml` 能被 YAML loader 加载。
- 默认规则包包含 `arkui-extra`。
- route map 指向页面缺少 `NavDestination` 时，`ARKUI-MUST-001` 输出 `不满足`。
- route map 指向页面包含 `NavDestination` 时，输出 `满足` 或不产生违规。
- 同一组件链多个 `.bindSheet(` 时，`ARKUI-FORBID-001` 输出 `不满足`。
- 不同组件各自一个 `bindSheet` 时，不误报。

### Integration Tests

在 `tests/score-agent.test.ts` 或 workflow 层 fixture 中覆盖：

- 新增废弃 API warning 能进入最终 `result.json.overall_conclusion.risks`。
- `arkui-extra` 规则违规能进入 `mergedRuleAuditResults` 和最终报告风险。

## Rollout

1. 先实现 hvigor deprecated warning 解析与风险输出。
2. 新增 `arkui-extra.yaml` 和 evaluator，默认启用。
3. 更新 `arkui-extra.md`，保留路由和 bindSheet 规则说明。
4. 运行 targeted tests。
5. 用人工差异样本中的任务复核：528、530、1314、1423、1308。

## Open Follow-Ups

- 是否将 `ARKUI-MUST-001` 在后续升级为 hard gate。
- 是否在后续单独设计 `module.json5` 权限声明一致性检测。
- 是否设计非视觉 runtime smoke check，用于启动、路由、崩溃、点击响应验证。
