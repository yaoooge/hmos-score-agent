# HarmonyOS 官方 Code Linter 规则评价集成设计

## 1. 背景

当前规则评价阶段由两部分组成：

1. `ruleAuditNode` 调用本地 `runRuleEngine`，产出确定性规则结果、待 agent 辅助判定候选、规则证据索引和违规列表。
2. `ruleAssessmentAgentNode` 只处理本地静态层无法稳定判定的规则，`ruleMergeNode` 再合并确定性规则和 agent 辅助结果。

HarmonyOS 官方提供了 Code Linter 能力，可以按官方规则集对 ArkTS / ArkUI 工程做最佳实践、编程规范、安全、性能、多端适配和代码风格检查。当前评分系统已有内部 ArkTS 规则包，但没有调用官方 Code Linter。为了提升规则评价阶段的覆盖面，需要把官方推荐规则集通过命令行方式接入规则评价链路。

官方文档要点如下：

- Code Linter 可通过工程根目录的 `code-linter.json5` 配置检查范围和规则范围。
- `files` 与 `ignore` 共同确定检查文件范围。
- `ruleSet` 与 `rules` 共同确定生效规则范围。
- 规则集支持 `all` 和 `recommended` 两类，`all` 包含 `recommended`。
- 不配置 `code-linter.json5` 时，默认只检查 `@performance/recommended` 和 `@typescript-eslint/recommended`，因此不能依赖默认配置覆盖全部推荐规则集。
- 从 DevEco Studio 6.0.1 Beta1 开始支持命令行检查，入口为 DevEco Studio 安装目录下 `deveco-studio/plugins/codelinter/run` 中的 `node ./index.js [options] [dir]`。
- 命令行检查依赖 Node.js 环境，本地 Node.js 版本需要和 DevEco Studio tools 目录下 Node.js 版本保持一致。
- 当前 recommended 推荐规则清单页面列出 6 个推荐规则集：`@typescript-eslint/recommended`、`@security/recommended`、`@performance/recommended`、`@previewer/recommended`、`@cross-device-app-dev/recommended`、`@hw-stylistic/recommended`。

参考文档：

- `https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-code-linter`
- `https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-coderlinter-recommended-rules`

## 2. 目标

本次设计目标如下：

1. 在规则评价阶段接入 HarmonyOS 官方 Code Linter 命令行能力。
2. 显式启用官方 recommended 推荐规则集，避免只使用默认的两组规则。
3. 将官方 Code Linter 结果映射为现有 `RuleAuditResult`，参与规则合并和评分融合。
4. 保留内部规则引擎优先、agent 只处理不确定规则的总体架构。
5. 对命中未变更文件的官方 linter finding 做完全忽略：不参与扣分、不进入规则结果、不进入报告、不进入人审项、不进入官方 linter findings 产物。
6. 在官方 linter 不可用、失败、超时或输出不可解析时稳定降级，不阻塞默认评分流程。
7. 将可复现的配置、运行状态和有效 finding 摘要落盘，便于排查接入问题。

## 3. 非目标

本次明确不做以下事项：

- 不重写现有 ArkTS 内部规则包。
- 不让 agent 代替官方 Code Linter 执行命令行检查。
- 不让官方 Code Linter 覆盖本地确定性规则结果。
- 不把官方 recommended 页面没有列出的 `@correctness/recommended` 和 `@compatibility/recommended` 默认纳入首版配置。
- 不实现 Code Linter 自动修复能力。
- 不把命中未变更文件的问题作为历史问题展示、报告或提交给人工复核。
- 不要求 DevEco Studio / Code Linter 缺失时评分任务默认失败。

## 4. 设计原则

### 4.1 官方 linter 是确定性外部证据源

官方 Code Linter 通过 CLI 执行，输出结果应作为确定性规则证据进入规则评价阶段。它不属于 agent 辅助判定范围，也不应被 agent 二次裁决。

