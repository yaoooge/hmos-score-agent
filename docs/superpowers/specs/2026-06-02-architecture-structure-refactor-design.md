# 工程结构重构设计

## 背景

当前工程在一个月 AI 编码迭代后，已经形成稳定的主评分 workflow、远端 API、dashboard、agent 调用、规则审计、评分融合、报告生成、人工复核和 SQLite 索引能力。但源码目录仍保留快速迭代阶段的组织方式：节点实现横向铺在 `src/nodes/`，API 定义和实现混在 `src/api/`，公共类型集中在单个 `src/types.ts`，agent、opencode runtime、agent trace 分散在多个根级目录，SQLite、dashboard 数据读取和人工数据集处理也分布在 `storage/`、`dashboard/`、`humanReview/`、`humanRating/` 等目录。

本次重构只解决工程组织问题：让源码结构表达清楚“对外接口”“workflow 拓扑”“节点实现”“agent 运行”“数据集/数据库”“领域算法”“公共基础设施”的边界。重构不得改变业务行为、接口语义、评分结果、运行产物路径或已有功能。

## 目标

- 收集 API 定义、API 契约和 HTTP 实现边界，新增清晰的 `src/interfaces/api.d.ts` 对外声明入口。
- 保持 `docs/apis/openapi.yaml` 原位置不动，继续作为人工阅读和接口查阅文档。
- 将公共工具、公共类型和基础 IO 聚合到 `src/commons/`。
- 区分 workflow 拓扑和内部节点流：拓扑进入 `src/workflow/graph/`，每个节点在 `src/workflow/nodes/<node-id>/` 下自成目录。
- 每个节点目录结构保持一致：`index.ts`、`types.ts`、`tools.ts`。
- 聚合 agent 相关内容，将 prompt、runner、opencode runtime、trace、输出归一化统一放到 `src/agents/`。
- 将数据库、索引、dashboard 数据读取、人工复核/评级数据集处理归拢到 `src/datasets/`。
- 保留 `rules/`、`scoring/`、`report/` 作为独立领域目录，避免把跨节点领域能力塞进单个 workflow 节点。
- 明确 `src/tools/` 和 `src/commons/utils/` 的区别，防止继续形成新的杂物目录。

## 非目标

- 不新增、删除或改写任何业务功能。
- 不改变 HTTP path、请求体、响应体、callback payload 或 dashboard API 语义。
- 不改变 `.local-cases/`、`outputs/result.json`、`outputs/report.html`、`outputs/agent-trace.json` 等运行产物位置。
- 不改变 scoring、rules、agent prompt、report schema、SQLite schema 的业务含义。
- 不引入 monorepo、workspace package、路径 alias 或新的构建工具。
- 不迁移 `docs/apis/openapi.yaml`。
- 不在本次重构中做规则系统、评分算法、报告渲染或 dashboard UI 的行为优化。

## 当前问题

### 节点与 workflow 边界不清

当前 `src/workflow/scoreWorkflow.ts` 同时承担图拓扑、runtime lifecycle、trace 写入、节点注册和恢复执行逻辑。节点实现集中在 `src/nodes/*.ts`，每个节点的私有工具、依赖类型和领域能力调用混在同一个文件里。结果是 workflow 目录无法单独表达“图如何流转”，节点目录也无法表达“每个阶段有哪些内部实现”。

### 公共类型过度集中

`src/types.ts` 包含远端任务、case、规则、rubric、agent、评分、报告、风险等多类类型。它既被 API、workflow、rules、scoring、agent、io 引用，也包含只属于内部评分链路的类型。该文件成为隐式公共 API，使外部契约和内部状态难以区分。

### Agent 相关代码分散

当前 agent 相关代码分布在 `src/agent/`、`src/opencode/`、`src/agentTrace/`，workflow 和节点也直接引用 opencode runner、trace recorder、prompt builder。opencode runtime 是 agent 基础设施，agent trace 是 agent 运行观测，二者应和 agent runner/prompt 处于同一聚合域。

### 数据库和数据集读取分散

