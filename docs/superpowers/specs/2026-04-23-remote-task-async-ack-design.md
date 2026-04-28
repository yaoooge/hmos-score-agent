# Remote Task Async Acknowledgement Design

## Goal

调整 `POST /score/run-remote-task` 的接口语义：在完成远端任务预处理、初始任务分析、并将任务落到本地评分目录后立即返回“任务接收成功”；完整评分结果不再阻塞 HTTP 响应，而是通过任务自带的 `callback` 异步回传。

## Current State

- [`src/index.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/index.ts) 的 `createRunRemoteTaskHandler()` 直接 `await runRemoteEvaluationTask()`。
- [`src/service.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/service.ts) 的 `runRemoteEvaluationTask()` 会同步执行完整 workflow、等待 callback 上传完成、再向 HTTP 层返回结果。
- 远端任务预处理在 [`src/nodes/remoteTaskPreparationNode.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/remoteTaskPreparationNode.ts) 中完成，初始任务分析在 [`src/nodes/taskUnderstandingNode.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/taskUnderstandingNode.ts) 中完成，任务类型判定在 [`src/nodes/inputClassificationNode.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/nodes/inputClassificationNode.ts) 中完成。

## Scope

### In Scope

- 将远端接口改为“同步接收 + 异步执行”两阶段。
- 同步阶段覆盖：
  - 创建 `caseDir`
  - 下载原始工程 / workspace / patch
  - 物化标准 case
  - 执行初始任务分析
  - 执行任务类型判定
- 同步阶段失败时，接口返回 `500`。
- 同步阶段成功时，接口立即返回成功响应。
- 后续完整评分继续在后台执行，并通过 `callback` 回传 `completed` 或 `failed`。
- 更新测试与 README 文档。

### Out of Scope

- 不引入数据库、消息队列、任务查询接口或任务状态持久化表。
- 不改变 `callback` payload 结构。

## Required Behavior

### HTTP Success Path

`POST /score/run-remote-task` 的同步成功定义为：

1. 请求体被 service 接收。
2. `remoteTaskPreparationNode` 成功完成。
3. `taskUnderstandingNode` 成功完成。
4. `inputClassificationNode` 成功完成。
5. 本地评分目录与初始元数据已写入。

满足以上条件后，接口立即返回 `200`，响应体包含：

```json
{
  "success": true,
  "taskId": 4,
  "caseDir": "/abs/path/.local-cases/full_generation_xxx",
  "message": "任务接收成功，结果将通过 callback 返回"
}
```

接口不再等待：

- 后续 rule audit / rubric scoring / report generation
- callback 上传成功
- 临时目录清理完成

### HTTP Failure Path

以下任一情况都属于同步失败，接口返回 `500`：

- 远端目录清单下载失败
- patch 下载失败
- case 物化失败
- 初始任务分析失败
- 任务类型判定失败
- 同步阶段元数据写入失败

此时不返回“任务接收成功”。

### Callback Path

HTTP 已返回成功后，后台继续执行评分：

- 成功时：向 `callback` 上传 `status: "completed"`
- 失败时：向 `callback` 上传 `status: "failed"`

规则保持不变：

- `token` 仍通过 header 传递
- `maxScore` 固定为 `100`
- `totalScore` 仍从 `resultData.overall_conclusion.total_score` 提取

## Architecture

### Service Split

当前单体 `runRemoteEvaluationTask()` 拆成两个阶段：

1. `prepareRemoteEvaluationTask(remoteTask)`
   - 创建 `caseDir`
   - 写初始 `case-info.json`
   - 运行：
     - `remoteTaskPreparationNode`
     - `taskUnderstandingNode`
     - `inputClassificationNode`
   - 返回一个“已接收任务上下文”，供后台继续执行

2. `executeAcceptedRemoteEvaluationTask(preparedTask)`
   - 从 `ruleAuditNode` 开始继续 workflow
   - 完成评分、落盘、callback、清理临时目录

保留 `runRemoteEvaluationTask()` 作为兼容入口，但其内部语义调整为：

- 先调用 `prepareRemoteEvaluationTask()`
- 再调用 `executeAcceptedRemoteEvaluationTask()`

这样测试和 CLI 仍可使用同步入口，而 HTTP handler 则可以只同步等待 `prepareRemoteEvaluationTask()`，随后将执行阶段放入后台 promise。

### Workflow Split

现有 [`src/workflow/scoreWorkflow.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/workflow/scoreWorkflow.ts) 只支持从 `remoteTaskPreparationNode` 或完整 `caseInput` 开始执行。为支持新语义，需要新增“从已完成初始分析状态继续执行”的入口。

