# Hvigor Build Check in Official Linter Node Design

Date: 2026-05-09

## Background

当前远程用例评分会在任务预处理完成后进入规则、官方 Code Linter、rubric agent 和评分融合链路。已有 `officialCodeLinterNode` 会在 `ruleAuditNode` 之后运行官方 Code Linter，并把有效 finding 映射为规则结果参与评分。

实际用例中存在生成工程无法编译的情况。单靠静态规则和 rubric agent 容易遗漏这类工程不可用问题，因此需要在 linter 节点内增加 hvigor 编译校验。编译失败是硬门槛问题：工程不可用时最终分数不应高于 59。

现有官方工具目录形态如下：

```text
/Users/guoyutong/command-line-tools/
  codelinter/
  hvigor/
```

当前 `HMOS_CODE_LINTER_RUN_DIR` 指向 `codelinter` 目录。新增设计需要支持通过工具根目录定位 `codelinter` 和 `hvigor`，也要保持未配置新环境变量时兼容现有配置。

## Goals

- hvigor 编译校验跟随 `HMOS_CODE_LINTER_ENABLED=true` 启用；linter 关闭时不运行 hvigor。
- 在 `officialCodeLinterNode` 内增加 hvigor build check 子流程，不新增独立 workflow 节点。
- 对本次代码修改涉及到的 HarmonyOS 分包逐一编译。
- HAR 模块执行 `assembleHar`，`entry` HAP 执行 `assembleHap`。
- 编译失败、超时或 hvigor 工具不可用时触发硬门槛，最终总分上限为 59。
- 将 build check 运行摘要、模块结果、stdout/stderr 摘要和清理结果落盘，便于排查。
- 节点结束后清理 hvigor 编译生成产物，避免 `intermediate` 或临时 workspace 缓存过大。
- 不污染 `caseInput.generatedProjectPath`，所有编译运行都在 linter 临时 workspace 中完成。

## Non-Goals

- 不让 hvigor 结果替代官方 Code Linter 规则 finding。
- 不让 agent 执行编译命令或判断编译成功。
- 不在首版支持自定义 product、target、build profile 或多 product 矩阵。
- 不在没有可靠变更文件范围时全量编译所有模块。
- 不自动安装 hvigor、ohpm 依赖或修复工程配置。
- 不把编译产物上传为评分附件。
- 不改变官方 Code Linter 原有 finding 过滤规则。

## Existing Constraints

- `officialCodeLinterNode` 当前在 `ruleAuditNode` 之后运行，能够读取 `state.evidenceSummary.changedFiles`。
- `taskUnderstandingNode` 会生成 `effectivePatchPath` 和 `workspaceProjectStructure`。
- `ruleAuditNode` 会通过 patch 产出 `evidenceSummary.changedFiles` 和 `changedLineNumbersByFile`。
- `prepareOfficialCodeLinterWorkspace` 会复制 generated project 到 `caseDir/intermediate/code-linter/workspace`，跳过依赖、构建、测试等目录。
- `scoreFusionOrchestrationNode` 负责统一调用 `fuseRubricScoreWithRules` 生成最终分数和硬门槛结果。
- `reportGenerationNode` 当前把 `basic_info.build_check_enabled` 固定写为 `false`。

## Recommended Approach

采用“official linter 节点内串行 build check + score fusion 统一硬门槛”的方案。

`officialCodeLinterNode` 继续负责官方 Code Linter，同时在同一个临时 workspace 内运行 hvigor build check。节点产出新增 build check 状态字段。评分融合读取该字段，如果存在失败或超时，则触发 `BUILD-CHECK` 硬门槛，并把总分 cap 到 59。

优点：

- 符合“在 linter 节点内新增功能”的要求。
- linter 和 hvigor 共用官方工具启停与临时 workspace。
- 构建失败的评分影响集中在 score fusion，报告和人工复核逻辑不需要分散判断。
- 不改变 agent 权限边界。

代价：

- `officialCodeLinterNode` 职责从纯静态 linter 扩展为官方工具校验节点。
- hvigor 编译耗时会增加 linter 节点总耗时，需要单独记录 build check duration 和 timeout。

## Configuration

新增环境变量：

```text
HMOS_OFFICIAL_TOOL_RUN_DIR=
```

字段语义：

- `HMOS_OFFICIAL_TOOL_RUN_DIR`: 官方命令行工具根目录，目录下应包含 `codelinter` 和 `hvigor` 子目录。

兼容规则：

1. 如果配置了 `HMOS_OFFICIAL_TOOL_RUN_DIR`，则：
   - Code Linter run dir 默认为 `<HMOS_OFFICIAL_TOOL_RUN_DIR>/codelinter`。
   - hvigor run dir 为 `<HMOS_OFFICIAL_TOOL_RUN_DIR>/hvigor`。