SQLite database wrapper 和 stores 在 `src/storage/`，dashboard 数据聚合在 `src/dashboard/`，人工复核和人工评级数据集处理分别在 `src/humanReview/`、`src/humanRating/`。这些都属于“持久化数据集、索引、读取、写入、聚合”的能力，应聚合为 `src/datasets/`。

### tools 与 utils 边界不明确

`src/tools/` 当前包含工程内部辅助脚本，而 `src/io/` 中也有可复用工具。重构后需要明确：`commons/utils` 是运行时代码可 import 的库函数，`tools` 是人工或 npm script 执行的入口。

## 设计原则

1. 结构表达所有权。

   文件应放在拥有其职责的目录下。workflow 节点拥有阶段编排；rules 拥有规则引擎；scoring 拥有评分算法；report 拥有报告校验和渲染；agents 拥有 agent 调用和运行观测；datasets 拥有持久化数据读取写入。

2. 节点只拥有节点私有逻辑。

   一个工具只被单个节点使用，且只解释该节点状态转换时，放入该节点目录。只要被两个以上节点或非节点模块复用，就提升到领域目录或 commons。

3. 接口契约和实现分离。

   `src/interfaces/` 只描述 API 契约、HTTP 定义和跨边界类型，不放 Express handler、service、store 或 workflow 实现。

4. 领域能力不塞进节点。

   `rules/`、`scoring/`、`report/` 是可复用领域库。节点调用它们，但不拥有它们。

5. 保留现有运行语义。

   迁移只允许修改 import/export 路径、目录位置和 facade，不允许改业务逻辑。任何行为变化都应视为重构失败。

6. 逐步迁移，允许短期 facade。

   为降低风险，可以先建立新目录和 re-export facade，再逐步更新 import。最终旧目录应清理，不长期保留双路径。

## 目标目录结构