### 4.2 不污染被评分工程

`code-linter.json5` 由评分系统生成，但不应写入或覆盖用户生成工程。官方 linter 应在临时工作区运行，评分结束后保留必要产物用于回放。

### 4.3 只评价本次变更

当 case 存在 patch 或变更文件列表时，官方 linter 只对命中变更文件的 finding 生效。命中未变更文件的 finding 视为与本次输出无关，必须在解析后立即过滤掉。

### 4.4 未变更文件 finding 完全不可见

命中未变更文件的 finding 不做处理，且不得进入以下任何业务产物：

- `officialLinterFindings`
- `officialLinterRuleResults`
- `mergedRuleAuditResults`
- `ruleViolations`
- `result.json`
- `report.html`
- `human_review_items`
- `intermediate/code-linter/findings.raw.json`
- `intermediate/code-linter/findings.effective.json`
- 官方 linter 摘要中的详细条目

如果 CLI 原始 stdout / stderr 中包含未变更文件的 finding 行，落盘诊断文本也必须在写入前做过滤或脱敏，只允许保留命令级诊断摘要，例如退出码、耗时和有效 finding 数。未变更文件 finding 的数量和明细都不进入业务状态、报告或复核信息。

### 4.5 默认降级不阻塞

官方 linter 是增强能力，不应成为评分流程默认单点故障。除非显式开启 strict 模式，否则缺少 DevEco Studio、命令失败、超时和输出不可解析都只产生运行状态，不改变评分结果。

## 5. 总体架构

新增 `officialCodeLinterNode`，在 `inputClassificationNode` 之后运行，并在 `ruleMergeNode` 之前完成。

目标链路：

```text
remoteTaskPreparationNode
-> taskUnderstandingNode
-> inputClassificationNode
-> parallel:
     ruleAuditNode
     officialCodeLinterNode
     rubricPreparationNode
-> parallel:
     rubricScoringPromptBuilderNode -> rubricScoringAgentNode
     ruleAgentPromptBuilderNode -> ruleAssessmentAgentNode
-> ruleMergeNode
-> scoreFusionOrchestrationNode
-> reportGenerationNode
-> artifactPostProcessNode
-> persistAndUploadNode
```

`officialCodeLinterNode` 产出：

- `officialLinterRunStatus`
- `officialLinterSummary`
- `officialLinterFindings`
- `officialLinterRuleResults`

`ruleMergeNode` 合并：

```text
deterministicRuleResults
+ officialLinterRuleResults
+ ruleAgentAssessmentResult
=> mergedRuleAuditResults
```

## 6. 配置设计

新增运行配置：

```text
HMOS_CODE_LINTER_ENABLED=false
HMOS_CODE_LINTER_RUN_DIR=
HMOS_CODE_LINTER_NODE=
HMOS_CODE_LINTER_TIMEOUT_MS=120000
HMOS_CODE_LINTER_STRICT=false
HMOS_CODE_LINTER_RULE_SETS=
```

字段语义：

- `HMOS_CODE_LINTER_ENABLED`: 是否启用官方 linter。
- `HMOS_CODE_LINTER_RUN_DIR`: DevEco Studio 安装目录下 `plugins/codelinter/run` 路径。
- `HMOS_CODE_LINTER_NODE`: 与 DevEco Studio tools 保持一致的 Node.js 可执行文件路径。
- `HMOS_CODE_LINTER_TIMEOUT_MS`: 单次 CLI 运行超时时间。
- `HMOS_CODE_LINTER_STRICT`: 是否将官方 linter 失败视为评分失败。
- `HMOS_CODE_LINTER_RULE_SETS`: 可选覆盖默认 recommended 规则集，使用逗号分隔。

默认不开启 `HMOS_CODE_LINTER_ENABLED`，避免没有 DevEco Studio 的环境直接受影响。

## 7. 生成 `code-linter.json5`

首版默认生成如下配置：

