# Agent Client Structured Output Fallback Design

## Goal

在保持现有 `chat/completions` 调用方式不变的前提下，兼容不支持 `response_format` 结构化输出参数的 provider，使 agent 辅助判定在参数不兼容时自动降级重试，而不是直接失败。

## Current Problem

- 当前 [`src/agent/agentClient.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/agent/agentClient.ts) 固定向 `/chat/completions` 发送 `response_format: { type: "json_object" }`
- 某些 provider 声称兼容 chat completions，但会在服务端转发时拒绝结构化输出参数，并返回 400
- 当前实现对这类 400 直接抛错，导致整个 agent 辅助判定失败，评分流程退化为基线满分

## Design

### Request Strategy

首次请求继续携带 `response_format: { type: "json_object" }`，保留对支持结构化输出 provider 的约束能力。

如果响应为 HTTP 400，且响应体明确表明结构化输出参数不被支持，则自动重试一次：

- 重试请求仍使用相同 `model` / `temperature` / `messages`
- 仅移除 `response_format`
- 只允许重试一次，避免掩盖其它真实错误

### Retry Trigger

仅对“参数不兼容”这一类错误触发回退。匹配信号来自响应体文本，包含以下已知模式之一即可：

- `Unknown parameter`
- `response_format`
- `text.format`

其他错误维持原行为，不做自动重试。

### Testing

在 [`tests/agent-client.test.ts`](/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/agent-client.test.ts) 增加覆盖：

1. 首次请求因结构化参数不兼容返回 400 时，会自动发起第二次无 `response_format` 的请求，并成功返回内容
2. 普通 400 错误不会误触发重试，仍按原始错误抛出

## Scope

只修改 agent 调用兼容层与对应测试，不改工作流、评分逻辑或 provider 配置方式。