```text
src/
  index.ts
  cli.ts
  config.ts

  interfaces/
    api.d.ts
    index.ts
    http/
      apiDefinitions.ts
      paths.ts
      schemas.ts
    contracts/
      index.ts
      remoteTask.ts
      result.ts
      dashboard.ts
      humanReview.ts
      humanRating.ts
      ruleViolation.ts
      agentTrace.ts

  commons/
    index.ts
    types/
      index.ts
      case.ts
      task.ts
      workflow.ts
      rules.ts
      rubric.ts
      scoring.ts
      report.ts
    utils/
      index.ts
      duration.ts
      envFile.ts
      finalJson.ts
      ignoredFiles.ts
      gitignoreMatcher.ts
    io/
      index.ts
      artifactStore.ts
      caseArtifactCleanup.ts
      caseLoader.ts
      caseLogger.ts
      downloader.ts
      networkLogger.ts
      patchGenerator.ts
      uploader.ts

  api/
    index.ts
    app.ts
    routes/
      health.ts
      remoteTasks.ts
      consistencyTasks.ts
      ruleViolationStats.ts
      humanReview.ts
      humanRating.ts
      dashboard.ts
    handlers/
      humanReviewHandler.ts
      manualRatingHandler.ts
    stores/
      remoteTaskRegistry.ts
      consistencyTaskStore.ts
      ruleViolationStatsStore.ts

  workflow/
    index.ts
    graph/
      index.ts
      scoreWorkflow.ts
      topology.ts
      runtimeLifecycle.ts
      resume.ts
      state.ts
    observability/
      index.ts
      types.ts
      nodeLabels.ts
      nodeCustomEvents.ts
      nodeSummaries.ts
      workflowEventLogger.ts
      workflowStreamInterpreter.ts
    nodes/
      remoteTaskPreparation/
        index.ts
        types.ts
        tools.ts
      taskUnderstanding/
        index.ts
        types.ts
        tools.ts
      inputClassification/
        index.ts
        types.ts
        tools.ts
      ruleAudit/
        index.ts
        types.ts
        tools.ts
      officialCodeLinter/
        index.ts
        types.ts
        tools.ts
      rubricPreparation/
        index.ts
        types.ts
        tools.ts
      rubricScoringPromptBuilder/
        index.ts
        types.ts
        tools.ts
      ruleAgentPromptBuilder/
        index.ts
        types.ts
        tools.ts
      rubricScoringAgent/
        index.ts
        types.ts
        tools.ts
      ruleAssessmentAgent/
        index.ts
        types.ts
        tools.ts
      ruleMerge/
        index.ts
        types.ts
        tools.ts
      scoreFusionOrchestration/
        index.ts
        types.ts
        tools.ts
      reportGeneration/
        index.ts
        types.ts
        tools.ts
      artifactPostProcess/
        index.ts
        types.ts
        tools.ts
      persistAndUpload/
        index.ts
        types.ts
        tools.ts
      opencodeSandboxPreparation/
        index.ts
        types.ts
        tools.ts
      humanRatingGapAnalysis/
        index.ts
        types.ts
        tools.ts

  agents/
    index.ts
    opencode/
      index.ts
      config.ts
      cliRunner.ts
      managedRunner.ts
      runnerPool.ts
      serveManager.ts
      sandboxBuilder.ts
      requestTag.ts
    prompts/
      index.ts
      taskUnderstanding.ts
      rubricPrompt.ts
      ruleAssessment.ts
      humanRatingGapAnalysis.ts
    runners/
      index.ts
      opencodeTaskUnderstanding.ts
      opencodeRubricScoring.ts
      opencodeRuleAssessment.ts
      opencodeHumanRatingGapAnalysis.ts
    normalization/
      index.ts
      agentOutputNormalization.ts
      taskUnderstanding.ts
      ruleAssistance.ts
    trace/
      index.ts
      types.ts
      recorder.ts
      artifactStore.ts
      sqliteStore.ts
      sessionClient.ts
      partParser.ts

  datasets/
    index.ts
    sqlite/
      index.ts
      database.ts
      schema.ts
      stores.ts
      backfill.ts
    dashboard/
      index.ts
      dataStore.ts
      aggregates.ts
      types.ts
      crossDeviceDataStore.ts
      crossDeviceAggregates.ts
      crossDeviceTypes.ts
    humanReview/
      index.ts
      types.ts
      evidenceStore.ts
      recalculation.ts
    humanRating/
      index.ts
      types.ts
      artifactStore.ts
      gapRules.ts
      submission.ts
    ruleViolation/
      index.ts
      statsRebuild.ts

  rules/
    index.ts
    engine/
    evaluators/
    officialCodeLinter/
    evidenceCollector.ts
    ruleEngine.ts
    caseConstraintLoader.ts

  scoring/
    index.ts
    rubricLoader.ts
    scoringEngine.ts
    scoreFusion.ts
    riskTaxonomy.ts
    officialLinterRuleProfiles.ts

  report/
    index.ts
    resultSchemaValidator.ts
    html/
      index.ts
      buildHtmlReportViewModel.ts
      renderHtmlReport.ts

  service/
    index.ts
    remoteTaskService.ts
    localCaseService.ts
    runCaseId.ts

  tools/
    generateCasePatch.ts
    rebuildRuleViolationStats.ts
```

## 目录职责

### `interfaces/`

`interfaces/` 是源码侧接口契约目录。它负责描述外部 HTTP API、请求/响应 schema、callback payload、dashboard API contract 和跨边界类型。

`interfaces/` 不包含 Express handler、service 编排、workflow 调用、数据库读写或 dashboard 聚合实现。

`docs/apis/openapi.yaml` 保持在 `docs/apis/`，不迁移。它继续作为人工阅读文档；源码侧 `src/interfaces/http/*` 和 `src/interfaces/api.d.ts` 负责 TypeScript 契约。

### `commons/`

`commons/` 是运行时代码可以依赖的公共基础能力。它分为三类：

- `commons/types/`：跨多个领域共享、且不是外部 API 专属的类型。
- `commons/utils/`：无业务副作用或低副作用的基础工具函数。
- `commons/io/`：artifact、case loading、日志、下载上传、patch 等基础 IO 能力。