```json5
{
  "files": [
    "**/*.ets",
    "**/*.ts",
    "**/*.js",
    "**/*.json",
    "**/*.json5"
  ],
  "ignore": [
    "node_modules/**/*",
    "oh_modules/**/*",
    "build/**/*",
    ".preview/**/*",
    "src/ohosTest/**/*",
    "src/test/**/*",
    "hvigorfile.ts",
    "hvigorfile.js",
    "BuildProfile.ets"
  ],
  "ruleSet": [
    "plugin:@typescript-eslint/recommended",
    "plugin:@security/recommended",
    "plugin:@performance/recommended",
    "plugin:@previewer/recommended",
    "plugin:@cross-device-app-dev/recommended",
    "plugin:@hw-stylistic/recommended"
  ]
}
```

生成配置写入临时工作区根目录：

```text
caseDir/intermediate/code-linter/workspace/code-linter.json5
```

如果用户生成工程原本存在 `code-linter.json5`，首版不读取、不复用、不合并。评分系统使用自己的固定 recommended 配置，以保证跨 case 的规则口径一致。

## 8. 临时工作区

官方 linter 不直接在 `caseInput.generatedProjectPath` 中运行。节点需要复制一份临时工作区：

```text
caseDir/intermediate/code-linter/workspace
```

复制时跳过：

```text
node_modules
oh_modules
build
.preview
.git
```

临时工作区只用于官方 linter 执行。除官方 linter 生成的临时文件外，不应把临时工作区反向写回 generated project。

## 9. 命令执行

命令形式：

```bash
"$HMOS_CODE_LINTER_NODE" ./index.js "$LINTER_WORKSPACE"
```

执行参数：

- `cwd`: `HMOS_CODE_LINTER_RUN_DIR`
- `timeout`: `HMOS_CODE_LINTER_TIMEOUT_MS`
- `env`: 继承当前进程环境

执行前校验：

1. `HMOS_CODE_LINTER_ENABLED` 为 true。
2. `HMOS_CODE_LINTER_RUN_DIR` 存在。
3. `HMOS_CODE_LINTER_NODE` 存在且可执行。
4. `HMOS_CODE_LINTER_RUN_DIR/index.js` 存在。
5. 临时工作区创建成功。

任一校验失败：

- strict=false: 返回降级状态。
- strict=true: 抛错中止评分。

## 10. 输出解析

官方文档当前只明确命令入口，没有给出稳定 JSON 输出契约。因此需要 parser 适配层：

1. 优先解析 stdout 中的 JSON。
2. 如果 stdout 不是 JSON，尝试解析 ESLint 常见文本格式。
3. 如果 CLI 生成了可识别的结果文件，优先读取结果文件。
4. 如果命令退出码非 0 但解析到 finding，仍视为 `success`，因为 lint 命中通常可能通过非零退出码表达。
5. 如果无法解析 finding 且命令异常，返回 `invalid_output` 或 `failed`。

解析出的原始 finding 先进入内存中的临时集合，不直接落盘。随后立即执行变更文件过滤。

## 11. 变更文件过滤

### 11.1 过滤输入

过滤依据来自现有规则评价阶段的证据摘要：

- `state.evidenceSummary.changedFiles`
- `state.hasPatch`

如果 `state.hasPatch === true` 且 `changedFiles.length > 0`，只保留文件路径命中 `changedFiles` 的 finding。

如果 `state.hasPatch !== true` 或 `changedFiles.length === 0`，表示当前 case 没有可靠变更范围，官方 linter finding 全量生效。

### 11.2 路径归一化

过滤前对路径做归一化：

- 转为 POSIX 风格 `/`
- 去掉临时工作区绝对路径前缀
- 去掉 `workspace/` 和 `generated/` 前缀
- 去掉开头的 `./`
- 对大小写保持原样，不做平台相关折叠

### 11.3 未变更文件 finding 处理

命中未变更文件的 finding 必须完全丢弃：

