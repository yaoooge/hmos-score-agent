# Interactive Launcher Mode Selection Design

## Goal

调整本地测试启动脚本的交互顺序，在脚本开始时先让用户选择执行模式：

- `local`：默认模式，继续使用本地 case 目录执行
- `remote`：网络接口模式，要求用户提供下载任务的 `downloadUrl`

## Scope

- 仅修改交互式启动脚本 `src/tools/runInteractiveScore.ts`
- 保持现有环境变量写入逻辑与模型配置逻辑
- 保持现有本地执行链路 `runSingleCase(casePath)`
- 复用已实现的远程执行链路 `runRemoteTask(downloadUrl)`

## Interaction Flow

第一问：

```text
执行模式 [local/remote] (default: local):
```

行为规则：

- 用户直接回车时，模式取 `local`
- 输入 `local` 时，按本地模式执行
- 输入 `remote` 时，按网络模式执行
- 输入其他值时，抛出明确错误

后续分支：

### Local

1. 询问模型服务 `baseURL`
2. 询问模型服务 `apiKey`
3. 继续解析 `--case` 参数，未提供时回退默认 case
4. 执行 `runSingleCase(casePath)`

### Remote

1. 询问模型服务 `baseURL`
2. 询问模型服务 `apiKey`
3. 询问 `downloadUrl`
4. 校验 `downloadUrl` 非空
5. 执行 `runRemoteTask(downloadUrl)`

## Output

- 两种模式都打印结果目录
- 两种模式都打印上传信息（如果存在）
- `remote` 模式额外打印 `taskId`（如果返回）

## Testing

- 纯函数测试：
  - 模式归一化支持默认 `local`
  - `remote` 模式保留并规范化 `downloadUrl`
- 源码行为测试：
  - 启动脚本包含模式选择提示
  - 启动脚本包含 `runRemoteTask` 调用与 `downloadUrl` 提示
