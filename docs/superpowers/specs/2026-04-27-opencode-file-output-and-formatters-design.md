# OpenCode Agent 文件落盘输出与 Formatter 约束设计

## 背景

当前评分工作流通过 `opencode run --format json` 调用 task understanding、rubric scoring、rule assessment 三类 agent。系统要求 agent 最终只输出一个 JSON object，再由本地 `extractFinalJsonObject` 从 assistant 文本中提取并解析。

这个协议在实际运行中仍然不稳定，常见失败包括：

- assistant 最终文本没有任何 JSON object。
- assistant 最终文本包含多个 JSON object。
- JSON 被自然语言、Markdown、解释文字或工具事件污染。
- 长 JSON 在 stdout 流式输出中被截断或结构不完整。
- retry prompt 已经定向修复，但模型仍可能不按 stdout JSON-only 协议返回。

`simple_test` 的一次真实失败暴露了两个问题：

1. `hmos-understanding` agent 禁用了 `read`，导致 OpenCode 无法读取 runner 写入的 prompt 文件，只看到了 wrapper 指令，任务理解结果被污染。
2. rule agent retry 后仍然没有输出可解析 JSON，最终失败为“期望 opencode 最终输出包含且只包含一个 JSON object，实际数量=0”。

第一类问题已通过允许 `hmos-understanding.permission.read = "allow"` 修复。第二类问题需要从协议层改变输出通道：不再把长 JSON 完全依赖 assistant 最终文本，而是要求 agent 将最终 JSON 写入 sandbox 内约定文件，本地解析该文件。

OpenCode formatter 文档说明：formatter 会在 OpenCode 写入或编辑文件后，按文件扩展名运行配置的格式化命令，并可通过 `$FILE` 引用当前文件路径。因此 formatter 可用于 agent 写入 JSON 文件后的语法校验和格式化，但它不是模型 structured output，也不能替代本地 schema 校验。

参考文档：<https://opencode.ai/docs/zh-cn/formatters/>

## 目标

- 将 agent 的最终长 JSON 从 stdout 文本输出迁移为 sandbox 内文件输出。
- runner 优先解析约定 output file，而不是解析 assistant 最终文本。
- 使用 OpenCode formatter 对 agent 写入的 `.json` 文件做 JSON parse 与格式化。
- 保留现有 zod/schema 校验、本地 skeleton normalize、定向 retry 机制。
- 修复 task understanding agent 需要读取自身 prompt 文件的问题，同时继续禁止其探索工程文件。
- 保证迁移可以渐进落地，允许短期内 file output 与 stdout fallback 并存。

## 非目标

- 本设计不引入模型供应商层面的 structured output / JSON schema decoding。
- 本设计不要求 OpenCode formatter 校验业务 schema；formatter 只负责 JSON 语法和格式化。
- 本设计不改变评分规则、rubric 维度、rule pack 内容或最终报告 schema。
- 本设计不要求 agent 写回原始 case/workspace；所有写入只发生在 opencode sandbox 内。
- 本设计不移除现有 retry 和本地 normalize 逻辑。

## 现状问题分析

### stdout JSON-only 协议不够可靠

当前 runner 的消息类似：

```text
Read and follow the prompt file at metadata/opencode-prompts/<request>.md.
Return only the requested final JSON object.
```

这种方式依赖模型在最终 assistant 文本中严格输出唯一 JSON object。即使 system prompt、普通 prompt 和 retry prompt 都强调 JSON-only，模型仍可能输出解释文字、空文本、多个对象或不完整 JSON。

### OpenCode prompt 文件读取依赖 read 权限

runner 会先把 prompt 文本写入 sandbox：

```text
metadata/opencode-prompts/<request-tag>.md
```

然后通过 `opencode run` 让 agent 读取这个文件。即使某个业务 agent 不应读取工程文件，它仍然需要读取自己的 prompt 文件。因此 `read = deny` 会破坏 runner 的基础调用协议。

### Formatter 的适用边界

OpenCode formatter 只在 OpenCode 写入或编辑文件后触发。它适合处理如下场景：