- 不映射为规则结果。
- 不生成 `RuleViolation`。
- 不生成风险项。
- 不生成人工复核项。
- 不进入 HTML 报告。
- 不进入 `result.json`。
- 不进入官方 linter finding JSON 产物。
- 不在日志中打印具体 rule id、文件名、行号或 message。

summary 中可以只记录数字：

```ts
effectiveFindingCount: number;
```

不得记录被过滤 finding 的数量或明细。

## 12. 状态模型

新增类型：

```ts
export type OfficialLinterRunStatus =
  | "not_enabled"
  | "not_installed"
  | "success"
  | "failed"
  | "timeout"
  | "invalid_output";

export interface OfficialLinterFinding {
  rule_id: string;
  message: string;
  severity: "suggestion" | "warn" | "error" | "unknown";
  file: string;
  line?: number;
  column?: number;
  source_rule_set: string;
}

export interface OfficialLinterSummary {
  configuredRuleSets: string[];
  effectiveFindingCount: number;
  runStatus: OfficialLinterRunStatus;
  exitCode?: number;
  durationMs: number;
  diagnostics?: string;
}
```

`ScoreState` 新增：

```ts
officialLinterRunStatus: Annotation<OfficialLinterRunStatus>();
officialLinterSummary: Annotation<OfficialLinterSummary>();
officialLinterFindings: Annotation<OfficialLinterFinding[]>();
officialLinterRuleResults: Annotation<RuleAuditResult[]>();
```

`officialLinterFindings` 只允许包含变更文件内的 finding，或者无 patch case 下的全量 finding。

## 13. 产物设计

落盘路径：

```text
intermediate/code-linter/code-linter.json5
intermediate/code-linter/summary.json
intermediate/code-linter/findings.effective.json
intermediate/code-linter/stdout.sanitized.txt
intermediate/code-linter/stderr.sanitized.txt
intermediate/code-linter/exit-code.txt
```

不落盘 `findings.raw.json`。原因是 raw findings 可能包含未变更文件问题，而本设计要求这类问题不进入原始报告和复核信息。

`stdout.sanitized.txt` 和 `stderr.sanitized.txt` 只允许保留：

- 命令级错误信息。
- 环境缺失信息。
- 解析失败摘要。
- 有效 finding 数。

如果 stdout / stderr 原文包含具体 finding 行，写入前必须移除包含文件路径、规则 id、行列号和 message 的明细。

## 14. Finding 到规则结果映射

有效 finding 映射为 `RuleAuditResult`：

```ts
{
  rule_id: `OFFICIAL-LINTER:${finding.rule_id}`,
  rule_summary: `官方 Code Linter：${finding.rule_id}`,
  rule_source: mapOfficialRuleSource(finding),
  result: "不满足",
  conclusion: `${finding.file}${lineColumnText} ${finding.rule_id} ${finding.message}`
}
```

`lineColumnText` 仅在 line / column 存在时生成。

初始 `rule_source` 映射：

```text
@security/*              -> forbidden_pattern
@performance/*           -> should_rule
@cross-device-app-dev/*  -> should_rule
@hw-stylistic/*          -> should_rule
@previewer/*             -> should_rule
@typescript-eslint/*     -> should_rule
```

可通过 `officialCodeLinterRuleProfiles.ts` 覆盖高价值规则：

```ts
{
  "@typescript-eslint/no-explicit-any": {
    rule_source: "must_rule",
    metricTargets: ["ArkTS/ArkUI语法与类型安全"]
  }
}
```

## 15. 去重与聚合

为了避免同一规则重复刷屏导致过度扣分，映射前先做去重：

```text
rule_id + file + line + column + message
```

同一规则在同一文件多次命中时，`officialLinterFindings` 保留明细；`officialLinterRuleResults` 可以按 rule id 聚合为一条规则结果：

```text
OFFICIAL-LINTER:@performance/foreach-args-check 命中 3 处：pages/Index.ets:12:4；pages/Index.ets:40:8；...
```