`commons` 不能 import `api`、`workflow`、`agents`、`datasets`、`rules`、`scoring` 或 `report`。

### `api/`

`api/` 负责 HTTP 实现。`app.ts` 负责 Express app 组装，`routes/` 负责路由注册和 handler 组合，`handlers/` 负责人工复核/评级等较复杂 handler，`stores/` 保留 API 层抽象 store 或非 SQLite fallback store。

`api/` 可以依赖 `interfaces`、`service`、`datasets`、`commons`，但不能直接依赖 `workflow/nodes/*`。

### `workflow/`

`workflow/` 表达评分流程本身。

- `graph/`：LangGraph 拓扑、状态、runtime lifecycle、恢复执行。
- `observability/`：workflow 事件、节点 label、节点摘要、stream interpreter。
- `nodes/`：每个 workflow 节点一个目录，内部结构一致。

`workflow/graph/topology.ts` 只 import 节点目录的 `index.ts`。节点之间不能互相 import。

### `agents/`

`agents/` 聚合所有 agent 相关能力。

- `opencode/`：opencode runtime、CLI runner、serve manager、runner pool、sandbox builder。
- `prompts/`：prompt 和 agent payload 构建。
- `runners/`：具体 agent 调用。
- `normalization/`：agent 输出解析、兜底、结果归一化。
- `trace/`：agent run/attempt/event trace 采集、artifact、SQLite trace store。

`agents` 可以依赖 `commons` 和必要的 `interfaces/contracts`，但不能依赖 Express route 或 workflow 节点。

### `datasets/`

`datasets/` 负责持久化数据集、索引、读取、写入和聚合。

- `sqlite/`：SQLite database wrapper、schema、stores、backfill。
- `dashboard/`：dashboard 数据读取、筛选、分页、聚合。
- `humanReview/`：人工复核样本、证据、复算。
- `humanRating/`：人工评级记录、gap 判断、分析产物。
- `ruleViolation/`：规则违反统计重建。

`.local-cases/` 运行产物目录不移动。`datasets/` 只移动源码模块，不改变历史数据位置。

### `rules/`

`rules/` 继续作为独立领域目录存在。它拥有规则包加载、规则引擎、证据采集、evaluator 和官方 Code Linter 适配。

不将 `rules/` 合入 `ruleAuditNode` 或 `officialCodeLinterNode`。节点只是调用规则能力；规则系统本身被多个节点、测试、统计和未来分析能力共享。

### `scoring/`

`scoring/` 继续作为独立领域目录存在。它拥有 rubric 加载、基础评分计算、规则扣分/硬门槛融合、风险 taxonomy 和官方 linter profile。

不将 `scoring/` 合入 `scoreFusionOrchestrationNode`。节点负责在 workflow 中调用评分融合；评分算法本体应保持独立、可测试、可复用。

### `report/`

`report/` 继续作为独立领域目录存在，但范围收窄为报告领域库。它拥有 `result.json` schema 校验、HTML report view model 和 HTML 渲染。

`reportGenerationNode` 调用 report schema 能力，`artifactPostProcessNode` 调用 report HTML 渲染能力。节点不拥有报告渲染领域代码。

### `service/`

`service/` 负责本地 case 和远端任务的业务编排。它可以调用 workflow，但不应包含 HTTP handler 细节，也不直接拥有节点实现。

### `tools/`

`tools/` 是工程内部 TypeScript 工具入口。它用于人工或 npm script 执行的开发/运维任务，例如生成 patch、重建统计索引。

核心业务模块不能 import `src/tools/*`。如果某个工具函数需要被业务模块复用，应将其移动到 `commons`、`datasets`、`rules`、`scoring` 或其他对应领域目录。

## `tools/` 与 `commons/utils/` 区别

`commons/utils/` 是库函数：

- 被运行时代码 import。
- 适合作为稳定基础能力复用。
- 不主动执行 CLI 任务。
- 不承担命令行参数解析、stdout 输出或人工操作入口职责。

`tools/` 是命令入口：

