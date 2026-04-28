# 远端用例完成结果轻量回调与结果访问接口设计

## 背景

远端用例任务当前通过 `POST /score/run-remote-task` 接收后异步执行。执行过程中会多次调用远端传入的 `callback`，其中未完成状态包括 `pending`、`running`，完成状态为 `completed`，失败状态为 `failed`。

当前 completed callback 的 `resultData` 会直接携带完整 `workflowResult.resultJson`。当最终 `result.json` 较大时，callback body 会变长，可能触发远端服务、网关、日志系统或数据库字段长度限制。完整评分结果已经在本地落盘到：

```text
<caseDir>/outputs/result.json
```

因此不需要在 completed callback 中继续内联完整 JSON。更小的改动是：仅在任务完成时将 callback 改为轻量结果概要；完整 JSON 通过一个固定结果接口按需读取。

## 目标

- 未完成状态 callback 行为保持不变，包括 `pending`、`running` 阶段的调用时机、状态值和现有 `resultData` 内容。
- completed callback 不再内联完整 `result.json`，改为回传概要信息。
- 新增一个结果访问接口，用于外部读取完整结果 JSON。
- 结果访问接口的响应字段兼容当前 callback 的 `resultData` 字段，即外部可以从响应中拿到等价于旧 completed callback `resultData` 的完整结果对象。
- 暂不新增任务状态查询、artifact 列表、报告下载等其他接口。
- 新增一个统一接口定义文件，集中声明当前服务已开放接口和后续新增接口，方便开发者查看和维护。

## 非目标

- 不修改 `POST /score/run-remote-task` 的请求协议。
- 不修改 `pending`、`running`、`failed` callback 的语义和调用次数。
- 不修改 `result.json` schema。
- 不引入对象存储、预签名 URL 或外部上传流程。
- 不新增远端任务列表、任务状态查询、HTML 报告下载、日志下载接口。
- 不在 callback 或结果接口中暴露本地绝对路径。

## 当前相关代码

- `src/api/app.ts`：`createRunRemoteTaskHandler` 接收远端任务、维护内存任务记录并触发异步执行。
- `src/service.ts`：`buildRemoteCallbackPayload` 组装 callback payload；`executeAcceptedRemoteEvaluationTask` 在 completed 阶段传入完整 `workflowResult.resultJson`。
- `src/nodes/persistAndUploadNode.ts`：将完整结果写入 `outputs/result.json`。
- `src/types.ts`：定义 `RemoteCallbackPayload`。

## 总体设计

最小化落地后的链路如下：

```text
remote task accepted
  -> pending callback: unchanged
  -> running callback: unchanged
  -> workflow writes outputs/result.json
  -> completed callback: lightweight overview
  -> remote system GET /score/remote-tasks/:taskId/result when full JSON is needed
  -> result endpoint reads outputs/result.json and returns it as resultData
```

只有 completed callback 改变 `resultData` 内容。未完成状态 callback 不做协议调整，避免影响远端当前进度展示和状态处理。

## 接口设计

### 获取完整结果

新增接口：

```http
GET /score/remote-tasks/:taskId/result
```

请求头：

```http
token: <remoteTask.token>
Accept: application/json
```

`token` 使用远端任务请求中原有的 `remoteTask.token`。不通过 query 参数传 token，避免 URL 进入日志或浏览器历史。

成功响应：

```json
{
  "success": true,
  "taskId": 123,
  "status": "completed",
  "resultData": {
    "basic_info": {},
    "overall_conclusion": {},
    "dimension_results": [],
    "risks": [],
    "strengths": [],
    "main_issues": [],
    "human_review_items": [],
    "final_recommendation": "",
    "rule_audit_results": [],
    "case_rule_results": [],
    "report_meta": {
      "report_file_name": "report.html",
      "result_json_file_name": "result.json",
      "unit_name": "remote-case",
      "generated_at": "2026-04-28T10:20:30.000Z"
    }
  }
}
```

兼容性要求：