聚合后的结论最多列出前 5 个位置，超过部分只记录数量：

```text
另有 7 处同类问题。
```

## 16. 评分融合

`scoreFusion.ts` 扩展 `findPenaltyRules`，识别 `OFFICIAL-LINTER:` 前缀：

```text
OFFICIAL-LINTER:@security/*             -> 安全/边界意识，heavy
OFFICIAL-LINTER:@performance/*          -> 性能风险，light 或 medium
OFFICIAL-LINTER:@cross-device-app-dev/* -> 静态质量 / 多端适配相关指标，light 或 medium
OFFICIAL-LINTER:@hw-stylistic/*         -> 静态坏味道控制 / 命名与风格一致性，light
OFFICIAL-LINTER:@previewer/*            -> ArkUI 规范符合度 / 稳定性风险，medium
OFFICIAL-LINTER:@typescript-eslint/*    -> 类型安全 / 静态质量，按具体规则分级
```

扣分原则：

- `error` finding 默认参与扣分。
- `warn` finding 默认轻量扣分。
- `suggestion` finding 默认不扣分，只作为规则审计结果展示。
- 同一官方规则对同一评分子项的累计扣分需要设置上限，首版建议不超过该子项基础分的 30%。
- `@security/*` 可以提高到 50% 上限。

`OFFICIAL-LINTER:` 规则不直接触发硬门槛，除非后续在 `officialCodeLinterRuleProfiles.ts` 中显式配置。

## 17. 报告展示

报告中新增官方 linter 摘要区，展示：

- 是否启用。
- 运行状态。
- 生效 recommended 规则集。
- 有效 finding 数。
- 官方 linter 规则审计结果。

不展示未变更文件 finding 的数量或任何明细。

如果官方 linter 未启用或不可用：

- 报告只展示状态摘要。
- 不生成复核项。
- 不扣分。

如果 strict 模式下官方 linter 失败，评分流程中止，不生成正常评分报告。

## 18. 人工复核策略

默认模式下，官方 linter 的失败或不可用不生成 `human_review_items`。

原因是该能力是规则增强项，且运行环境依赖 DevEco Studio；默认批量评分场景中，环境缺失不应给 case 本身制造人工复核负担。

只有以下情况可以生成复核项：

1. strict 模式关闭但官方 linter 成功运行，且有效 finding 中存在 `unknown` severity 或无法映射的 rule group。
2. strict 模式关闭但 parser 只解析出部分结果，且这些部分结果来自变更文件。

未变更文件 finding 永远不生成复核项。

## 19. 错误与降级

运行状态语义：

- `not_enabled`: 未启用官方 linter。
- `not_installed`: 配置缺失或 DevEco Code Linter 入口不存在。
- `success`: 命令完成并解析出有效结果，结果可以为空。
- `failed`: 命令执行失败且无法解析有效 finding。
- `timeout`: 命令超时。
- `invalid_output`: 命令输出无法识别。

默认模式：

```text
not_enabled / not_installed / failed / timeout / invalid_output
=> officialLinterRuleResults = []
=> officialLinterFindings = []
=> 不扣分
=> 不生成复核项
```

strict 模式：

```text
not_installed / failed / timeout / invalid_output
=> 抛错中止评分
```

## 20. 测试策略

至少覆盖以下测试：

