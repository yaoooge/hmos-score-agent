# Remote Network Execution Design

## Goal

在现有本地 `casePath` 执行链路之外，增加一条“远程下载任务 -> 本地标准化 -> 执行评分 -> callback 回传结果”的闭环能力。

## Scope

- 新增远程任务下载与 callback 上传能力。
- 新增 HTTP 入口触发远程任务执行。
- 远程任务下载结果标准化为现有 `CaseInput` + 本地临时 case 目录。
- 维持现有本地 CLI / API 执行模式不变。

## Remote Contract

下载接口返回：

```json
{
  "taskId": 4,
  "testCase": {
    "id": 8,
    "name": "123222",
    "type": "requirement",
    "description": "2222222",
    "input": "222222222",
    "expectedOutput": "2222222211",
    "fileUrl": "https://example.com/original.json"
  },
  "executionResult": {
    "isBuildSuccess": true,
    "outputCodeUrl": "https://example.com/workspace.json",
    "diffFileUrl": "https://example.com/changes.patch"
  },
  "token": "token-value",
  "callback": "http://localhost:3000/api/evaluation-tasks/callback"
}
```

回传接口：

- 地址使用下载结果中的 `callback`
- 请求头使用 `token: <token>`
- 请求体包含 `taskId`、`status`、`totalScore`、`maxScore`、`resultData`

## Mapping

为兼容当前工作流，远程资源映射为本地 case 目录：

- `testCase.input` -> `input.txt`
- `testCase.fileUrl` -> `original/`
- `executionResult.outputCodeUrl` -> `workspace/`
- `executionResult.diffFileUrl` -> `diff/changes.patch`（可选）

下载内容先支持两种格式：

1. 目录清单 JSON
   - 形如 `{ "files": [{ "path": "entry/src/main/ets/pages/Index.ets", "content": "..." }] }`
   - 用于 `original/` 与 `workspace/` 目录物化
2. 纯文本 patch
   - 直接写入 `diff/changes.patch`

## Execution Flow

1. `POST /score/run-remote` 接收 `downloadUrl`
2. 服务请求下载地址并解析远程任务
3. 将远程任务物化为临时 case 目录
4. 复用现有 workflow 执行评分
5. 将结构化评分结果按 callback 协议上传
6. 返回本地执行目录、下载任务 ID 和上传结果

## Error Handling

- 下载任务失败：接口返回 500，不进入 callback
- 远程资源格式非法：接口返回 500，不进入 callback
- 评分执行失败：尝试 callback 上报 `status=failed`
- callback 上传失败：本地结果保留，同时接口返回失败原因

## Testing

- 服务层测试远程任务标准化与 callback payload
- API 层测试 `POST /score/run-remote`
- 保留现有本地执行测试不回归