2. 如果未配置 `HMOS_OFFICIAL_TOOL_RUN_DIR`，但配置了 `HMOS_CODE_LINTER_RUN_DIR`，则：
   - Code Linter 继续使用 `HMOS_CODE_LINTER_RUN_DIR`。
   - hvigor run dir 默认为 `path.join(path.dirname(HMOS_CODE_LINTER_RUN_DIR), "hvigor")`。
3. 如果 `deps.runDir` 在测试中显式传入，则 Code Linter 使用 `deps.runDir`，hvigor run dir 默认取其上层目录的 `hvigor`，除非测试 deps 显式传入 hvigor run dir。

保留现有环境变量：

```text
HMOS_CODE_LINTER_ENABLED=true
HMOS_CODE_LINTER_RUN_DIR=
HMOS_CODE_LINTER_TIMEOUT_MS=120000
```

`HMOS_CODE_LINTER_ENABLED` 是唯一启用开关。关闭时 Code Linter 和 hvigor build check 都返回 `not_enabled`。

首版复用 `HMOS_CODE_LINTER_TIMEOUT_MS` 作为 Code Linter timeout。新增可选 timeout：

```text
HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS=300000
```

未配置时默认 300000 ms。该 timeout 作用于单条 hvigor 命令，包括 `hvigorw --version` 和每个模块编译命令。

## Module Detection

模块识别必须基于 HarmonyOS 模块结构，不使用文件路径首段。规则如下：

1. 输入来源优先级：
   - `state.evidenceSummary.changedFiles`
   - 如果为空，可回退到 `state.caseInput.patchPath` 解析出的 changed files。
   - 如果仍为空，则 build check 状态为 `skipped`，原因是缺少可靠变更范围。
2. 对每个 changed file 归一化为 `/` 分隔的相对路径。
3. 查找路径片段 `src/main`。
4. 取 `src/main` 的上层路径作为模块路径。
5. 如果 `src/main` 前没有上层路径，模块路径为 `.`。
6. 去重并按字典序稳定排序。

示例：

| changed file | module path |
| --- | --- |
| `entry/src/main/ets/pages/Index.ets` | `entry` |
| `features/feature1/src/main/ets/pages/Home.ets` | `features/feature1` |
| `libs/common/src/main/ets/utils/Foo.ets` | `libs/common` |
| `src/main/ets/pages/Index.ets` | `.` |
| `entry/src/ohosTest/ets/Test.ets` | ignored |
| `README.md` | ignored |

只将包含 `src/main` 的 changed file 纳入 build check。测试目录、文档、脚本或纯配置文件如果无法归属到 HarmonyOS 模块，不触发模块编译。

## Build Target Selection

每个模块路径映射为 hvigor module name：

- 模块中/hvigorfile.ts中使用hapTasks时执行HAP编译，使用harTasks时执行HAR编译，使用hspTasks时使用HSP编译

该规则与 hvigor 命令参数保持一致：

```bash
hvigorw assembleHar --mode module -p module=<moduleName>@default -p product=default --no-daemon
hvigorw assembleHsp --mode module -p module=<moduleName>@default -p product=default --no-daemon
hvigorw assembleHap --mode module -p module=entry@default -p product=default --no-daemon
```

如果后续发现 hvigor 工程需要完整相对路径而非短 module name，应在实现中把 module name resolution 抽成独立函数，便于兼容 `features/feature1@default` 这类形式。首版按用户给定命令使用 `<moduleName>@default`。

## Execution Flow

`officialCodeLinterNode` 目标流程：

1. 读取配置并判断 `HMOS_CODE_LINTER_ENABLED`。
2. 校验 Code Linter run dir 和 hvigor run dir。
3. 调用 `prepareOfficialCodeLinterWorkspace` 复制 generated project 到临时 workspace。
4. 执行官方 Code Linter，保持现有解析、过滤和规则映射逻辑。
5. 从 `state.evidenceSummary.changedFiles` 识别受影响模块。
6. 如果无可编译模块，写入 build check `skipped` 摘要。
7. 在 hvigor run dir 中验证 `hvigorw --version` 可用。
8. 对模块逐一执行 hvigor 编译命令。
9. 任一模块失败或超时，build check 整体状态为 `failed` 或 `timeout`。
10. 所有模块成功，build check 整体状态为 `success`。
11. 无论成功、失败或异常，执行 build artifact cleanup。
12. 写入 linter summary、findings、build check summary、stdout/stderr 摘要、cleanup summary。
13. 返回官方 linter 字段和 build check 字段。

