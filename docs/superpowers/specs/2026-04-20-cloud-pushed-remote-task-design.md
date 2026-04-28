# Cloud-Pushed Remote Task Design

## Goal

本地启动评分服务端口后，对外暴露一个可由云端管理台工程直接调用的 HTTP 接口。云端以下发 `RemoteEvaluationTask` 请求体的方式触发评分。本地服务在 workflow 最前面增加一个前置节点，将请求体转换为标准 case 数据，再复用现有评分链路执行，并在结束后将结果上报到任务中的 `callback` URL。

## Current State

- 系统已有 `RemoteEvaluationTask`、目录清单下载、callback 上传等基础能力。
- 当前远端执行思路依赖“本地主动拉取任务”的 `downloadUrl` 模式，这与真实场景不一致。
- 当前 workflow 只接受 `CaseInput`，远端任务转 case 的职责不在 workflow 内，导致输入收口不统一。

## Scope

### In Scope

- 新增一个云端可直接调用的本地 HTTP 接口，接收 `RemoteEvaluationTask` 请求体。
- 在 workflow 最前面增加 `remoteTaskPreparationNode`，负责将远端任务转换为 case。
- 将转换后的 case 送入现有评分节点执行。
- 评分结束后向 `callback` URL 上报成功或失败结果。
- 删除旧的 `downloadUrl` 拉取式远端入口和对应文档。

### Out of Scope

- 不引入任务轮询、消息队列、定时拉取等机制。
- 不新增数据库或任务持久化表。
- 不重写现有评分节点逻辑。
- 不修改云端下发任务的数据结构。

## Remote Contract

本地服务新增接口后，云端管理台调用时直接传入以下结构：

```json
{
  "taskId": 4,
  "testCase": {
    "id": 8,
    "name": "remote-case",
    "type": "requirement",
    "description": "新增登录页",
    "input": "请实现登录页并接入路由",
    "expectedOutput": "页面可正常跳转",
    "fileUrl": "https://example.com/original.json"
  },
  "executionResult": {
    "isBuildSuccess": true,
    "outputCodeUrl": "https://example.com/workspace.json",
    "diffFileUrl": "https://example.com/changes.patch"
  },
  "token": "remote-token",
  "callback": "https://example.com/api/evaluation-tasks/callback"
}
```

该结构与现有 `RemoteEvaluationTask` interface 保持一致。

## Architecture

### API Layer

- 新增 `POST /score/run-remote-task`
- 请求体直接是 `RemoteEvaluationTask`
- handler 不负责手动拼 case，只负责把请求体交给 service 层统一执行

### Service Layer

service 层保留两类执行入口：

- `runSingleCase(casePath)`：本地 case
- `runRemoteEvaluationTask(remoteTask)`：云端直推任务

service 层职责限定为：

- 创建 `.local-cases/<runId>` 结果目录
- 调用 workflow
- 根据结果向 `callback` 上报 `completed` 或 `failed`
- 清理 workflow 前置节点生成的系统临时 case 目录

service 层不再持有“远端任务转 case”的主逻辑。

### Workflow Layer

workflow 新增前置节点：

- `remoteTaskPreparationNode`

节点位置：

```text
START -> remoteTaskPreparationNode -> taskUnderstandingNode -> inputClassificationNode -> ...
```

节点职责：

1. 如果输入已经是本地 `caseInput`，直接透传。
2. 如果输入是 `remoteTask`：
   - 创建系统临时目录
   - 生成标准 case 目录
   - 下载 `original/`
   - 下载 `workspace/`
   - 可选写入 `diff/changes.patch`
   - 生成 `input.txt`
   - 调用 `loadCaseFromPath()` 转成 `CaseInput`
3. 输出 `caseInput`、`sourceCasePath`、`remoteTaskRootDir` 给后续节点和 service 层。

## Data Mapping

远端请求体转换为本地 case 的规则如下：

- `testCase.description` -> `input.txt` 中的“任务描述”段落
- `testCase.input` -> `input.txt` 中的“输入要求”段落
- `testCase.expectedOutput` -> `input.txt` 中的“期望输出”段落
- `testCase.fileUrl` -> 下载目录清单后物化到 `original/`
- `executionResult.outputCodeUrl` -> 下载目录清单后物化到 `workspace/`
- `executionResult.diffFileUrl` -> 若存在，下载文本写入 `diff/changes.patch`

`input.txt` 拼接规则：

- 空字段跳过
- 非空字段按双换行分隔

临时目录示例：

```text
/tmp/hmos-remote-task-abcd1234/remote-task-4/
  input.txt
  original/
  workspace/
  diff/changes.patch
```

然后通过 `loadCaseFromPath()` 得到：