```text
agent write metadata/agent-output/rule-assessment.json
  -> formatter sees .json
  -> formatter runs JSON parse/pretty print
  -> local runner reads formatted file
```

它不适合直接约束 stdout，也不保证模型不会写错业务字段。因此必须保留本地解析、schema 校验和 retry。

## 总体设计

新的输出链路如下：

```text
runner writes prompt file
  -> opencode agent reads prompt file
  -> agent analyzes sandbox inputs
  -> agent writes final JSON to metadata/agent-output/<agent>.json
  -> OpenCode formatter formats/validates JSON syntax
  -> runner reads output file
  -> local zod/schema validation
  -> local skeleton normalize
  -> retry only when file missing, JSON invalid, schema invalid, or business validation fails
```

stdout 不再承载完整结果。agent 写完文件后，assistant 最终回复只需要输出一个很短的确认对象：

```json
{"output_file":"metadata/agent-output/rule-assessment.json"}
```

迁移期 runner 可以忽略这个确认对象，直接读取约定文件；如果文件不存在，可以 fallback 到旧的 stdout JSON 解析，方便灰度切换。

## 输出文件约定

所有 agent 输出文件都位于 sandbox 内固定目录：

```text
metadata/agent-output/task-understanding.json
metadata/agent-output/rubric-scoring.json
metadata/agent-output/rule-assessment.json
```

路径约束：

- 必须是相对 sandbox root 的 POSIX 路径。
- 必须匹配 `metadata/agent-output/[a-z-]+.json`。
- 不允许 `..`、绝对路径、反斜杠或其他路径逃逸形式。
- runner 每次调用前删除目标文件，避免读取上一次残留。

## OpenCode 配置设计

### Agent 权限

`hmos-understanding`：

```json
{
  "read": "allow",
  "write": "allow",
  "glob": "deny",
  "grep": "deny",
  "list": "deny",
  "edit": "deny",
  "bash": "deny"
}
```

说明：

- `read` 必须允许，否则 agent 无法读取 runner 写入的 prompt 文件。
- `write` 用于写 `metadata/agent-output/task-understanding.json`。
- `glob/list/grep` 仍禁用，防止任务理解阶段探索工程文件。
- `edit/bash` 禁用，避免修改既有文件或运行命令。

`hmos-rubric-scoring` 与 `hmos-rule-assessment`：

```json
{
  "read": "allow",
  "write": "allow",
  "glob": "allow",
  "grep": "allow",
  "list": "allow",
  "edit": "deny",
  "bash": "deny"
}
```

说明：

- rubric/rule agent 需要读取 generated、patch、references 等 sandbox 内容。
- `write` 只用于写最终 JSON 文件。
- `edit` 仍保持 deny，避免对已有工程文件做编辑。

如果 OpenCode 对 `write` 权限不识别或无法单独启用，需要通过最小验证确认是否必须改为 `edit = allow`。只有在无法使用 `write` 时才考虑 `edit`，并必须依赖 sandbox 隔离和路径校验控制风险。

### Formatter 配置

在 `.opencode/opencode.template.json` 中增加 JSON formatter：

```json
"formatter": {
  "agent-json": {
    "command": ["node", "./.opencode/formatters/format-json.mjs", "$FILE"],
    "extensions": [".json"]
  }
}
```

formatter 脚本：