- `resultData` 必须是完整 `outputs/result.json` 的 JSON object。
- `resultData` 的字段保持旧 completed callback 中 `resultData` 的语义；旧消费方从 callback body 迁移到结果接口后，只需要把读取来源从 callback 的 `body.resultData` 改为结果接口的 `body.resultData`。
- 不对 `resultData` 再套一层额外业务字段，避免破坏旧结构。

### 错误响应

鉴权失败：

```http
401 Unauthorized
```

```json
{
  "success": false,
  "message": "Unauthorized"
}
```

任务不存在：

```http
404 Not Found
```

```json
{
  "success": false,
  "taskId": 123,
  "message": "Remote task not found"
}
```

任务未完成：

```http
409 Conflict
```

```json
{
  "success": false,
  "taskId": 123,
  "status": "running",
  "message": "Result is not available yet"
}
```

结果文件缺失：

```http
404 Not Found
```

```json
{
  "success": false,
  "taskId": 123,
  "status": "completed",
  "message": "Result file not found"
}
```

## completed callback 设计

completed callback 顶层继续保持当前 `RemoteCallbackPayload` 结构：

```json
{
  "taskId": 123,
  "status": "completed",
  "totalScore": 86,
  "maxScore": 100,
  "resultData": {}
}
```

变更点只在 completed 状态的 `resultData`。新的 completed `resultData` 不再是完整 `result.json`，而是轻量信息：

```json
{
  "phase": "completed",
  "resultMode": "api",
  "overview": {
    "testCaseId": 456,
    "totalScore": 86,
    "maxScore": 100,
    "hardGateTriggered": false,
    "reviewRequired": true,
    "riskCount": 2,
    "humanReviewItemCount": 1
  }
}
```

字段说明：

- `phase`：保持现有阶段字段，completed 时固定为 `completed`。
- `resultMode`：固定为 `api`，表示完整结果不在 callback body 中，需通过标准结果接口按 `taskId` 获取。
- `overview.testCaseId`：远端用例 ID，来自 `remoteTask.testCase.id`。
- `overview.totalScore`：与 callback 顶层 `totalScore` 一致，来自 `resultJson.overall_conclusion.total_score`。
- `overview.maxScore`：与 callback 顶层 `maxScore` 一致，当前固定为 `100`。
- `overview.hardGateTriggered`：来自 `resultJson.overall_conclusion.hard_gate_triggered`，缺失时为 `false`。
- `overview.reviewRequired`：当 `resultJson.human_review_items` 非空时为 `true`，否则为 `false`。
- `overview.riskCount`：`resultJson.risks` 数组长度，缺失或非数组时为 `0`。
- `overview.humanReviewItemCount`：`resultJson.human_review_items` 数组长度，缺失或非数组时为 `0`。

`overview` 只放适合远端列表页、任务详情页直接展示的结构化概要。

为保持最小化，本轮不在 completed callback 中加入 `resultAuth`、`caseDir`、`caseId`、`artifacts`、`timestamps` 等扩展字段。

## 未完成状态 callback

未完成状态 callback 保持当前行为不变。所有callback删除caseDir字段

示例 pending callback：

```json
{
  "taskId": 123,
  "status": "pending",
  "resultData": {
    "phase": "execution_accepted"
  }
}
```

示例 running callback：

```json
{
  "taskId": 123,
  "status": "running",
  "resultData": {
    "phase": "workflow_started"
  }
}
```

`result_persisted` 阶段也保持现有 callback 调用不变。远端只应在收到 completed callback 后，通过固定接口 `GET /score/remote-tasks/:taskId/result` 读取完整结果。

## 统一接口定义文件

当前服务已经开放 `GET /health`、`POST /score/run-remote-task` 等接口，后续还会新增结果访问接口。为避免接口分散在 `src/index.ts` 中难以查看，需要新增统一接口定义文件：

```text
src/api/apiDefinitions.ts
```

该文件只描述接口契约，不实现业务逻辑。最小字段包括：