推荐方式：

- 保留现有 `runScoreWorkflow()` 不变，继续服务本地 case 和同步远端执行。
- 新增 `runPreparedScoreWorkflow()`：
  - 初始状态直接携带：
    - `caseInput`
    - `sourceCasePath`
    - `remoteTaskRootDir`
    - `effectivePatchPath`
    - `constraintSummary`
    - `caseRuleDefinitions`
    - `taskType`
    - `caseDir`
    - `inputMode`
    - `originalFileCount`
    - `workspaceFileCount`
    - `hasPatch`
  - 图起点改为 `ruleAuditNode`

这样不会重复下载软件包，也不会重复执行初始任务分析。

## Data Contract

新增一个 service 内部的“已接收任务上下文”结构，用于在同步响应之后继续执行：

```ts
type AcceptedRemoteEvaluationTask = {
  taskId: number;
  caseDir: string;
  remoteTask: RemoteEvaluationTask;
  workflowState: Pick<
    ScoreGraphState,
    | "caseInput"
    | "sourceCasePath"
    | "remoteTaskRootDir"
    | "effectivePatchPath"
    | "constraintSummary"
    | "caseRuleDefinitions"
    | "taskType"
    | "inputMode"
    | "originalFileCount"
    | "workspaceFileCount"
    | "hasPatch"
    | "caseDir"
  >;
};
```

该结构只在 service 层使用，不暴露到 HTTP contract。

## Error Handling

### Synchronous Errors

- `prepareRemoteEvaluationTask()` 抛错时，handler 返回 `500`
- 不启动后台执行
- 不上传 `callback`
- 如已创建远端临时目录，应在同步失败路径中清理

### Asynchronous Errors

- `executeAcceptedRemoteEvaluationTask()` 抛错时：
  - 记录错误日志
  - 尝试向 `callback` 上传 `failed`
  - 清理远端临时目录
- 后台 promise 中的异常必须被显式捕获，避免未处理 Promise Rejection

## Logging And Artifacts

- 同步阶段仍写入 `inputs/case-info.json`
- 同步阶段完成后，将已知字段写回 `case-info.json`：
  - `source_case_path`
  - `task_type`
  - `original_project_path`
  - `generated_project_path`
  - `patch_path`
- 结果文件、HTML 报告、callback 日志继续在异步阶段产生

## Testing

需要新增或更新以下验证：

1. 接口在预处理成功后立即返回成功响应，不等待 callback。
2. callback 仍在后台异步完成，并包含原有 payload。
3. 预处理下载失败时，接口返回 `500`。
4. 预处理失败时，不会返回“任务接收成功”。
5. 同步 `runRemoteEvaluationTask()` 入口仍然可以执行完整链路，避免已有测试退化。

## Risks

- 如果后台执行完全脱离请求生命周期，必须显式捕获异常，否则 Node 进程可能出现未处理 rejection。
- 如果同步阶段和异步阶段分别写 `case-info.json`，字段更新顺序必须稳定，避免把已写入的路径信息覆盖回 `null`。
- 如果继续沿用完整 workflow 而不拆分起点，会重复下载远端包并重复执行任务分析，既浪费时间也破坏“预处理完成即返回”的语义。