- `caseInput`
- `sourceCasePath`

这样从 `taskUnderstandingNode` 开始，后续节点无需关心任务来源。

## Callback Behavior

workflow 成功完成后，service 向 `callback` 发起 `POST` 请求：

- Header: `token: <token>`
- Body:

```json
{
  "taskId": 4,
  "status": "completed",
  "totalScore": 85,
  "maxScore": 100,
  "resultData": {
    "overall_conclusion": {
      "total_score": 85
    }
  }
}
```

失败时：

```json
{
  "taskId": 4,
  "status": "failed",
  "totalScore": 0,
  "maxScore": 100,
  "resultData": {
    "error": "Invalid remote manifest from ..."
  }
}
```

规则：

- `status` 只有 `completed` 和 `failed`
- `totalScore` 成功时从 `resultData.overall_conclusion.total_score` 提取
- `maxScore` 固定为 `100`
- callback 上传逻辑继续留在 service 层，不进入 workflow

## State Changes

为支持该模式，workflow state 需要新增：

- `remoteTask?: RemoteEvaluationTask`
- `sourceCasePath?: string`
- `remoteTaskRootDir?: string`

`runScoreWorkflow()` 需要支持两类输入：

```ts
type ScoreWorkflowInput =
  | {
      caseInput: CaseInput;
      sourceCasePath: string;
      caseDir: string;
      referenceRoot: string;
      artifactStore: ArtifactStore;
      uploadEndpoint?: string;
      uploadToken?: string;
      agentClient?: AgentClient;
    }
  | {
      remoteTask: RemoteEvaluationTask;
      caseDir: string;
      referenceRoot: string;
      artifactStore: ArtifactStore;
      uploadEndpoint?: string;
      uploadToken?: string;
      agentClient?: AgentClient;
    };
```

约束：

- 进入 `taskUnderstandingNode` 前，`caseInput` 必须存在
- 若 `caseInput` 和 `remoteTask` 都缺失，则 workflow 直接失败

## API Shape

### Add

- `POST /score/run-remote-task`

说明：

- 云端管理台直接调用
- 请求体即 `RemoteEvaluationTask`

### Remove

- 删除旧的 `POST /score/run-remote`
- 删除所有 `downloadUrl` 拉取式远端执行描述与实现

## Error Handling

### Request Validation

- 请求体缺少关键字段时，接口返回失败
- 不进入 workflow

### Preparation Failure

- 下载资源失败
- 目录清单格式非法
- 无法物化 case 目录

以上都视为 workflow 前置节点失败，由 service 统一回调 `failed`

### Workflow Failure

- 任意评分节点抛错时，service 统一回调 `failed`

### Callback Failure

- 如果 callback 上报失败：
  - 接口返回失败
  - `.local-cases/<runId>` 保留
  - workflow 前置节点生成的系统临时 case 目录清理掉

## Observability

新增 workflow 节点观测信息：

- node id: `remoteTaskPreparationNode`
- 中文标签：`远端任务预处理`

建议节点摘要：

- 本地模式：`mode=local passthrough=true`
- 远端模式：`mode=remote originalFiles=12 workspaceFiles=14 hasPatch=true`

这样能在 workflow 事件日志里快速区分：

- 当前任务来源
- 下载物化是否完成
- patch 是否存在

## Testing

### Node Tests

- `remoteTaskPreparationNode` 本地透传
- `remoteTaskPreparationNode` 远端任务转 case
- patch 可选
- 非法 manifest 报错

### Service Tests

- `runRemoteEvaluationTask(remoteTask)` 成功后回调 `completed`
- workflow 失败后回调 `failed`
- callback 失败时接口返回失败

### API Tests

- `POST /score/run-remote-task` 正常接收 `RemoteEvaluationTask`
- 缺少关键字段时失败

### Regression

- 本地 CLI case 执行
- `npm run build`

## Acceptance Criteria

- 本地服务启动后，对外暴露固定 URL 的远端评分接口
- 云端管理台可以直接向本地接口下发 `RemoteEvaluationTask`
- workflow 会先执行 `remoteTaskPreparationNode`
- 前置节点能够将请求体转换为标准 case 与 `CaseInput`
- 现有评分链路保持可用
- 成功时会向 `callback` 上报 `completed`
- 失败时会向 `callback` 上报 `failed`
- `.local-cases/<runId>` 中保留日志和评分产物
- 旧的 `downloadUrl` 远端模式被彻底删除

## Summary

这次改动的核心不是新增一条“远端执行旁路”，而是让云端直推任务成为 workflow 的正式输入模式。通过在 workflow 最前面增加 `remoteTaskPreparationNode`，可以把远端任务统一收敛为标准 case，再复用既有评分链路和结果上报逻辑。