- 由人工、npm script、tsx 或 node 命令执行。
- 可以读取命令行参数、打印输出、写文件、触发重建。
- 可以调用业务库，但业务库不能反向调用 tools。

示例归属：

```text
src/commons/utils/duration.ts          # 格式化耗时，运行时代码可复用
src/commons/utils/ignoredFiles.ts      # 忽略文件判断，运行时代码可复用
src/commons/io/artifactStore.ts        # artifact 基础 IO，运行时代码可复用
src/tools/generateCasePatch.ts         # 人工执行的 patch 生成入口
src/tools/rebuildRuleViolationStats.ts # 人工执行的统计重建入口
```

## `api.d.ts` 设计

新增 `src/interfaces/api.d.ts`，作为源码侧对外 API 契约入口。它导出 HTTP 定义、API path、请求/响应契约和主要外部数据类型。

示例结构：

```ts
export type {
  ApiDefinition,
  ApiMethod,
  ApiRequestDefinition,
  ApiResponseDefinition,
  ApiCallbackDefinition,
} from "./http/apiDefinitions.js";

export { API_DEFINITIONS, API_PATHS } from "./http/apiDefinitions.js";

export type {
  RemoteCallbackPayload,
  RemoteEvaluationTask,
  RemoteExecutionResult,
  RemoteTaskFileManifest,
  RemoteTestCase,
} from "./contracts/remoteTask.js";

export type {
  AgentTraceReport,
  DashboardTaskSummary,
  HumanReviewSubmissionPayload,
  HumanRatingRecord,
  RuleViolationStatsResponse,
} from "./contracts/index.js";
```

约束：

- `api.d.ts` 不导出 service、workflow、node、store、runner、数据库实现。
- `api.d.ts` 不替代 `docs/apis/openapi.yaml`；二者分别服务 TypeScript 契约和人工阅读。
- `web/src/api/*` 后续应只依赖 HTTP API 和契约，不跨入 workflow、agents、datasets 内部实现。

## Workflow 节点规范

每个节点目录必须使用统一结构：

```text
src/workflow/nodes/<node-id>/
  index.ts
  types.ts
  tools.ts
```

`index.ts`：

- 导出节点函数，例如 `remoteTaskPreparationNode`。
- 是 `workflow/graph/topology.ts` 引用该节点的唯一入口。
- 保持节点函数签名和现有行为一致。

`types.ts`：

- 放节点私有 deps、input helper、局部返回结构。
- 不放跨节点共享类型。
- 如果类型被多个节点使用，应移动到 `workflow/graph/state.ts`、`commons/types` 或对应领域目录。

`tools.ts`：

- 放只服务该节点的小工具函数。
- 如果工具被第二个节点使用，应提升到领域目录或 commons。

节点导入规则：

- 节点可以依赖 `commons`、`agents`、`datasets`、`rules`、`scoring`、`report`。
- 节点之间不能互相 import。
- 节点不能 import `api/routes` 或 Express handler。
- `workflow/graph` 只 import 节点 `index.ts`，不 import 节点 `tools.ts`。

## 迁移映射

