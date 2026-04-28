# Opencode Agent 说明

本文档说明本仓库当前使用的 opencode agent 定义、运行时生成方式、权限边界与调用入口，便于维护评分链路时快速定位配置。

## 定义位置

- 主配置模板：`.opencode/opencode.template.json`
- agent system prompt：`.opencode/prompts/*.md`
- 运行时生成目录：`.opencode/runtime/`
- 运行时配置生成逻辑：`src/opencode/opencodeConfig.ts`
- opencode CLI 调用封装：`src/opencode/opencodeCliRunner.ts`

服务启动时不会使用用户级 opencode 配置，而是读取 `.opencode/opencode.template.json`，用 `HMOS_OPENCODE_*` 环境变量替换模板占位符，生成 `.opencode/runtime/opencode.generated.json` 和 `.opencode/runtime/xdg-config/opencode/opencode.json`，并复制 prompts / formatters 到运行时目录。运行环境会设置隔离的 `HOME`、`XDG_*`、`OPENCODE_CONFIG` 和 `OPENCODE_CONFIG_DIR`。

## 模型与 provider

模板中的默认模型统一来自：

- `model`: `${HMOS_OPENCODE_PROVIDER_ID}/${HMOS_OPENCODE_MODEL_ID}`
- `small_model`: `${HMOS_OPENCODE_PROVIDER_ID}/${HMOS_OPENCODE_MODEL_ID}`

provider 定义使用 OpenAI-compatible endpoint：

- provider id：`${HMOS_OPENCODE_PROVIDER_ID}`
- model id：`${HMOS_OPENCODE_MODEL_ID}`
- model name：`${HMOS_OPENCODE_MODEL_NAME}`
- baseURL：`${HMOS_OPENCODE_BASE_URL}`
- apiKey：`${HMOS_OPENCODE_API_KEY}`
- timeout：`${HMOS_OPENCODE_TIMEOUT_MS}`

模型限制当前配置为：

- context：`202752`
- output：`16384`
- input modalities：`text`
- output modalities：`text`

## Agent 列表

### `hmos-understanding`

用途：任务理解阶段，从预处理后的 case 输入中抽取显式约束、上下文约束、隐式约束和分类提示。

配置摘要：

- `description`: `Extracts task constraints from preprocessed case input and returns only the required JSON object.`
- `mode`: `primary`
- `prompt`: `{file:./prompts/hmos-understanding-system.md}`
- `temperature`: `0.1`
- 调用入口：`src/agent/opencodeTaskUnderstanding.ts`
- 输出文件：由调用层指定在 `metadata/agent-output/*.json`

权限特点：

- 允许 `read`，用于读取 runner 写入的 prompt 文件。
- 禁止 `glob`、`grep`、`list`，避免探索工程文件。
- 禁止 `bash`、`task`、`skill`、`lsp`、`webfetch`、`websearch`、`codesearch`、`question`、`external_directory`、`doom_loop`。
- `edit` 默认拒绝，只允许写入 `metadata/agent-output/*.json` 或 `**/metadata/agent-output/*.json`。

system prompt 约束：只读取用户消息指定的 prompt 文件，不读取 `generated/`、`original/`、`patch/`、`metadata/metadata.json` 或 `references/` 下的业务文件；最终 JSON 必须写入指定 `output_file`，assistant 最终回复只能返回 `{"output_file":"<output_file>"}`。

### `hmos-rubric-scoring`

用途：rubric 评分阶段，在只读 sandbox 中读取评分材料，对每个 rubric item 输出分数、证据、扣分轨迹、风险、优势和主要问题。

配置摘要：

- `description`: `Scores HarmonyOS generated code against rubric items and returns only the required JSON object.`
- `mode`: `primary`
- `prompt`: `{file:./prompts/hmos-rubric-scoring-system.md}`
- `temperature`: `0.1`
- 调用入口：`src/agent/opencodeRubricScoring.ts`
- 输出文件：由调用层指定在 `metadata/agent-output/*.json`

权限特点：

- 允许 `read`、`glob`、`grep`、`list`，可在 sandbox 内查阅评分所需文件。
- 禁止 `bash`、`task`、`skill`、`lsp`、`webfetch`、`websearch`、`codesearch`、`question`、`external_directory`、`doom_loop`。
- `edit` 默认拒绝，只允许写入 `metadata/agent-output/*.json` 或 `**/metadata/agent-output/*.json`。

