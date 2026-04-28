# 远端用例完成结果轻量回调与结果访问接口设计

## 背景

远端用例任务当前通过 `POST /score/run-remote-task` 接收后异步执行。执行过程中会多次调用远端传入的 `callback`，其中未完成状态包括 `pending`、`running`，完成状态为 `completed`，失败状态为 `failed`。

当前 completed callback 的 `resultData` 会直接携带完整 `workflowResult.resultJson`。当最终 `result.json` 较大时，callback body 会变长，可能触发远端服务、网关、日志系统或数据库字段长度限制。完整评分结果已经在本地落盘到：

```text
<caseDir>/outputs/result.json
```

因此不需要在 completed callback 中继续内联完整 JSON。更小的改动是：仅在任务完成时将 callback 改为轻量结果摘要和结果访问地址；完整 JSON 通过一个本地开放接口按需读取。

## 目标

- 未完成状态 callback 行为保持不变，包括 `pending`、`running` 阶段的调用时机、状态值和现有 `resultData` 内容。
- completed callback 不再内联完整 `result.json`，改为回传概要信息、`summary` 和完整结果访问地址。
- 新增一个结果访问接口，用于外部读取完整结果 JSON。
- 结果访问接口的响应字段兼容当前 callback 的 `resultData` 字段，即外部可以从响应中拿到等价于旧 completed callback `resultData` 的完整结果对象。
- 暂不新增任务状态查询、artifact 列表、报告下载等其他接口。

## 非目标

- 不修改 `POST /score/run-remote-task` 的请求协议。
- 不修改 `pending`、`running`、`failed` callback 的语义和调用次数。
- 不修改 `result.json` schema。
- 不引入对象存储、预签名 URL 或外部上传流程。
- 不新增远端任务列表、任务状态查询、HTML 报告下载、日志下载接口。
- 不在 callback 或结果接口中暴露本地绝对路径。

## 当前相关代码

- `src/index.ts`：`createRunRemoteTaskHandler` 接收远端任务、维护内存任务记录并触发异步执行。
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
  -> completed callback: lightweight summary + resultUrl
  -> remote system GET resultUrl when full JSON is needed
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
    "artifacts": {
      "result_json_file_name": "result.json",
      "report_html_file_name": "report.html"
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
  "resultMode": "url",
  "resultUrl": "http://<public-host>/score/remote-tasks/123/result",
  "summary": {
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
- `resultMode`：固定为 `url`，表示完整结果不在 callback body 中。
- `resultUrl`：完整结果访问接口地址。
- `summary.testCaseId`：远端用例 ID，来自 `remoteTask.testCase.id`。
- `summary.totalScore`：与 callback 顶层 `totalScore` 一致，来自 `resultJson.overall_conclusion.total_score`。
- `summary.maxScore`：与 callback 顶层 `maxScore` 一致，当前固定为 `100`。
- `summary.hardGateTriggered`：来自 `resultJson.overall_conclusion.hard_gate_triggered`，缺失时为 `false`。
- `summary.reviewRequired`：当 `resultJson.human_review_items` 非空时为 `true`，否则为 `false`。
- `summary.riskCount`：`resultJson.risks` 数组长度，缺失或非数组时为 `0`。
- `summary.humanReviewItemCount`：`resultJson.human_review_items` 数组长度，缺失或非数组时为 `0`。

为保持最小化，本轮不在 completed callback 中加入 `resultAuth`、`caseDir`、`caseId`、`artifacts`、`timestamps` 等扩展字段。

## 未完成状态 callback

未完成状态 callback 保持当前行为不变。

示例 pending callback 仍为当前形态：

```json
{
  "taskId": 123,
  "status": "pending",
  "resultData": {
    "phase": "execution_accepted",
    "caseDir": "<existing-value>"
  }
}
```

示例 running callback 仍为当前形态：

```json
{
  "taskId": 123,
  "status": "running",
  "resultData": {
    "phase": "workflow_started",
    "caseDir": "<existing-value>"
  }
}
```

`result_persisted` 阶段也保持现有 callback 调用不变，不提前暴露 `resultUrl`。远端只应在收到 completed callback 后读取完整结果。

## 结果 URL 生成

新增配置：

```env
PUBLIC_BASE_URL=http://<externally-accessible-host>:3000
```

completed callback 中的 `resultUrl` 由该配置生成：

```text
${PUBLIC_BASE_URL}/score/remote-tasks/${taskId}/result
```

配置规则：

- 生产或远端联调环境必须配置 `PUBLIC_BASE_URL`，否则远端无法访问本地结果接口。
- 本地开发环境可以回退为 `http://127.0.0.1:${PORT}`，仅用于本机调试。
- `PUBLIC_BASE_URL` 写入 callback 前应去掉末尾 `/`，避免生成双斜杠。

## 任务记录与结果定位

结果接口需要通过 `taskId` 找到对应的 `caseDir` 和 token。最小化实现可以复用当前 `createRunRemoteTaskHandler` 内部的 `remoteTaskRecords`，但需要把它提升为该 handler 和结果 handler 共享的任务记录容器。

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

最小化版本接受以下限制：

- 任务记录只保存在进程内存中。
- 服务重启后，旧任务的结果接口不可用，返回 `404 Remote task not found`。
- 本轮不新增 `.local-cases` 索引文件，也不扫描历史 case 目录。

这个限制符合“最小化落地”，后续如需要跨重启访问，再单独设计持久化索引。

## 安全与暴露边界

- 结果接口必须校验 `token`。
- callback 中不回传 token。
- 结果接口不接受本地文件路径参数，只接受 `taskId`。
- 结果接口固定读取记录中 `caseDir/outputs/result.json`，不能读取任意相对路径。
- completed callback 不暴露 `caseDir`，避免泄漏本地绝对路径。未完成 callback 由于本轮要求保持不变，暂不调整其已有字段。

## 测试设计

新增或更新远端任务测试，覆盖以下场景：

1. completed callback 不再携带完整 `result.json` 字段，包含 `resultMode: "url"`、`resultUrl` 和 `summary`。
2. completed callback 顶层 `totalScore`、`maxScore` 保持不变。
3. pending/running callback body 与当前行为一致。
4. `GET /score/remote-tasks/:taskId/result` 在 token 正确且任务 completed 时返回 `success: true` 和完整 `resultData`。
5. 结果接口返回的 `resultData.overall_conclusion.total_score` 等于本地 `outputs/result.json` 内容。
6. token 缺失或错误时返回 `401`。
7. 任务存在但未完成时返回 `409`。
8. 任务不存在时返回 `404`。

## 兼容性说明

对远端系统的迁移方式：

- 原来从 completed callback 的 `body.resultData` 读取完整结果。
- 新流程从 completed callback 的 `body.resultData.resultUrl` 发起 GET。
- GET 响应中的 `body.resultData` 等价于旧 completed callback 的完整 `body.resultData`。

因此旧结果解析逻辑可以保留，只需要把输入来源从 callback body 切换为结果接口响应 body。

## 验收标准

- 远端任务未完成状态 callback 调用次数和 body 结构不变。
- 远端任务 completed callback body 不再包含完整 `result.json`。
- completed callback 包含可访问的 `resultUrl` 和最小 `summary`。
- 正确 token 访问结果接口时，可以读取完整 `result.json`，且位于响应 `resultData` 字段。
- 错误 token、未完成任务、不存在任务都有明确 HTTP 状态码和 JSON 错误响应。
- 现有本地评分流程、`result.json` schema 和 HTML 报告生成不受影响。