```js
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  process.exit(0);
}

const text = fs.readFileSync(file, "utf8");
const parsed = JSON.parse(text);
fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`);
```

该脚本只做两件事：

- 非法 JSON 直接失败。
- 合法 JSON 统一 pretty print。

业务字段校验仍由本地 TypeScript 代码完成。

## Runner 设计

### 请求类型扩展

`OpencodeRunRequest` 增加可选字段：

```ts
export interface OpencodeRunRequest {
  prompt: string;
  sandboxRoot: string;
  requestTag: string;
  title?: string;
  agent?: string;
  outputFile?: string;
}
```

### 输出路径解析

runner 增加路径校验函数：

```ts
function resolveAgentOutputPath(sandboxRoot: string, outputFile: string): string {
  if (!/^metadata\/agent-output\/[a-z-]+\.json$/.test(outputFile)) {
    throw new OpencodeRunError(`invalid agent output file: ${outputFile}`);
  }

  const root = path.resolve(sandboxRoot);
  const resolved = path.resolve(root, outputFile);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new OpencodeRunError(`agent output file escapes sandbox: ${outputFile}`);
  }
  return resolved;
}
```

### 调用前清理

每次 `runOpencodePrompt` 开始前：

```ts
if (request.outputFile) {
  const outputPath = resolveAgentOutputPath(request.sandboxRoot, request.outputFile);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });
}
```

这样 retry 不会读到首轮残留文件。

### CLI 消息变更

旧消息：

```text
Read and follow the prompt file at <prompt>. Return only the requested final JSON object.
```

新消息：

```text
Read and follow the prompt file at <prompt>.
Write the final JSON object to <output_file>.
After writing the file, reply only with {"output_file":"<output_file>"}.
```

如果 `outputFile` 未提供，保持旧消息，兼容现有测试和灰度迁移。

### 读取结果优先级

opencode 进程退出成功后：

1. 如果 `outputFile` 存在，读取该文件作为 `rawText`。
2. 如果文件不存在，返回 `OpencodeRunError`，错误信息为 `opencode agent output file missing`。
3. 迁移期可以临时 fallback 到 stdout 解析，但最终稳定版应移除 fallback。

推荐迁移期策略：

```text
file exists -> rawText = file content
file missing and enableStdoutFallback -> rawText = extractAssistantText(rawEvents)
file missing and no fallback -> request_failed
```

## Agent Prompt 设计

system prompt 增加统一落盘协议：

```text
你必须将最终 JSON object 写入用户消息指定的 output_file。
写入文件内容必须是完整 JSON object。
写入文件后，assistant 最终回复只能是：
{"output_file":"<output_file>"}
不要在最终回复中重复完整结果 JSON。
不要把 Markdown、解释文字或代码块写入 output_file。
```

普通 prompt 增加：

```text
output_file: metadata/agent-output/rubric-scoring.json
```

retry prompt 增加：

```text
覆盖写入 output_file，不要沿用旧文件内容。
output_file: metadata/agent-output/rubric-scoring.json
```

## 各 Agent 接入方式

### Task Understanding

调用参数：

```ts
outputFile: "metadata/agent-output/task-understanding.json"
```

解析仍使用 `parseConstraintSummary`。

特殊约束：

- 允许 read 只为读取 prompt 文件。
- 禁止 glob/list/grep，避免探索工程文件。
- system prompt 必须明确“不读取 generated/original/patch/references”。

### Rubric Scoring

调用参数：

```ts
outputFile: "metadata/agent-output/rubric-scoring.json"
```

解析流程：

```text
read output file
  -> zod parse
  -> normalizeRubricResult by local rubric skeleton
  -> validateRubricCoverage
```

现有本地 skeleton normalize 保留：

- 过滤 unknown item。
- 去重 duplicate item。
- 覆盖 `max_score`。
- 补齐 `matched_band_score = score`。
- 按本地 rubric 顺序输出。

### Rule Assessment

调用参数：

```ts
outputFile: "metadata/agent-output/rule-assessment.json"
```

解析流程：

```text
read output file
  -> zod parse
  -> normalizeRuleAssessmentResult by assisted_rule_candidates
  -> validate normalized result
```

现有本地 candidate skeleton normalize 保留：

- 过滤 unknown rule。
- 去重 duplicate rule。
- 按候选顺序输出。
- 遗漏候选补 `uncertain + needs_human_review=true`。

## Retry 设计

retry 仍沿用现有定向修复策略，但输出通道改为覆盖同一个文件。

例如 rule retry：

```text
上一次失败原因: output_file_missing
协议错误修复清单:
- listed protocol errors: output_file_missing
- 只修复 listed protocol errors，禁止重新判定，禁止改变未列出的 rule 判断。