system prompt 约束：必须覆盖输入要求的每个 rubric item；分数只能来自对应 item 的 allowed score / scoring band；证据路径必须是 sandbox 相对路径；无充分负面证据时保持满分并降低置信度或标记复核，而不是保守扣分。

### `hmos-rule-assessment`

用途：规则辅助判定阶段，在只读 sandbox 中对静态规则审计产生的候选规则进行 agent 辅助判定。

配置摘要：

- `description`: `Assesses assisted rule candidates in a read-only sandbox and returns only the required JSON object.`
- `mode`: `primary`
- `prompt`: `{file:./prompts/hmos-rule-assessment-system.md}`
- `temperature`: `0.1`
- 调用入口：`src/agent/opencodeRuleAssessment.ts`
- 输出文件：由调用层指定在 `metadata/agent-output/*.json`

权限特点：

- 允许 `read`、`glob`、`grep`、`list`，可在 sandbox 内查阅候选规则判定所需文件。
- 禁止 `bash`、`task`、`skill`、`lsp`、`webfetch`、`websearch`、`codesearch`、`question`、`external_directory`、`doom_loop`。
- `edit` 默认拒绝，只允许写入 `metadata/agent-output/*.json` 或 `**/metadata/agent-output/*.json`。

system prompt 约束：必须覆盖 `assisted_rule_candidates` 中的每一个 `rule_id`，不能新增、遗漏或重复；只判断候选规则，不扩展审计范围；无法确认时使用 `decision="uncertain"` 并设置 `needs_human_review=true`。

## 全局权限边界

`.opencode/opencode.template.json` 的顶层权限也采用只读策略：

- 默认 `* = deny`。
- 允许读取、glob、grep、list。
- 禁止编辑、运行 shell、创建子任务、调用 skill、使用 LSP、访问网络、代码搜索、提问、访问外部目录和 doom loop。
- 读取权限显式拒绝敏感或大型目录：`.env`、`.env.*`、`.git/`、`node_modules/`、`oh_modules/`、`.hvigor/`、`build/`、`dist/`。

agent 级权限在此基础上进一步收窄：任务理解 agent 不允许 glob / grep / list；评分与规则判定 agent 允许在 sandbox 内检索，但仍不能执行命令、联网或修改业务文件。

## 输出协议

`src/opencode/opencodeCliRunner.ts` 会先把完整 prompt 写入 sandbox 的：

```text
metadata/opencode-prompts/<requestTag>.md
```

随后以如下形式调用 opencode：

```text
opencode run --attach <serverUrl> --dir <sandboxRoot> --format json --title <requestTag> --agent <agentName> <runMessage>
```

当调用层传入 `outputFile` 时，runner 会要求 agent：

1. 读取 `metadata/opencode-prompts/<requestTag>.md`。
2. 将最终 JSON object 写入指定 `metadata/agent-output/<name>.json`。
3. 最终回复只输出 `{"output_file":"metadata/agent-output/<name>.json"}`。

runner 只允许 `outputFile` 匹配：

```text
metadata/agent-output/[a-z-]+.json
```

并会校验解析后的路径不能逃逸 sandbox。

## Sandbox 约定

opencode agent 不直接读取原始 case 目录。评分流程会为每次 case 创建 sandbox，常见结构如下：

- `generated/`：待评分生成工程，对应 case 的 `workspace/`
- `original/`：原始工程
- `patch/effective.patch`：本次评分实际使用的 patch
- `metadata/`：任务、规则、结构摘要、agent prompt 与 agent 输出
- `references/`：评分参考材料

agent 的证据路径、代码位置、输出文件路径都应使用 sandbox 相对路径。

## Formatter

模板中定义了 `agent-json` formatter：

```json
{
  "command": ["node", "./formatters/format-json.mjs", "$FILE"],
  "extensions": [".json"]
}
```

对应文件位于 `.opencode/formatters/format-json.mjs`，运行时会复制到 `.opencode/runtime/formatters/` 和隔离的 XDG config 目录。

## 维护注意事项

- 修改 agent 名称时，需要同步更新 `.opencode/opencode.template.json`、对应 prompt 文件、调用入口和测试断言。
- 修改 prompt 文件后，运行时会在下一次生成配置时复制到 `.opencode/runtime/`。
- 不要提交 `.opencode/runtime/` 下的生成状态。
- 如需放宽权限，优先只放宽单个 agent 的最小权限，不要直接扩大顶层权限。
- 所有 agent 结果都应通过文件输出协议落盘，避免依赖长 JSON 的 assistant 最终文本。