1. 生成的 `code-linter.json5` 包含 6 个默认 recommended 规则集。
2. 用户通过 `HMOS_CODE_LINTER_RULE_SETS` 覆盖规则集时，配置按覆盖值生成。
3. 环境缺失时默认返回 `not_installed`，不抛错，不产出规则结果。
4. strict 模式下环境缺失会抛错。
5. parser 可以解析 JSON fixture。
6. parser 可以解析文本 fixture。
7. 有 patch 且 finding 命中变更文件时，finding 进入 `officialLinterFindings` 和 `officialLinterRuleResults`。
8. 有 patch 且 finding 命中未变更文件时，finding 被完全丢弃，不进入任何 finding JSON、规则结果、报告视图或人审项。
9. 无 patch 时，解析到的 finding 全量生效。
10. sanitize 后的 stdout / stderr 不包含被过滤 finding 的文件路径、规则 id、message 或数量。
11. `OFFICIAL-LINTER:@security/*` 映射为 `forbidden_pattern`。
12. `OFFICIAL-LINTER:@performance/*` 映射到性能风险相关扣分规则。
13. 同一规则多处命中时，评分扣分受 capped penalty 限制。
14. `ruleMergeNode` 能将 `officialLinterRuleResults` 合并进 `mergedRuleAuditResults`。

## 21. 实施边界

预计新增文件：

- `src/rules/officialCodeLinter/recommendedRuleSets.ts`
- `src/rules/officialCodeLinter/configWriter.ts`
- `src/rules/officialCodeLinter/workspacePreparer.ts`
- `src/rules/officialCodeLinter/runner.ts`
- `src/rules/officialCodeLinter/parser.ts`
- `src/rules/officialCodeLinter/resultMapper.ts`
- `src/rules/officialCodeLinter/sanitizer.ts`
- `src/nodes/officialCodeLinterNode.ts`

预计修改文件：

- `src/config.ts`
- `src/types.ts`
- `src/workflow/state.ts`
- `src/workflow/scoreWorkflow.ts`
- `src/nodes/ruleMergeNode.ts`
- `src/scoring/scoreFusion.ts`
- `src/report/renderer/buildHtmlReportViewModel.ts`
- `src/report/renderer/renderHtmlReport.ts`

预计新增或修改测试：

- `tests/official-code-linter-config.test.ts`
- `tests/official-code-linter-parser.test.ts`
- `tests/official-code-linter-filtering.test.ts`
- `tests/official-code-linter-node.test.ts`
- `tests/score-fusion.test.ts`
- `tests/report-renderer.test.ts`
- `tests/score-agent.test.ts`

## 22. 风险与缓解

### 22.1 风险：官方 CLI 输出格式不稳定

缓解：

- parser 独立封装。
- 保留 fixture 测试。
- 首版支持 JSON、常见文本格式和结果文件优先读取。
- 输出不可解析时默认降级。

### 22.2 风险：未变更文件 finding 泄露到报告

缓解：

- 解析后立即过滤。
- 不落 `findings.raw.json`。
- stdout / stderr 写入前 sanitize。
- 增加专门测试校验未变更文件路径、规则 id、message 和过滤数量不出现在业务产物中。

### 22.3 风险：官方推荐规则过度扣分

缓解：

- 按 severity 分级。
- 对同一规则同一子项设置扣分上限。
- `suggestion` 默认不扣分。
- 首版不让官方 linter 规则直接触发硬门槛。

### 22.4 风险：运行环境依赖重

缓解：

- 默认不开启。
- 默认降级不阻塞。
- strict 模式只用于 CI 或明确要求官方 linter 必跑的环境。

## 23. 验收标准

满足以下条件即可认为本能力设计落地完成：

1. 启用官方 linter 后，系统会在临时工作区生成 `code-linter.json5` 并调用 DevEco Code Linter CLI。
2. 默认 recommended 规则集包含当前官方推荐清单中的 6 组。
3. 有 patch 时，只有变更文件内的 finding 会进入规则评价。
4. 未变更文件 finding 不进入规则结果、报告、人审项和 finding 产物。
5. 官方 linter finding 能映射为 `OFFICIAL-LINTER:*` 规则并参与 `mergedRuleAuditResults`。
6. 官方 linter 不可用时，默认评分流程继续执行且不引入人工复核项。
7. strict 模式下官方 linter 不可用或失败会中止评分。
8. 关键过滤、映射、降级和评分融合行为都有自动化测试覆盖。