| 当前文件或目录 | 目标位置 | 说明 |
| --- | --- | --- |
| `src/types.ts` | `src/commons/types/*` 和 `src/interfaces/contracts/*` | 拆分外部契约和内部共享类型。 |
| `src/api/apiDefinitions.ts` | `src/interfaces/http/*` | API path、schema、definition 进入接口契约域。 |
| `src/api/app.ts` | `src/api/app.ts` 和 `src/api/routes/*` | `app.ts` 收窄为 Express 组装。 |
| `src/api/humanReviewHandler.ts` | `src/api/handlers/humanReviewHandler.ts` | HTTP handler 保留在 api。 |
| `src/api/manualRatingHandler.ts` | `src/api/handlers/manualRatingHandler.ts` | HTTP handler 保留在 api。 |
| `src/api/remoteTaskRegistry.ts` | `src/api/stores/remoteTaskRegistry.ts` | API 层非 SQLite registry 抽象或 fallback store。 |
| `src/api/consistencyTaskStore.ts` | `src/api/stores/consistencyTaskStore.ts` | API 层非 SQLite store。 |
| `src/api/ruleViolationStatsStore.ts` | `src/api/stores/ruleViolationStatsStore.ts` | API 层统计 store 抽象和 JSON fallback。 |
| `src/api/ruleViolationStatsRebuild.ts` | `src/datasets/ruleViolation/statsRebuild.ts` | 重建逻辑属于数据集维护。 |
| `src/nodes/*.ts` | `src/workflow/nodes/<node-id>/index.ts` | 每个节点独立目录。 |
| `src/workflow/scoreWorkflow.ts` | `src/workflow/graph/scoreWorkflow.ts`、`topology.ts`、`runtimeLifecycle.ts`、`resume.ts` | 拆分图拓扑和 runtime 编排。 |
| `src/workflow/state.ts` | `src/workflow/graph/state.ts` | graph 状态归 workflow graph。 |
| `src/workflow/observability/*` | `src/workflow/observability/*` | 保留目录，补充 `index.ts`。 |
| `src/agent/*` | `src/agents/prompts/*`、`src/agents/runners/*`、`src/agents/normalization/*` | 按 prompt、runner、normalization 拆分。 |
| `src/opencode/*` | `src/agents/opencode/*` | opencode runtime 是 agent 基础设施。 |
| `src/opencode/finalJson.ts` | `src/commons/utils/finalJson.ts` | JSON 提取是通用工具，不限 opencode。 |
| `src/agentTrace/*` | `src/agents/trace/*` | trace 属于 agent 运行观测。 |
| `src/storage/sqliteDatabase.ts` | `src/datasets/sqlite/database.ts` | SQLite wrapper。 |
| `src/storage/sqliteStores.ts` | `src/datasets/sqlite/stores.ts` | SQLite stores。 |
| `src/storage/sqliteBackfill.ts` | `src/datasets/sqlite/backfill.ts` | SQLite backfill。 |
| `src/dashboard/*` | `src/datasets/dashboard/*` | dashboard 数据读取和聚合属于 datasets。 |
| `src/humanReview/*` | `src/datasets/humanReview/*` | 人工复核数据集处理。 |
| `src/humanRating/*` | `src/datasets/humanRating/*` | 人工评级数据集处理。 |
| `src/io/duration.ts` | `src/commons/utils/duration.ts` | 通用 util。 |
| `src/io/envFile.ts` | `src/commons/utils/envFile.ts` | 通用 util。 |
| `src/io/ignoredFiles.ts` | `src/commons/utils/ignoredFiles.ts` | 通用 util。 |
| `src/io/gitignoreMatcher.ts` | `src/commons/utils/gitignoreMatcher.ts` | 通用 util。 |
| `src/io/artifactStore.ts` | `src/commons/io/artifactStore.ts` | 基础 IO。 |
| `src/io/caseLogger.ts` | `src/commons/io/caseLogger.ts` | 基础 IO。 |
| `src/io/caseLoader.ts` | `src/commons/io/caseLoader.ts` | 基础 IO。 |
| `src/io/downloader.ts` | `src/commons/io/downloader.ts` | 基础 IO。 |
| `src/io/uploader.ts` | `src/commons/io/uploader.ts` | 基础 IO。 |
| `src/io/networkLogger.ts` | `src/commons/io/networkLogger.ts` | 基础 IO。 |
| `src/io/patchGenerator.ts` | `src/commons/io/patchGenerator.ts` | 多处复用的 patch IO 能力。 |
| `src/io/caseArtifactCleanup.ts` | `src/commons/io/caseArtifactCleanup.ts` | case artifact 清理。 |
| `src/service.ts` | `src/service/remoteTaskService.ts` 和 `src/service/localCaseService.ts` | 拆分远端任务和本地 case 编排。 |
| `src/service/runCaseId.ts` | `src/service/runCaseId.ts` | 保留。 |
| `src/tools/*` | `src/tools/*` | 保留为命令入口。 |
| `scripts/*` | `scripts/*` | 部署和外部运维脚本保持根目录。 |