```ts
export type ApiMethod = "GET" | "POST" | "OPTIONS";

export type ApiDefinition = {
  method: ApiMethod;
  path: string;
  description: string;
};

export const API_DEFINITIONS: ApiDefinition[] = [
  { method: "GET", path: "/health", description: "Service health check." },
  {
    method: "POST",
    path: "/score/run-remote-task",
    description: "Accept one remote evaluation task and execute it asynchronously.",
  },
  {
    method: "GET",
    path: "/score/remote-tasks/:taskId/result",
    description: "Read the completed remote task result JSON as resultData.",
  },
];
```

`src/api/app.ts` 注册路由时优先引用该文件中的 path 常量或派生常量，避免接口文档和实际路由漂移。该文件暂不生成 OpenAPI，也不新增对外接口列表 API。

## 任务记录与结果定位

结果接口需要通过 `taskId` 找到对应的 `caseDir` 和 token。当前 `createRunRemoteTaskHandler` 内部的 `remoteTaskRecords` 只存在于内存中，无法满足服务重启后历史任务结果接口可用的要求。因此需要引入最小持久化任务索引。

记录字段最小集合：

```ts
type RemoteTaskRecord = {
  taskId: number;
  status: "preparing" | "queued" | "running" | "completed" | "failed" | "timed_out";
  createdAt: number;
  updatedAt: number;
  caseDir?: string;
  token?: string;
  testCaseId?: number;
  error?: string;
};
```

索引文件位置：

```text
<LOCAL_CASE_ROOT>/remote-task-index.json
```

持久化规则：

- 远端任务 accepted 后写入或更新索引，记录 `taskId`、`caseDir`、`token`、`testCaseId` 和初始状态。
- 状态变更为 `queued`、`running`、`completed`、`failed` 时同步更新索引。
- 结果接口优先从内存读取记录；内存不存在时读取 `remote-task-index.json`。
- 服务重启后，只要索引文件和 `<caseDir>/outputs/result.json` 仍存在，completed 历史任务可以继续通过结果接口读取。
- 本轮不做索引清理、过期策略、并发锁或跨进程写入协调；当前服务单进程运行时，串行读写 JSON 文件即可满足最小需求。

## 安全与暴露边界

- 结果接口必须校验 `token`。
- callback 中不回传 token。
- 结果接口不接受本地文件路径参数，只接受 `taskId`。
- 结果接口固定读取记录中 `caseDir/outputs/result.json`，不能读取任意相对路径。
- completed callback 不暴露 `caseDir`，避免泄漏本地绝对路径。

## 测试设计

新增或更新远端任务测试，覆盖以下场景：

1. completed callback 不再携带完整 `result.json` 字段，包含 `resultMode: "api"` 和 `overview`，且不包含 `resultUrl`。
2. completed callback 顶层 `totalScore`、`maxScore` 保持不变。
3. pending/running callback body 与当前行为一致。
4. `GET /score/remote-tasks/:taskId/result` 在 token 正确且任务 completed 时返回 `success: true` 和完整 `resultData`。
5. 结果接口返回的 `resultData.overall_conclusion.total_score` 等于本地 `outputs/result.json` 内容。
6. token 缺失或错误时返回 `401`。
7. 任务存在但未完成时返回 `409`。
8. 任务不存在时返回 `404`。

## 兼容性说明

对远端系统的迁移方式：

- 不保留历史兼容

## 验收标准

- 远端任务未完成状态 callback 调用次数和 body 结构不变。
- 远端任务 completed callback body 不再包含完整 `result.json`。
- completed callback 不包含 `resultUrl`，只包含 `resultMode: "api"` 和最小 `overview`。
- 正确 token 访问结果接口时，可以读取完整 `result.json`，且位于响应 `resultData` 字段。
- 错误 token、未完成任务、不存在任务都有明确 HTTP 状态码和 JSON 错误响应。
- 现有本地评分流程、`result.json` schema 和 HTML 报告生成不受影响。
