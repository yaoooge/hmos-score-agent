# 远端评分任务重启恢复设计

## 背景

当前 `POST /score/run-remote-task` 接收远端评分任务后，会在进程内维护两个执行态结构：

- `runningTaskIds`：正在占用并发槽位的任务。
- `pendingRemoteTaskExecutions` / `queuedTaskIds`：等待执行槽位的任务。

`src/api/remoteTaskRegistry.ts` 已经把任务简要状态写入 `<LOCAL_CASE_ROOT>/remote-task-index.json`，但该记录只包含 `taskId`、`status`、`caseDir`、`token`、用例摘要和错误信息。它不足以在服务重启后重建 `AcceptedRemoteEvaluationTask`，也没有启动时扫描和恢复逻辑。

部署脚本会通过 `systemctl restart hmos-score-agent.service` 重启服务。重启会清空内存队列，导致 `queued` 和 `running` 任务不会继续执行，也不会补发最终 callback。

## 目标

- 服务重启后恢复非终态远端任务，包括 `preparing`、`queued`、`running`。
- 恢复时先检查本地结果文件；如果 `outputs/result.json` 已存在，补发 `completed` callback 并将任务标记为 `completed`。
- 如果结果文件不存在，使用持久化的原始远端请求重新入队执行。
- 恢复任务继续遵守现有最大并发限制。
- 保持 `POST /score/run-remote-task` 的 HTTP 响应协议和 callback payload 协议不变。
- 不引入外部数据库、消息队列或多实例调度系统。

## 非目标

- 不支持从 workflow 中间节点精确续跑。
- 不保证 agent 调用、下载、静态分析等步骤在重启后不会重复执行。
- 不恢复已标记为 `completed` 或 `failed` 的终态任务。
- 不解决多进程或多实例同时消费同一个 `LOCAL_CASE_ROOT` 的分布式锁问题。
- 不修改本地 CLI 评分流程。

## 当前相关代码

- `src/api/app.ts`：`createRunRemoteTaskHandler` 维护内存队列、并发槽位和任务状态更新。
- `src/api/remoteTaskRegistry.ts`：将远端任务索引保存到 `remote-task-index.json`。
- `src/service.ts`：定义 `AcceptedRemoteEvaluationTask`，执行远端任务、上传 callback、写入结果。
- `src/nodes/remoteTaskPreparationNode.ts`：将 `RemoteEvaluationTask` 下载并物化为本地 case。
- `src/workflow/scoreWorkflow.ts`：支持从完整远端任务或 prepared state 启动 workflow。
- `src/config.ts`：提供 `localCaseRoot` 和远端任务相关配置。

## 设计选择

采用“持久化原始远端请求 + 启动恢复扫描”的方案。

完整 prepared workflow state 当前依赖 `remoteTaskRootDir`，该目录由 `fs.mkdtemp(os.tmpdir())` 创建在系统临时目录下。服务重启后该路径不可靠，直接保存 prepared state 并从中间流程继续执行会引入更多边界问题。因此恢复时不依赖临时目录，而是保存完整 `RemoteEvaluationTask`，需要重开时重新执行预处理和评分。

为减少重复评分，恢复流程先看本地结果：

```text
service startup
  -> load remote-task-index.json
  -> find preparing / queued / running records
  -> if <caseDir>/outputs/result.json exists
       -> send completed callback from local result
       -> mark completed
     else if persisted remoteTask exists
       -> rebuild accepted task and enqueue execution
     else
       -> mark failed with recovery error
```

## 持久化数据

扩展 `RemoteTaskRecord`：

```ts
type RemoteTaskRecord = {
  taskId: number;
  status: RemoteTaskRecordStatus;
  createdAt: number;
  updatedAt: number;
  caseDir?: string;
  token?: string;
  testCaseId?: number;
  testCaseName?: string;
  testCaseType?: string;
  error?: string;
  remoteTask?: RemoteEvaluationTask;
  recoveryAttemptCount?: number;
  lastRecoveryAt?: number;
};
```

`remoteTask` 保存完整请求体，包括 `callback`、`token`、`testCase` 和 `executionResult`。这是重启后重新下载、重新物化 case、重新执行评分所需的最小可靠输入。

兼容旧索引文件：

- 读取旧记录时允许没有 `remoteTask`、`recoveryAttemptCount`、`lastRecoveryAt`。
- 旧记录如果处于非终态但没有 `remoteTask`，恢复流程无法重开，标记为 `failed`，`error` 写入 `missing persisted remoteTask payload`。
- 保存时仍使用临时文件加 rename 的原子写入方式。

## 队列管理

把当前 `createRunRemoteTaskHandler` 内部的队列状态提取为进程内队列控制器，例如 `createRemoteTaskExecutionQueue`。它负责：

- 保存 `runningTaskIds`、`queuedTaskIds`、`pendingRemoteTaskExecutions`。
- 统一执行 `enqueueRemoteTaskExecution`、`scheduleRemoteTaskExecutions`、`executeRemoteTask`。
- 统一写 registry 状态。
- 暴露 `recoverPendingRemoteTasks()` 给 `createApp()` 启动后调用。

HTTP handler 只负责：