请覆盖写入 output_file:
metadata/agent-output/rule-assessment.json
```

新增失败原因分类：

- `output_file_missing`：进程成功退出但未写文件。
- `output_file_empty`：文件存在但为空。
- `output_file_invalid_json`：文件不是合法 JSON。
- `output_file_schema_error`：文件 JSON 合法但 zod/schema 不通过。

这些失败原因进入现有 retry prompt 的 `listed protocol errors`。

## 兼容与迁移计划

### 阶段一：最小修复

- 保持 stdout 解析。
- 修复 `hmos-understanding.read = allow`。
- 增加测试覆盖 task understanding agent 权限。

### 阶段二：Runner 支持 output file

- 扩展 `OpencodeRunRequest.outputFile`。
- runner 写 prompt 后创建 `metadata/agent-output/`。
- runner 调用前删除旧 output file。
- opencode 退出后优先读取 output file。
- 暂时保留 stdout fallback。

### 阶段三：接入 rule/rubric

- rule/rubric agent 开启 `write`。
- rule/rubric prompt 增加 output file 协议。
- rule/rubric runner 调用传 `outputFile`。
- 保留本地 normalize 与 retry。

### 阶段四：接入 task understanding

- task understanding agent 开启 `write`。
- task understanding prompt 增加 output file 协议。
- task understanding runner 调用传 `outputFile`。

### 阶段五：收紧协议

- 当 file output 在多个用例稳定后，去掉 stdout fallback。
- assistant 最终回复只作为诊断信息，不作为结果来源。

## 测试策略

### 配置测试

- `.opencode/opencode.template.json` 不包含真实密钥。
- `hmos-understanding.read === "allow"`。
- `hmos-understanding.glob/list/grep/bash/edit === "deny"`。
- rule/rubric agent 允许 `write`，但仍禁止 `edit/bash`。
- formatter 配置包含 `.json` 扩展和 `$FILE`。

### Runner 测试

- 当 `outputFile` 被设置时，runner 调用前删除旧文件。
- opencode 成功退出且 output file 存在时，`rawText` 来自文件内容。
- output file 不存在时返回明确错误。
- output file 路径包含 `..` 或绝对路径时拒绝。
- output file JSON 无效时，解析层返回 protocol error。

### Agent 测试

- task/rubric/rule 调用分别传入正确 output file。
- retry 调用覆盖同一个 output file。
- stdout 中有自然语言但 output file 合法时，解析成功。
- stdout 合法但 output file 缺失时，迁移期 fallback 可成功；最终阶段应失败。

### 端到端测试

- `cases/simple_test` 能完成 workflow 并生成 `outputs/result.json`��
- `cases/glm_test1` 能完成 workflow 并生成 `outputs/result.json`。
- 产物目录保留 `metadata/agent-output/*.json`，便于调试。

## 风险与缓解

### 风险：开放 write 权限扩大 agent 能力

缓解：

- 所有写入发生在 opencode sandbox 内。
- runner 只读取 `metadata/agent-output/*.json`。
- prompt 强制只能写 output file。
- 如果 OpenCode 支持路径级 permission，后续收紧到 `metadata/agent-output/**`。

### 风险：formatter 命令路径在 runtime 下不可用

缓解：

- `createOpencodeRuntimeConfig` 复制 `.opencode/formatters` 到 runtime 配置可解析位置。
- 测试同时检查 repo `.opencode/formatters` 与 runtime `xdg-config/opencode/formatters`。

### 风险：formatter 失败行为不稳定

缓解：

- runner 仍在本地读取文件后执行 JSON.parse。
- formatter 只作为提前暴露问题和统一格式的辅助，不作为唯一校验层。

### 风险：agent 写了文件但内容不是目标 schema

缓解：

- 本地 zod/schema 校验仍是强制步骤。
- rubric/rule 保留 skeleton normalize。
- schema 或业务校验失败仍进入定向 retry。

## 成功标准

- task understanding 不再把 runner wrapper 指令误识别为业务任务。
- rule/rubric/task agent 的长 JSON 结果由文件读取，不依赖 stdout 中唯一 JSON object。
- formatter 能格式化 agent 写入的 JSON 文件。
- 本地 schema 校验和 normalize 保持现有行为。
- `simple_test` 和 `glm_test1` 能稳定生成最终 `outputs/result.json`。