Code Linter 失败不应阻止 hvigor build check 运行，只要 workspace 和 hvigor 工具可用。hvigor build check 失败也不应阻止 Code Linter finding 进入评分。节点异常只用于不可恢复的本地错误，例如无法创建 workspace 或无法写 artifact。

## Commands

验证 hvigor：

```bash
hvigorw --version
```

编译 HAR：

```bash
hvigorw assembleHar --mode module -p module=<moduleName>@default -p product=default --no-daemon
```

编译 HAP：

```bash
hvigorw assembleHap --mode module -p module=entry@default -p product=default --no-daemon
```

执行细节：

- `cwd` 使用 `caseDir/intermediate/code-linter/workspace`。
- `hvigorw` 路径优先使用 `<hvigorRunDir>/hvigorw`。
- 如果不存在 `<hvigorRunDir>/hvigorw`，尝试 `<hvigorRunDir>/bin/hvigorw`。
- stdout/stderr 需要截断后落盘，避免日志过大。建议每条命令 stdout 和 stderr 各保留最后 64 KB。
- 每条命令记录 args、modulePath、moduleName、commandKind、exitCode、durationMs、status。

## State Model

新增类型：

```ts
export type HvigorBuildCheckStatus =
  | "not_enabled"
  | "skipped"
  | "tool_unavailable"
  | "success"
  | "failed"
  | "timeout";

export interface HvigorBuildCheckModuleResult {
  modulePath: string;
  moduleName: string;
  command: "assembleHar" | "assembleHap";
  status: "success" | "failed" | "timeout";
  exitCode?: number;
  durationMs: number;
  stdoutExcerpt?: string;
  stderrExcerpt?: string;
}

export interface HvigorBuildCheckSummary {
  enabled: boolean;
  status: HvigorBuildCheckStatus;
  hvigorRunDir?: string;
  checkedModules: string[];
  moduleResults: HvigorBuildCheckModuleResult[];
  hardGateTriggered: boolean;
  scoreCap?: number;
  diagnostics?: string;
  durationMs: number;
  cleanup: {
    attempted: boolean;
    removedPaths: string[];
    failedPaths: Array<{ path: string; reason: string }>;
  };
}
```

`ScoreGraphState` 新增：

```ts
hvigorBuildCheckStatus: HvigorBuildCheckStatus
hvigorBuildCheckSummary: HvigorBuildCheckSummary
```

命名使用 hvigor 而不是 generic build check，避免后续接入其他构建工具时语义混淆。报告层可以展示为 “build check”。

## Hard Gate and Scoring

score fusion 增加一个非 rubric 文件里的系统硬门槛：

```text
BUILD-CHECK: 工程不可编译，总分上限 59
```

触发条件：

- `hvigorBuildCheckSummary.hardGateTriggered === true`
- 或 `hvigorBuildCheckStatus` 为 `tool_unavailable`、`failed`、`timeout`

不触发条件：

- `not_enabled`: linter 关闭，不评价 build check。
- `skipped`: 没有可靠变更模块，不评价 build check。
- `success`: 编译通过。

评分融合行为：

- 在计算原有 rule hard gates 后额外考虑 build check cap。
- 如果原有 hard gate cap 更低，则取更低 cap。
- `hardGateTriggered` 为 true。
- `hardGateReason` 追加 `BUILD-CHECK`。
- `overallConclusion.summary` 说明工程编译校验未通过。
- `risks` 增加一条高风险项，描述失败模块、命令和诊断摘要。
- `humanReviewItems` 不因确定性编译失败额外增加。编译失败证据明确时直接封顶。

## Artifacts

新增 artifact 目录仍放在现有 linter 目录下：

```text
caseDir/intermediate/code-linter/
  summary.json
  findings.effective.json
  stdout.sanitized.txt
  stderr.sanitized.txt
  exit-code.txt
  hvigor-summary.json
  hvigor-version.stdout.txt
  hvigor-version.stderr.txt
  hvigor-modules/
    <safe-module-id>.stdout.txt
    <safe-module-id>.stderr.txt
```

`hvigor-summary.json` 包含：

- enabled
- status
- hvigorRunDir
- checkedModules
- moduleResults
- hardGateTriggered
- scoreCap
- diagnostics
- durationMs
- cleanup

`<safe-module-id>` 用模块路径归一化生成，例如：

- `entry` -> `entry`
- `features/feature1` -> `features__feature1`
- `.` -> `root`

stdout/stderr artifact 写入前必须截断。命令原始完整输出不落盘。

## Cleanup

build check 结束后必须清理临时 workspace 内的构建产物。清理范围只允许位于 `workspaceDir` 内，不能删除 generated project 原目录或仓库目录。

首版清理路径：