1. 读取请求。
2. 调用 `acceptRemoteEvaluationTask` 创建初始 `caseDir`。
3. 将完整 `remoteTask` 写入 registry。
4. 调用队列控制器入队。
5. 返回任务接收成功响应。

恢复流程和新请求共用同一个队列控制器，因此并发限制、完成后统计写入、失败状态更新保持一致。

## 启动恢复流程

`createApp()` 创建 registry、规则统计 store、human review store 和队列控制器后，触发一次异步恢复：

```text
void queue.recoverPendingRemoteTasks().catch(log)
```

恢复只处理：

- `preparing`
- `queued`
- `running`

恢复不阻塞 `/health` 和服务启动。恢复过程中的错误必须被捕获并写日志，不能形成未处理 Promise rejection。

### 已有结果补发

如果记录满足：

- `status` 是非终态。
- `caseDir` 存在。
- `<caseDir>/outputs/result.json` 可读取。
- `remoteTask` 存在。

则恢复流程读取 `result.json`，构造与正常完成路径一致的 completed callback：

- `taskId`
- `status: "completed"`
- `success: true`
- `totalScore`
- `maxScore`
- `resultData` 使用当前 `buildCompletedRemoteResultData` 的轻量结果结构。

callback 上传完成后，registry 标记为 `completed`。如果 callback 上传失败，恢复流程记录错误日志，将 registry 标记为 `failed` 并写入错误原因，避免后续每次启动都重复补发同一个 completed callback。

### 缺结果重开

如果没有 `outputs/result.json`，但 `remoteTask` 存在：

- 将该记录视为上一个进程中断。
- 不复用旧的 `remoteTaskRootDir`。
- 基于持久化 `remoteTask` 重新构造 `AcceptedRemoteEvaluationTask`：
  - `taskId` 使用原任务 ID。
  - `caseDir` 可以复用记录里的 `caseDir`，用于日志和索引连续性。
  - `workflowState` 从 `{ stage: "accepted", caseDir }` 开始，让 `executeAcceptedRemoteEvaluationTask` 内部重新运行 `prepareAcceptedRemoteEvaluationTask`。
- 重新入队执行。

为避免旧 `caseDir` 中残留的半成品文件影响新结果，恢复重开时应在 workflow 写入结果前覆盖最终输出；必要时仅清理已知中间产物，不删除整个 `caseDir`，以保留历史日志和接收元数据。

## 状态语义

状态恢复规则：

| 启动前状态 | 有 result.json | 有 remoteTask | 恢复动作 |
| --- | --- | --- | --- |
| preparing | 是 | 是 | 补发 completed，标记 completed |
| queued | 是 | 是 | 补发 completed，标记 completed |
| running | 是 | 是 | 补发 completed，标记 completed |
| preparing | 否 | 是 | 重新入队执行 |
| queued | 否 | 是 | 重新入队执行 |
| running | 否 | 是 | 重新入队执行 |
| preparing/queued/running | 任意 | 否 | 标记 failed |
| completed/failed/timed_out | 任意 | 任意 | 不处理 |

恢复入队时可以先把状态写为 `queued`，真正进入执行槽位后写为 `running`。

## 幂等与重复回调

本设计的边界：

- 单实例 systemd 重启场景下，旧进程应先停止，新进程再启动；不额外做跨进程文件锁。
- `completed` 记录不再恢复，避免重复补发完成 callback。
- 非终态且已经有 `result.json` 的任务会补发一次 completed callback，这是为了修复“结果已落盘但进程在完成回调或状态更新前重启”的情况。
- 非终态且没有结果的任务会重新执行，可能重复下载和重复调用评分 agent，但最终仍只会通过 registry 进入一个当前进程内的执行队列。

## 错误处理

- registry 读取失败：记录错误日志，恢复流程终止，不影响 HTTP 服务启动。
- 单条记录恢复失败：该记录标记 `failed`，`error` 写入失败原因，继续处理其他记录。
- 缺少 `remoteTask`：标记 `failed`。
- result.json 解析失败：按没有可用完成结果处理；如果有 `remoteTask` 则重新执行，否则标记 `failed`。
- callback 补发失败：记录错误并标记 `failed`，避免启动后无限重复补发。

## 测试计划

新增或更新测试覆盖：

1. `RemoteTaskRegistry` 能持久化并重新读取 `remoteTask`、`recoveryAttemptCount`、`lastRecoveryAt`。
2. 启动恢复遇到 `running + result.json + remoteTask` 时补发 `completed` callback，并标记 `completed`，不调用执行函数。
3. 启动恢复遇到 `queued + 无 result.json + remoteTask` 时重新入队执行。
4. 启动恢复遇到 `running + 无 remoteTask` 时标记 `failed`。
5. 多个恢复任务和新请求共用并发限制，最多同时执行 3 个。
6. 恢复流程异常被捕获，不产生未处理 Promise rejection。

## 部署影响

不需要新增外部依赖或服务。`remote-task-index.json` 会变大，因为它保存完整远端请求体。远端请求体主要是 URL、prompt 和元数据，不包含下载后的工程文件，体积可控。

上线后，只有新接收的任务具备完整 `remoteTask`，历史旧索引中的非终态任务如果缺少该字段将无法恢复，会被标记为 `failed`。