## 依赖方向

允许的主要依赖方向：

```text
index / cli
  -> service
  -> workflow
  -> agents / datasets / rules / scoring / report / commons
  -> commons

api
  -> interfaces / service / datasets / commons

workflow/graph
  -> workflow/nodes / workflow/observability / agents / commons

workflow/nodes
  -> agents / datasets / rules / scoring / report / commons

agents
  -> commons / interfaces/contracts

datasets
  -> commons / interfaces/contracts

rules
  -> commons

scoring
  -> commons / rules

report
  -> commons

tools
  -> service / datasets / rules / scoring / report / commons
```

禁止的依赖方向：

- `commons` import `api`、`workflow`、`agents`、`datasets`、`rules`、`scoring`、`report`。
- `interfaces` import 任何实现模块。
- `api/routes` 直接 import `workflow/nodes/*`。
- `workflow/nodes/*` 互相 import。
- `agents` import Express route、API handler 或 workflow 节点。
- `datasets` import workflow 节点。
- 核心业务模块 import `tools`。

## 重构阶段

### 阶段 1：建立新目录和 facade

- 新增 `interfaces/`、`commons/`、`agents/`、`datasets/`、`workflow/graph/`、`workflow/nodes/` 的目录结构。
- 添加必要的 `index.ts`。
- 在不移动业务逻辑的前提下建立短期 re-export facade。
- 构建通过后再进入实际迁移。

### 阶段 2：迁移接口契约和公共类型

- 将 `src/api/apiDefinitions.ts` 迁移到 `src/interfaces/http/apiDefinitions.ts`。
- 拆分 `src/types.ts`：外部契约进入 `interfaces/contracts/`，内部共享类型进入 `commons/types/`。
- 新增 `src/interfaces/api.d.ts`。
- 更新引用路径，保持导出的类型名和业务含义不变。

### 阶段 3：迁移 commons

- 将通用 util 移动到 `commons/utils/`。
- 将 artifact、case、logger、download/upload、patch 等基础 IO 移动到 `commons/io/`。
- 更新依赖，不改变函数签名和返回值。

### 阶段 4：迁移 workflow graph 和节点

- 将 `src/workflow/scoreWorkflow.ts` 拆到 `workflow/graph/`。
- 将 `src/workflow/state.ts` 移到 `workflow/graph/state.ts`。
- 逐个迁移 `src/nodes/*.ts` 到 `workflow/nodes/<node-id>/index.ts`。
- 对每个节点补齐 `types.ts` 和 `tools.ts`；没有私有类型或工具时保留空导出文件，保持目录形态一致。
- 更新 topology import，只从节点目录 `index.ts` 引入。

### 阶段 5：迁移 agents

- 将 `src/opencode/*` 移入 `agents/opencode/`。
- 将 `src/agent/*` 按 prompt、runner、normalization 拆入 `agents/`。
- 将 `src/agentTrace/*` 移入 `agents/trace/`。
- 保持 opencode runner、trace recorder、agent result 类型的对外使用语义不变。

### 阶段 6：迁移 datasets

- 将 `src/storage/*` 移入 `datasets/sqlite/`。
- 将 `src/dashboard/*` 移入 `datasets/dashboard/`。
- 将 `src/humanReview/*` 移入 `datasets/humanReview/`。
- 将 `src/humanRating/*` 移入 `datasets/humanRating/`。
- 将规则违反统计重建逻辑移入 `datasets/ruleViolation/`。
- API route 通过 datasets facade 读取和写入数据。

### 阶段 7：收敛 API 和 service

- 将 `src/api/app.ts` 收窄为 Express app 组装。
- 将 route handler 组合拆入 `src/api/routes/*`。
- 将本地 case 与远端 task 编排从 `src/service.ts` 拆到 `src/service/localCaseService.ts` 和 `src/service/remoteTaskService.ts`。
- 保持 `src/index.ts`、`src/cli.ts` 的对外运行方式不变。

### 阶段 8：清理旧路径并更新文档