```text
workspace/.hvigor
workspace/build
workspace/oh_modules
workspace/<modulePath>/build
workspace/<modulePath>/oh_modules
workspace/<modulePath>/.preview
```

对每个已识别模块都尝试清理模块级路径。清理前需要校验目标路径 resolve 后仍在 `workspaceDir` 内。清理失败记录到 summary，不改变 build check 成败状态。

## Report

`reportGenerationNode` 更新：

- `basic_info.build_check_enabled` 根据 `hvigorBuildCheckSummary.enabled` 写入。
- 新增机器可读字段 `build_check_summary`，内容来自 `hvigorBuildCheckSummary`。
- `overall_conclusion` 继续来自 `scoreComputation.overallConclusion`，包含硬门槛后的 total score。
- `risks` 中展示 build check 失败风险。

schema 更新：

- `references/scoring/report_result_schema.json`
- `tests/fixtures/report_result_schema.json`

`build_check_summary` 首版字段建议：

```json
{
  "enabled": true,
  "status": "failed",
  "checked_modules": ["features/feature1"],
  "hard_gate_triggered": true,
  "score_cap": 59,
  "diagnostics": "hvigor assembleHar failed for feature1",
  "module_results": [
    {
      "module_path": "features/feature1",
      "module_name": "feature1",
      "command": "assembleHar",
      "status": "failed",
      "exit_code": 1,
      "duration_ms": 12345
    }
  ]
}
```

## Error Handling

- linter disabled: Code Linter 和 hvigor 都返回 `not_enabled`。
- Code Linter run dir 缺失: Code Linter 返回 `not_installed`；如果可推导 hvigor run dir 且 workspace 可用，仍可运行 hvigor。若缺少 generated project 或 caseDir，则 hvigor 返回 `tool_unavailable` 或 `skipped`。
- hvigor run dir 缺失: hvigor 返回 `tool_unavailable`，触发 59 分封顶。
- `hvigorw --version` 失败: hvigor 返回 `tool_unavailable`，触发 59 分封顶。
- 模块识别为空: hvigor 返回 `skipped`，不触发封顶。
- 单模块编译失败: hvigor 返回 `failed`，触发封顶。
- 单模块编译超时: hvigor 返回 `timeout`，触发封顶。
- 清理失败: 只写入 cleanup failedPaths，不覆盖 build check 状态。

## Tests

新增或更新测试：

- `config-reference.test.ts`: 覆盖 `HMOS_OFFICIAL_TOOL_RUN_DIR` 和 fallback 到 `dirname(HMOS_CODE_LINTER_RUN_DIR)`。
- `official-code-linter-node.test.ts`: 覆盖 linter enabled 时 hvigor 跟随执行。
- `official-code-linter-node.test.ts`: 覆盖 linter disabled 时 hvigor not_enabled。
- 新增 hvigor runner 单元测试：`hvigorw --version` 成功、失败、超时。
- 新增模块识别测试：
  - `entry/src/main/...` -> `entry`
  - `features/feature1/src/main/...` -> `features/feature1`
  - `libs/common/src/main/...` -> `libs/common`
  - `src/main/...` -> `.`
  - 不含 `src/main` 的文件忽略
- 新增 score fusion 测试：hvigor failed 时总分 cap 到 59，`hardGateReason` 包含 `BUILD-CHECK`。
- 新增 report generation/schema 测试：`build_check_enabled=true` 且输出 `build_check_summary`。
- 新增 cleanup 测试：只删除 workspace 内 `.hvigor`、`build` 和模块 build，不删除 workspace 外路径。

## Rollout

首版随 `HMOS_CODE_LINTER_ENABLED=true` 自动启用 hvigor build check。生产部署需要把官方工具根目录配置为：

```text
HMOS_OFFICIAL_TOOL_RUN_DIR=/Users/guoyutong/command-line-tools
```

如果暂时只配置旧变量：

```text
HMOS_CODE_LINTER_RUN_DIR=/Users/guoyutong/command-line-tools/codelinter
```

系统会推导 hvigor 目录为：

```text
/Users/guoyutong/command-line-tools/hvigor
```

上线后通过 `intermediate/code-linter/hvigor-summary.json` 验证：

- hvigor 工具是否可用。
- 识别模块是否符合预期。
- 编译失败是否正确触发 59 分封顶。
- cleanup 是否删除大体积产物。

## Open Decisions Closed

- hvigor build check 跟随 `HMOS_CODE_LINTER_ENABLED`，不新增独立启用开关。
- 模块识别基于 `src/main` 的上层路径，避免 `features/feature1/src/main` 被错误识别为 `features`。
- 构建失败是确定性硬门槛，不进入 agent 复核。
- 没有可靠变更模块时跳过 build check，不做全量工程编译。