- 删除短期 re-export facade。
- 确认不存在旧目录 import。
- 更新 `docs/ARCHITECTURE.md` 的目录结构和模块边界描述。
- 保持 `docs/apis/openapi.yaml` 在原位置。

## 测试和验收

基础验收：

- `npm run build` 通过。
- `npm test` 通过。
- `npm run lint` 通过，或明确记录当前已有 lint 问题，且本次重构不引入新增 lint 问题。

重点测试：

- `tests/score-workflow-topology.test.ts`
- `tests/local-cli.test.ts`
- `tests/remote-network-execution.test.ts`
- `tests/dashboard-api.test.ts`
- `tests/agent-trace.test.ts`
- `tests/agent-trace-dashboard-api.test.ts`
- `tests/sqlite-storage.test.ts`
- `tests/human-review-ingestion.test.ts`
- `tests/human-rating-manual-api.test.ts`
- `tests/rule-engine.test.ts`
- `tests/scoring.test.ts`
- `tests/score-fusion.test.ts`
- `tests/report-renderer.test.ts`

行为验收：

- 主 workflow 节点顺序和并行关系不变。
- 远端任务 API path、payload、callback 行为不变。
- dashboard API 查询结果结构不变。
- `result.json` schema 和 HTML report 输出语义不变。
- agent prompt 文本语义不变。
- SQLite schema 语义不变。
- `.local-cases/` 下历史任务仍可被 dashboard 和结果接口读取。

结构验收：

- `src/types.ts` 不再作为巨型类型入口存在。
- `src/nodes/` 不再存在。
- `src/opencode/`、`src/agent/`、`src/agentTrace/` 不再作为根级分散目录存在。
- `src/storage/`、`src/dashboard/`、`src/humanReview/`、`src/humanRating/` 不再作为根级分散数据目录存在。
- 每个 workflow 节点目录都包含 `index.ts`、`types.ts`、`tools.ts`。
- `src/interfaces/api.d.ts` 存在并只导出接口契约。
- `docs/apis/openapi.yaml` 保持原位置。

## 风险和控制

### 大量路径迁移导致 import 错误

控制方式：

- 分阶段迁移，每阶段运行 `npm run build`。
- 优先建立 facade，再批量更新 import。
- 每阶段只迁移一个领域，避免一次性移动所有目录。

### 行为被无意改写

控制方式：

- 移动文件时保持函数名、类型名、返回值和异常行为不变。
- 不在迁移提交中修改算法、prompt、schema 或阈值。
- 通过现有测试锁定 workflow、API、agent、dashboard、SQLite 和 report 行为。

### 新目录再次变成杂物桶

控制方式：

- 使用依赖方向规则约束 import。
- 节点私有工具只留在节点目录，被复用时提升到领域目录。
- `commons` 只放基础设施和公共类型，不放业务编排。
- `tools` 只放命令入口，不被业务模块 import。

### OpenAPI 文档与源码契约分离后不一致

控制方式：

- `docs/apis/openapi.yaml` 保持人工阅读来源。
- `src/interfaces/http/*` 保持 TypeScript 契约来源。
- 后续接口变更必须同时更新 OpenAPI 文档和 TypeScript 契约；本次重构不改变接口内容。

## 完成状态定义

本次结构重构完成时，应满足：

- 工程根级源码目录能清晰表达 API、workflow、agents、datasets、rules、scoring、report、commons、service、tools 的边界。
- workflow 拓扑和节点实现分离。
- 每个 workflow 节点拥有一致的目录结构。
- API 契约和 HTTP 实现分离，并存在 `src/interfaces/api.d.ts`。
- 公共类型和工具不再散落在根级 `types.ts`、`io/` 或节点文件中。
- agent 相关实现聚合到 `src/agents/`。
- 数据库和数据集相关实现聚合到 `src/datasets/`。
- `rules/`、`scoring/`、`report/` 作为独立领域库保留。
- `tools/` 和 `commons/utils/` 的职责区分清晰。
- 所有验证命令通过，且没有业务行为变化。
