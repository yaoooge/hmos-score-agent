# Opencode 直接接管 Agent 迁移实施方案

> **面向 agentic workers：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步实施本方案。所有步骤使用 checkbox（`- [ ]`）语法跟踪进度。

**目标：** 将当前“服务端直接调用 LLM API + 本地 `tool_call` 循环”的评分流程，迁移为“长期运行的 opencode server + 每个用例独立只读沙箱 + opencode 直接阅读代码并产出最终评分 JSON”。迁移后，从任务理解到规则判定、rubric 评分、分数融合和报告生成，对下游暴露的业务结果字段、取值语义和报告内容必须保持不变；只允许替换 agent 调用实现和内部观测 artifact。

**架构：** 评分服务负责管理 opencode 运行时：工程内维护 `.opencode/` 项目级配置，启动或连接 `opencode serve`，每个用例测评前构建独立 `opencode-sandbox/`，再通过 `opencode run --attach ... --dir <sandbox>` 触发 opencode 执行任务理解、规则判定和 rubric 评分。opencode 只允许在沙箱内读取、列目录和搜索文件；禁止写文件、执行 shell、访问外部目录、联网搜索、提问或派生子任务。

**技术栈：** TypeScript、Node child process、现有 LangGraph workflow、opencode CLI/server、工程级 `.opencode/` 配置、现有业务 JSON schema/validator。

---

## 背景与约束

- 现有流程里，LLM 调用集中在 `AgentClient.completeJsonPrompt()`，默认实现是 OpenAI-compatible `/chat/completions`。
- 现有 case-aware agent 不是平台原生 tool calling，而是自定义文本 JSON 协议：模型输出 `tool_call`，服务端本地执行 `read_file`、`grep_in_files` 等工具，再把观察结果拼回下一轮 prompt。
- 本次迁移要求 opencode 直接接管代码阅读能力，所以需要清理本地 `tool_call` 协议和 `CaseToolExecutor`。
- 不依赖本机全局 opencode 配置。工程目录下创建 `.opencode/`，运行时显式指定配置路径和隔离的 `HOME`/`XDG_*` 目录。
- opencode 在无人值守服务中不能使用 `ask` 权限。所有工具权限必须明确为 `allow` 或 `deny`。
- opencode 只能阅读每个用例的指定沙箱目录，不能直接在服务仓库、上传原始目录或用户 HOME 下运行。
- 保留的 JSON 协议只有“最终业务结果 JSON”，例如规则判定 JSON、rubric 评分 JSON、任务理解摘要 JSON；不再保留“模型请求工具调用”的中间协议。
- 不做兼容双轨：迁移后的 agent 路径只支持 opencode，不保留 `ChatModelClient` 作为评分 agent fallback，不新增“可选 API 直连”开关。
- 不扩大重构范围：除 opencode 接入、旧 agent 协议删除、必要类型/测试/文档更新外，不重构规则引擎、rubric loader、score fusion、报告渲染业务逻辑。

## 输出契约不变原则

本迁移只替换 agent 的执行方式，不改变评分业务输出。必须保持以下契约：

- `ConstraintSummary` 的字段和取值语义不变。迁移后，opencode 缺失、运行失败或输出非法都不触发 agent fallback，而是返回 agent 失败状态；现有本地任务摘要函数只可作为非 agent 的纯本地工具被测试复用，不能在 opencode agent 失败时静默覆盖结果。
- 规则判定输出仍填充现有 `AgentAssistedRuleResult` 数据结构：`summary.assistant_scope`、`summary.overall_confidence`、`rule_assessments[].rule_id`、`decision`、`confidence`、`reason`、`evidence_used`、`needs_human_review` 的字段和含义不变。`decision` 只能是现有枚举：`violation`、`pass`、`not_applicable`、`uncertain`。
- rubric 评分输出仍填充现有 `RubricScoringResult` 数据结构：`summary.overall_assessment`、`summary.overall_confidence`、`item_scores[].dimension_name`、`item_name`、`score`、`max_score`、`matched_band_score`、`rationale`、`evidence_used`、`confidence`、`review_required`、`deduction_trace`、`hard_gate_candidates`、`risks`、`strengths`、`main_issues` 的字段和含义不变。不能引入 `total_score`、`reason`、`evidence`、`needs_human_review` 等新结构替代现有字段。
- score fusion 的输入结构和算法不改；opencode 接入不能改变静态规则分、agent 规则分、rubric 分的融合逻辑。
- 最终报告 schema、报告中用户可见的评分内容和字段含义不改。只允许在中间产物或调试区增加 opencode raw events/final text 路径；不能删除或重命名报告消费方依赖的业务字段。
- 旧 `turns`、`tool_trace`、`case_aware` 只属于内部 agent 观测协议，可以删除；删除时不得影响最终评分 JSON、上传 payload 或报告主体内容。

## 目标运行流程

1. API/CLI 启动时检查 `opencode` 是否在 PATH 中。不存在时直接失败，不能 fallback 到直接 LLM API。
2. 服务读取 `.opencode/opencode.template.json`，结合部署环境变量生成 `.opencode/runtime/opencode.generated.json`。
3. 服务以隔离环境变量启动或连接 `opencode serve --hostname 127.0.0.1 --port $HMOS_OPENCODE_PORT --pure`。
4. 每个用例进入评分前，服务创建 `caseDir/opencode-sandbox/`，只放入 opencode 允许阅读的文件：
   - `generated/`：生成项目或提交项目。
   - `original/`：存在原始项目时放入。
   - `patch/effective.patch` 或 `patch/generated.patch`：存在有效 patch 时放入。
   - `metadata/`：任务文本、caseId、规则候选、rubric 摘要等非敏感元数据。
   - `references/`：评分 rubric、规则参考文件。
5. workflow 调用 `opencode run --attach <server-url> --dir <sandbox> --format json`。
6. opencode 在沙箱目录内自行读取、列目录、搜索代码文件，并输出最终 JSON。
7. 服务从 opencode JSON event stream 中提取最终 assistant 文本，再提取最终业务 JSON，执行本地 schema 校验和完整性校验，最终映射回现有下游业务结构。
8. 服务持久化 opencode raw events、final raw text、sandbox manifest，并继续后续评分融合和报告生成。
9. 新运行时不再产生 `tool_call`、`tool_trace`、turn-by-turn 本地工具轨迹。

## 文件结构规划

新增项目级 opencode 配置：

- 创建 `.opencode/opencode.template.json`
  - 工程级 opencode 配置模板，不包含密钥。
  - provider/model ID 会出现在 JSON object key 中，所以需要启动时生成最终 JSON，不能只依赖环境变量原样展开。
- 创建 `.opencode/README.md`
  - 说明 `.opencode/` 的用途、环境变量、权限边界和部署方式。
- 修改 `.gitignore`
  - 忽略 `.opencode/runtime/`，防止生成配置、opencode state/cache/log/session 进入 git。

新增 opencode runtime 模块：

- 创建 `src/opencode/opencodeConfig.ts`
  - 读取环境变量，生成 `.opencode/runtime/opencode.generated.json`。
  - 构造隔离的 `HOME`、`XDG_CONFIG_HOME`、`XDG_STATE_HOME`、`XDG_DATA_HOME`、`XDG_CACHE_HOME`、`OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR`。
- 创建 `src/opencode/opencodeServeManager.ts`
  - 检查 opencode CLI 是否存在。
  - 启动、连接、健康检查、停止 `opencode serve`。
- 创建 `src/opencode/opencodeCliRunner.ts`
  - 执行 `opencode run --attach ... --dir <sandbox> --format json`。
  - 处理超时、stdout/stderr 限制、非 0 退出、事件流解析。
- 创建 `src/opencode/sandboxBuilder.ts`
  - 为每个用例构建只读输入沙箱。
  - 跳过 `.env`、`.git`、`node_modules`、`oh_modules`、`.hvigor`、`build`、`dist` 等目录/文件。
  - 防止 symlink 指向沙箱外或源目录外。
- 创建 `src/opencode/finalJson.ts`
  - 从 opencode 最终文本中提取 JSON object。
  - 支持 raw JSON、fenced JSON；对多个 JSON object 或 malformed JSON 给出明确错误。

新增 opencode agent 适配层：

- 创建 `src/agent/opencodeTaskUnderstanding.ts`
  - 使用 opencode 执行任务理解，输出现有 `ConstraintSummary`。
- 创建 `src/agent/opencodeRuleAssessment.ts`
  - 使用 opencode 直接阅读 sandbox，输出规则判定结果。
- 创建 `src/agent/opencodeRubricScoring.ts`
  - 使用 opencode 直接阅读 sandbox，输出 rubric 评分结果。

修改现有 workflow/node：

- 修改 `src/config.ts`
  - 新增 opencode 配置读取。
  - 废弃 `MODEL_PROVIDER_BASE_URL`、`MODEL_PROVIDER_API_KEY`、`MODEL_PROVIDER_MODEL` 的运行时依赖。
- 修改 `src/workflow/scoreWorkflow.ts`
  - 构建并注入 opencode runtime、serve manager、runner、sandbox builder。
- 修改 `src/nodes/taskUnderstandingNode.ts`
  - 使用 opencode 任务理解。
  - opencode 缺失、运行失败或输出无效都按 agent 请求失败处理，不新增 API 直连或静默本地 fallback。
- 修改 `src/nodes/ruleAssessmentAgentNode.ts`
  - 替换 `runCaseAwareAgent`，调用 opencode 规则判定。
- 修改 `src/nodes/rubricScoringAgentNode.ts`
  - 替换 `runRubricCaseAwareAgent`，调用 opencode rubric 评分。
- 修改 `src/types.ts`、`src/workflow/state.ts`、报告 view model、observability 相关文件。
  - 删除 `tool_trace`、`turns`、`case_aware` 等旧内部观测字段，新增 opencode run record；保持下游业务结果字段不变。

迁移完成后删除旧协议文件：

- `src/agent/caseAwareAgentRunner.ts`
- `src/agent/rubricCaseAwareRunner.ts`
- `src/agent/caseTools.ts`
- `src/agent/caseToolSchemas.ts`
- `src/agent/caseAwarePrompt.ts`
- `src/agent/rubricCaseAwarePrompt.ts`
- `src/agent/caseAwareProtocol.ts`
- `src/agent/rubricCaseAwareProtocol.ts`
- `src/agent/caseAwareToolContract.ts`
- `src/agent/sharedCaseAwareToolCallSchema.ts`

## 部署环境变量约定

必须配置：

```bash
HMOS_AGENT_BACKEND=opencode
HMOS_OPENCODE_PORT=4096
HMOS_OPENCODE_HOST=127.0.0.1
HMOS_OPENCODE_PROVIDER_ID=hmos-openai-compatible
HMOS_OPENCODE_MODEL_ID=<provider-model-id>
HMOS_OPENCODE_MODEL_NAME=<human-readable-model-name>
HMOS_OPENCODE_BASE_URL=<provider-base-url>
HMOS_OPENCODE_API_KEY=<provider-api-key>
HMOS_OPENCODE_TIMEOUT_MS=600000
HMOS_OPENCODE_MAX_OUTPUT_BYTES=10485760
```

运行规则：

- 缺少 `opencode` CLI：启动失败。
- 缺少 provider/model/API key 配置：启动失败。
- `opencode serve` 健康检查失败：API 启动失败；CLI 本次执行失败。不要接受评分任务后再降级。
- 旧的 `MODEL_PROVIDER_*` 变量不再作为评分模型配置来源。
- 生产环境必须使用隔离运行时目录，避免继承用户全局 opencode 配置：

```bash
HOME=$PWD/.opencode/runtime/home
XDG_CONFIG_HOME=$PWD/.opencode/runtime/xdg-config
XDG_STATE_HOME=$PWD/.opencode/runtime/xdg-state
XDG_DATA_HOME=$PWD/.opencode/runtime/xdg-data
XDG_CACHE_HOME=$PWD/.opencode/runtime/xdg-cache
OPENCODE_CONFIG=$PWD/.opencode/runtime/opencode.generated.json
OPENCODE_CONFIG_DIR=$PWD/.opencode
```

## 工程级 opencode 配置模板

创建 `.opencode/opencode.template.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "snapshot": false,
  "share": "disabled",
  "model": "${HMOS_OPENCODE_PROVIDER_ID}/${HMOS_OPENCODE_MODEL_ID}",
  "small_model": "${HMOS_OPENCODE_PROVIDER_ID}/${HMOS_OPENCODE_MODEL_ID}",
  "server": {
    "hostname": "${HMOS_OPENCODE_HOST}",
    "port": ${HMOS_OPENCODE_PORT}
  },
  "provider": {
    "${HMOS_OPENCODE_PROVIDER_ID}": {
      "name": "HMOS Score OpenAI Compatible Provider",
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "${HMOS_OPENCODE_MODEL_ID}": {
          "name": "${HMOS_OPENCODE_MODEL_NAME}",
          "limit": {
            "context": 262144,
            "output": 32768
          },
          "modalities": {
            "input": ["text"],
            "output": ["text"]
          }
        }
      },
      "options": {
        "baseURL": "${HMOS_OPENCODE_BASE_URL}",
        "apiKey": "${HMOS_OPENCODE_API_KEY}",
        "timeout": ${HMOS_OPENCODE_TIMEOUT_MS},
        "chunkTimeout": 60000
      }
    }
  },
  }
}
```

说明：该文件是模板，不是最终运行配置。`src/opencode/opencodeConfig.ts` 必须替换 `${...}` 占位符，生成合法 JSON，并写入 `.opencode/runtime/opencode.generated.json`。

## Prompt 改造策略

删除所有要求模型输出 `tool_call` 的 prompt。新的 prompt 都是一次性 opencode 任务提示：

- 告诉 opencode 可以直接检查当前 sandbox。
- 明确可用的顶层目录。
- 要求只返回最终 JSON。
- 在 prompt 中给出目标 JSON shape 或 schema 摘要。
- 如果证据不足，要求输出 `needs_human_review: true` 和简短原因，不能向用户提问。
- prompt 的目标 JSON shape 必须来自现有 TypeScript 类型和校验函数，不能引入新的字段名或枚举值来“适配 opencode”。

规则判定 prompt 示例：

```text
你正在评估一个 HarmonyOS 用例。只能检查当前工作目录下的文件。

目录约定：
- generated/: 生成项目
- original/: 原始项目，如存在
- patch/: 有效 patch，如存在
- metadata/: 用例元数据
- references/: 规则参考文件

请评估 metadata/rule-candidates.json 中的每一条候选规则。

只返回下面这个 JSON object，不要输出其他文本：
{
  "summary": {
    "assistant_scope": "string",
    "overall_confidence": "high|medium|low"
  },
  "rule_assessments": [
    {
      "rule_id": "string",
      "decision": "violation|pass|not_applicable|uncertain",
      "confidence": "high|medium|low",
      "reason": "string",
      "evidence_used": ["string"],
      "needs_human_review": false
    }
  ]
}
```

rubric 评分 prompt 示例：

```text
你正在评估一个 HarmonyOS 生成结果。只能检查当前工作目录下的文件。

使用 references/rubric.yaml 和 metadata/rubric-summary.json。必要时比较 generated/、original/ 和 patch/。

只返回下面这个 JSON object，不要输出其他文本：
{
  "summary": {
    "overall_assessment": "string",
    "overall_confidence": "high|medium|low"
  },
  "item_scores": [
    {
      "dimension_name": "string",
      "item_name": "string",
      "score": 0,
      "max_score": 0,
      "matched_band_score": 0,
      "rationale": "string",
      "evidence_used": ["string"],
      "confidence": "high|medium|low",
      "review_required": false,
      "deduction_trace": {
        "code_locations": ["string"],
        "impact_scope": "string",
        "rubric_comparison": "string",
        "deduction_reason": "string",
        "improvement_suggestion": "string"
      }
    }
  ],
  "hard_gate_candidates": [
    {
      "gate_id": "G1|G2|G3|G4",
      "triggered": false,
      "reason": "string",
      "confidence": "high|medium|low"
    }
  ],
  "risks": [
    {
      "level": "string",
      "title": "string",
      "description": "string",
      "evidence": "string"
    }
  ],
  "strengths": ["string"],
  "main_issues": ["string"]
}
```

## Task 1：新增工程级 opencode 配置

**文件：**

- 创建 `.opencode/opencode.template.json`
- 创建 `.opencode/README.md`
- 修改 `.gitignore`

- [ ] **Step 1：编写失败测试**

创建 `tests/opencode-config.test.ts`，断言：

- `.opencode/opencode.template.json` 存在。
- 模板中没有明文 API key。
- 配置拒绝 `edit`、`bash`、`external_directory`。
- 配置不定义自定义 agent，避免依赖实际运行环境不存在的 agent 名称。

- [ ] **Step 2：运行测试确认失败**

运行：

```bash
npm test -- tests/opencode-config.test.ts
```

预期：失败，因为文件尚未创建。

- [ ] **Step 3：创建 `.opencode/` 文件**

按本方案中的模板创建 `.opencode/opencode.template.json`。

创建 `.opencode/README.md`，内容至少说明：

- 该目录是工程级 opencode 配置。
- 不依赖用户全局 opencode 配置。
- 运行时生成文件位于 `.opencode/runtime/`。
- opencode 只能读取每个用例的 sandbox。
- 禁止 shell、编辑、外部目录、web、question、subagent 类能力。

- [ ] **Step 4：忽略 runtime 目录**

在 `.gitignore` 中追加：

```gitignore
.opencode/runtime/
```

- [ ] **Step 5：运行测试确认通过**

运行：

```bash
npm test -- tests/opencode-config.test.ts
```

预期：通过。

## Task 2：生成隔离的 opencode 运行时配置

**文件：**

- 创建 `src/opencode/opencodeConfig.ts`
- 创建 `tests/opencode-config-generation.test.ts`

- [ ] **Step 1：编写失败测试**

覆盖以下行为：

- 缺少必需环境变量时抛出 `OpencodeConfigError`，错误消息包含缺失 key。
- 生成后的 JSON 中不存在 `${...}` 占位符。
- provider/model object key 已被替换为具体值。
- 生成的 env 中 `HOME`、`XDG_*`、`OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR` 都指向工程内 `.opencode/runtime` 或 `.opencode`。

- [ ] **Step 2：实现 `opencodeConfig.ts`**

导出：

```ts
export interface OpencodeRuntimeConfig {
  host: string;
  port: number;
  serverUrl: string;
  configPath: string;
  configDir: string;
  runtimeDir: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export class OpencodeConfigError extends Error {}

export async function createOpencodeRuntimeConfig(input: {
  repoRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<OpencodeRuntimeConfig>;
```

实现要求：

- 创建 `.opencode/runtime/` 及其子目录。
- 替换 `.opencode/opencode.template.json` 中所有 `${...}` 占位符。
- 解析生成内容，确保是合法 JSON。
- 写入 `.opencode/runtime/opencode.generated.json`。
- 返回隔离后的 env。

- [ ] **Step 3：运行测试**

```bash
npm test -- tests/opencode-config-generation.test.ts
```

预期：通过。

## Task 3：管理长期运行的 `opencode serve`

**文件：**

- 创建 `src/opencode/opencodeServeManager.ts`
- 创建 `tests/opencode-serve-manager.test.ts`

- [ ] **Step 1：编写失败测试**

mock `child_process` 和 `fetch`，覆盖：

- `ensureOpencodeCliAvailable()` 在 `command -v opencode` 失败时抛错。
- `start()` 先检查健康接口；健康时不重复 spawn。
- 健康检查失败时，spawn `opencode serve --hostname <host> --port <port> --pure`。
- `start()` 等待健康接口返回成功后才结束。
- `stop()` 只停止当前 manager 自己启动的 child process。

- [ ] **Step 2：实现 serve manager**

导出：

```ts
export interface OpencodeServeManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<boolean>;
  serverUrl(): string;
}

export function createOpencodeServeManager(config: OpencodeRuntimeConfig): OpencodeServeManager;
```

实现要求：

- 使用 `child_process.spawn`。
- 传入 `config.env`。
- stdout/stderr 写入服务日志，但不能打印 API key。
- 健康检查 URL 使用 `config.serverUrl`。

- [ ] **Step 3：运行测试**

```bash
npm test -- tests/opencode-serve-manager.test.ts
```

预期：通过。

## Task 4：构建每个用例的只读 sandbox

**文件：**

- 创建 `src/opencode/sandboxBuilder.ts`
- 创建 `tests/opencode-sandbox-builder.test.ts`

- [ ] **Step 1：编写失败测试**

覆盖：

- 生成项目复制到 `opencode-sandbox/generated`。
- 原始项目存在时复制到 `opencode-sandbox/original`。
- effective patch 复制到 `opencode-sandbox/patch/effective.patch`。
- 评分参考文件复制到 `opencode-sandbox/references`。
- `.env`、`.git`、`node_modules`、`oh_modules`、`build`、`dist`、`.hvigor` 被跳过。
- 指向源目录外的 symlink 被跳过。

- [ ] **Step 2：实现 sandbox builder**

导出：

```ts
export interface OpencodeSandbox {
  root: string;
  generatedRoot: string;
  originalRoot?: string;
  patchPath?: string;
  metadataRoot: string;
  referencesRoot: string;
}

export async function buildOpencodeSandbox(input: {
  caseDir: string;
  generatedProjectPath: string;
  originalProjectPath?: string;
  originalProjectProvided?: boolean;
  effectivePatchPath?: string;
  referenceRoot: string;
  metadata: Record<string, unknown>;
}): Promise<OpencodeSandbox>;
```

实现要求：

- 使用 `lstat` 和 `realpath` 做结构化遍历。
- 不跟随越界 symlink。
- 所有复制路径都必须相对源根目录归一化。
- 输出 `metadata/` 中的 JSON 文件必须不包含密钥、绝对私有路径或 API token。

- [ ] **Step 3：运行测试**

```bash
npm test -- tests/opencode-sandbox-builder.test.ts
```

预期：通过。

## Task 5：实现 opencode attached CLI runner

**文件：**

- 创建 `src/opencode/opencodeCliRunner.ts`
- 创建 `src/opencode/finalJson.ts`
- 创建 `tests/opencode-cli-runner.test.ts`
- 创建 `tests/opencode-final-json.test.ts`

- [ ] **Step 1：编写最终 JSON 提取测试**

覆盖：

- raw JSON。
- fenced JSON。
- JSON 前后有少量说明文本。
- malformed JSON。
- 输出中包含多个 JSON object 时返回错误。

- [ ] **Step 2：实现 `finalJson.ts`**

导出：

```ts
export class FinalJsonParseError extends Error {}

export function extractFinalJsonObject(rawText: string): Record<string, unknown>;
```

- [ ] **Step 3：编写 CLI runner 测试**

mock `child_process.spawn`，覆盖：

- 命令参数包含 `run`、`--attach`、server URL、`--dir`、sandbox root、`--format`、`json`；命令参数不得包含 `--agent`。
- 非 0 退出时错误包含 request tag 和 stderr 摘要。
- stdout 超过 `maxOutputBytes` 时 kill 进程并失败。
- 超时后 kill 进程并失败。
- JSON event stream 能提取最终 assistant message 文本。

- [ ] **Step 4：实现 CLI runner**

导出：

```ts
export interface OpencodeRunRequest {
  prompt: string;
  sandboxRoot: string;
  requestTag: string;
  title?: string;
}

export interface OpencodeRunResult {
  requestTag: string;
  rawText: string;
  rawEvents: string;
  elapsedMs: number;
}

export class OpencodeRunError extends Error {}

export async function runOpencodePrompt(input: {
  runtime: OpencodeRuntimeConfig;
  request: OpencodeRunRequest;
}): Promise<OpencodeRunResult>;
```

实现要求：

- 使用 `opencode run --attach <url> --dir <sandbox> --format json`，不得传入 `--agent`。
- 解析 JSON event stream，提取最终 assistant 文本。
- 对 stderr 做长度限制和脱敏。
- 对 requestTag、elapsedMs、sandboxRoot 记录到 artifact。
- prompt 不通过超长 argv 传递。固定将 prompt 写入 `.opencode/runtime/prompts/<requestTag>.md`，然后用短消息要求 opencode 严格按该 prompt 文件内容执行。该 prompt 文件不放入 case sandbox，不作为被评分代码证据；runner 负责生命周期和清理。

- [ ] **Step 5：运行测试**

```bash
npm test -- tests/opencode-final-json.test.ts tests/opencode-cli-runner.test.ts
```

预期：通过。

## Task 6：替换任务理解 agent 调用

**文件：**

- 创建 `src/agent/opencodeTaskUnderstanding.ts`
- 修改 `src/nodes/taskUnderstandingNode.ts`
- 修改 `src/workflow/scoreWorkflow.ts`
- 修改 `tests/task-understanding-node.test.ts`

- [ ] **Step 1：更新测试**

测试应覆盖：

- 任务理解使用 opencode runner，而不是 `AgentClient.understandTask`。
- 缺少 opencode runtime 在 workflow 依赖构造阶段失败。
- opencode 输出非法 JSON 时返回 `invalid_output` 或 `request_failed`，不回退到直接 LLM API，也不静默使用本地摘要覆盖 agent 失败。

- [ ] **Step 2：实现 opencode 任务理解**

要求：

- 复用现有任务理解 prompt 内容。
- 在 case sandbox 中运行 opencode。
- 使用现有 `parseConstraintSummary` 解析结果。
- 保持 `ConstraintSummary` 输出字段不变。
- 原始输出写入 `intermediate/opencode-task-understanding-raw.txt`。

- [ ] **Step 3：运行测试**

```bash
npm test -- tests/task-understanding-node.test.ts
```

预期：通过。

## Task 7：替换规则判定节点

**文件：**

- 创建 `src/agent/opencodeRuleAssessment.ts`
- 修改 `src/nodes/ruleAssessmentAgentNode.ts`
- 修改 `src/types.ts`
- 创建 `tests/opencode-rule-assessment.test.ts`
- 删除 `tests/case-aware-agent-runner.test.ts`，将仍有价值的业务完整性断言迁移到 `tests/opencode-rule-assessment.test.ts`

- [ ] **Step 1：编写 opencode 规则判定测试**

覆盖：

- prompt 中不再出现 `tool_call`。
- prompt 只引用 sandbox 目录，不引用源目录绝对路径。
- 返回 JSON 必须覆盖每条候选规则。
- 缺少 rule_id 时返回协议错误等价状态。
- 合法 opencode final JSON 必须已经符合 `AgentAssistedRuleResult`，并能直接被下游规则合并消费。

- [ ] **Step 2：实现 opencode 规则判定**

导出：

```ts
export async function runOpencodeRuleAssessment(input: {
  sandbox: OpencodeSandbox;
  bootstrapPayload: AgentBootstrapPayload;
  runPrompt: (request: OpencodeRunRequest) => Promise<OpencodeRunResult>;
  logger?: CaseLoggerLike;
}): Promise<OpencodeRuleAssessmentResult>;
```

实现要求：

- 不调用 `createCaseToolExecutor`。
- 不产生 turns/tool trace。
- 持久化 opencode raw events 和 final raw text。
- 迁移现有候选规则完整性校验为不依赖旧 protocol 文件的新校验函数；删除旧 protocol 文件后不能留下仅为兼容旧 runner 的引用。
- 映射后的 `ruleAgentAssessmentResult` 字段和语义必须与迁移前一致。

- [ ] **Step 3：修改 node**

`ruleAssessmentAgentNode` 调用 `runOpencodeRuleAssessment`。内部观测 mode 可改为 `opencode_direct`；下游业务字段继续输出现有 `ruleAgentAssessmentResult`、`ruleAgentRunStatus` 等必要字段，避免破坏 score fusion 和报告消费方。

- [ ] **Step 4：运行测试**

```bash
npm test -- tests/opencode-rule-assessment.test.ts tests/rule-engine.test.ts tests/score-fusion.test.ts
```

预期：通过。

## Task 8：替换 rubric 评分节点

**文件：**

- 创建 `src/agent/opencodeRubricScoring.ts`
- 修改 `src/nodes/rubricScoringAgentNode.ts`
- 修改 `src/types.ts`
- 创建 `tests/opencode-rubric-scoring.test.ts`
- 删除 `tests/rubric-case-aware-runner.test.ts`，将仍有价值的业务完整性断言迁移到 `tests/opencode-rubric-scoring.test.ts`

- [ ] **Step 1：编写 rubric 测试**

覆盖：

- prompt 中不再出现 `tool_call`。
- prompt 引导 opencode 读取 `references/`、`metadata/`、`generated/`、`original/`、`patch/`。
- 合法 final JSON 能映射为 `RubricScoringResult`。
- 缺少 rubric item、缺少 `hard_gate_candidates`、缺少 `risks`/`strengths`/`main_issues`，或 item 字段名不符合 `RubricScoringItemScore` 时返回协议错误等价状态。

- [ ] **Step 2：实现 opencode rubric 评分**

导出：

```ts
export async function runOpencodeRubricScoring(input: {
  sandbox: OpencodeSandbox;
  payload: RubricScoringPayload;
  runPrompt: (request: OpencodeRunRequest) => Promise<OpencodeRunResult>;
  logger?: CaseLoggerLike;
}): Promise<OpencodeRubricScoringResult>;
```

实现要求：

- 不使用本地工具循环。
- 校验所有 rubric item 都有评分。
- 校验每个 item 使用现有 `RubricScoringItemScore` 字段：`dimension_name`、`item_name`、`score`、`max_score`、`matched_band_score`、`rationale`、`evidence_used`、`confidence`、`review_required`。不要接受 `item_id`、`reason`、`evidence`、`needs_human_review`、`total_score` 作为替代字段。
- 保持现有 `RubricScoringResult` 顶层结构，不新增总分字段；总分仍由 score fusion 根据 item_scores 计算。
- 映射后的 `rubricScoringResult` 字段和语义必须与迁移前一致。
- 持久化 raw events 和 final raw text。

- [ ] **Step 3：修改 node**

`rubricScoringAgentNode` 调用 `runOpencodeRubricScoring`，产出 `rubricScoringResult` 给后续 score fusion。

- [ ] **Step 4：运行测试**

```bash
npm test -- tests/opencode-rubric-scoring.test.ts tests/rubric-scoring.test.ts tests/score-fusion.test.ts
```

预期：通过。

## Task 9：把 opencode 接入 workflow 启动流程

**文件：**

- 修改 `src/config.ts`
- 修改 `src/workflow/scoreWorkflow.ts`
- 修改 `src/index.ts`
- 修改 `src/cli.ts`
- 修改 `tests/config-reference.test.ts`
- 修改 `tests/score-agent.test.ts`

- [ ] **Step 1：更新配置测试**

断言：

- 新的 `HMOS_OPENCODE_*` 环境变量被读取。
- 旧的直接模型 provider env 不再被评分 agent 读取；即使存在也不影响 opencode 配置。
- `HMOS_AGENT_BACKEND=opencode` 时必须构造 opencode runtime。
- 不新增可切回 `ChatModelClient` 的兼容 backend。

- [ ] **Step 2：实现 workflow 依赖构造**

API 和 CLI 入口启动时执行：

1. 创建 opencode runtime config。
2. 检查 opencode CLI。
3. 启动或连接 opencode serve。
4. 把 opencode runner 和 sandbox builder 传入 workflow。

- [ ] **Step 3：实现缺失 CLI 的致命错误**

`opencode` 不存在时：

- API：启动失败，不接受评分任务。
- CLI：打印明确错误并非 0 退出。

- [ ] **Step 4：运行测试**

```bash
npm test -- tests/config-reference.test.ts tests/score-agent.test.ts
```

预期：通过。

## Task 10：删除本地 `tool_call` 协议

**文件：**

- 删除旧协议文件。
- 修改引用旧协议的测试。
- 修改 observability 中的 tool trace 展示。
- 报告主体业务字段保持不变，只删除或替换旧 agent 调试区的 tool trace 展示。

- [ ] **Step 1：搜索旧协议引用**

运行：

```bash
rg -n "tool_call|tool_trace|case_aware|CaseTool|runCaseAwareAgent|runRubricCaseAwareAgent|createCaseToolExecutor" src tests docs README.md
```

预期：清理前会有大量匹配。

- [ ] **Step 2：替换运行时字段**

新增内部观测结构，不替换下游业务结果结构：

```ts
export interface OpencodeAgentRunRecord {
  request_tag: string;
  status: "success" | "invalid_output" | "request_failed";
  elapsed_ms: number;
  sandbox_root: string;
  raw_output_path?: string;
  raw_events_path?: string;
  failure_reason?: string;
}
```

- [ ] **Step 3：更新报告**

报告调试/中间产物区域可以展示：

- opencode direct 模式。
- opencode run status。
- sandbox manifest 路径。
- raw events/final output artifact 路径。

报告主体评分内容、schema 和上传 payload 保持不变。报告不再展示本地 turn-by-turn tool trace。

- [ ] **Step 4：删除旧协议测试并迁移业务断言**

删除只验证本地 tool-call 协议的测试。仍有价值的 final JSON 校验和候选完整性断言必须迁移到 opencode direct 测试中，不能留下旧 runner 测试文件作为兼容保护。

- [ ] **Step 5：确认清理结果**

再次运行搜索命令。

预期：除历史设计文档和本迁移方案外，运行时代码不再引用旧协议。

## Task 11：部署与可观测性文档

**文件：**

- 修改 `README.md`
- 修改 `.env.example`
- 创建 `docs/opencode-deployment.md`

- [ ] **Step 1：文档化本地开发启动方式**

补充：

```bash
export HMOS_AGENT_BACKEND=opencode
export HMOS_OPENCODE_PORT=4096
export HMOS_OPENCODE_HOST=127.0.0.1
export HMOS_OPENCODE_PROVIDER_ID=hmos-openai-compatible
export HMOS_OPENCODE_MODEL_ID=<model>
export HMOS_OPENCODE_MODEL_NAME=<model>
export HMOS_OPENCODE_BASE_URL=<base-url>
export HMOS_OPENCODE_API_KEY=<api-key>
npm run dev:api
```

- [ ] **Step 2：文档化生产 sidecar 形态**

推荐生产形态：

- 评分 API 进程持有工程 `.opencode/` 配置。
- opencode runtime/state/cache/log 使用服务专属目录。
- `opencode serve` 只监听 `127.0.0.1`。
- 只有评分 API 可以调用 opencode server。
- 如果 server 暴露在进程命名空间外，设置 `OPENCODE_SERVER_PASSWORD`。
- 初期并发限制为 `1-2`，确认 session 隔离和资源占用后再提高。

- [ ] **Step 3：文档化用例 artifacts**

每个用例至少保留：

- `intermediate/opencode-sandbox-manifest.json`
- `intermediate/opencode-task-understanding-raw.txt`
- `intermediate/opencode-rule-assessment-events.jsonl`
- `intermediate/opencode-rule-assessment-final.txt`
- `intermediate/opencode-rubric-scoring-events.jsonl`
- `intermediate/opencode-rubric-scoring-final.txt`

## Task 12：验证矩阵

**文件：**

- 现有测试套件。
- 一个真实或代表性本地 case fixture。

- [ ] **Step 1：静态验证**

```bash
npm run lint
npm run build
```

预期：全部通过。

- [ ] **Step 1.5：输出契约回归验证**

使用现有 mock agent 输出 fixture 或新增固定 fixture，分别覆盖任务理解、规则判定、rubric 评分和最终报告。比较迁移前后这些业务对象的 JSON shape 和关键字段：

- `constraintSummary`
- `ruleAgentAssessmentResult`
- `rubricScoringResult`
- `scoreFusionResult`
- 最终报告 schema 校验结果

预期：除内部 opencode artifact 路径和 agent mode/debug 字段外，业务输出不发生字段名、枚举值、分数计算或报告主体变化。

- [ ] **Step 2：完整单测**

```bash
npm test
```

预期：通过，旧 tool-call 测试已删除，仍有价值的业务断言已迁移到 opencode direct 测试。

- [ ] **Step 3：CLI 缺失验证**

用不包含 `opencode` 的 PATH 启动 API 或 CLI。

预期：立即失败，错误消息清晰，不接受评分任务。

- [ ] **Step 4：sandbox 越界验证**

创建一个 case，其中 `generated/` 内有 symlink 指向 case 外部文件。

预期：sandbox builder 跳过该 symlink；opencode 不能读取目标文件；manifest 记录跳过项。

- [ ] **Step 5：拒绝工具验证**

使用一个 prompt fixture，诱导模型尝试 shell、edit、web、external directory。

预期：opencode 不能使用这些能力；不发生文件修改；raw events 中能观察到拒绝或无对应工具调用。

- [ ] **Step 6：端到端评分验证**

使用 `npm run score` 或 API endpoint 跑一个代表性本地 case。

预期：

- opencode serve 健康。
- sandbox 创建成功。
- 任务理解、规则判定、rubric 评分均通过 opencode。
- 规则和 rubric JSON 被解析并参与后续融合。
- 报告生成成功。
- 业务输出契约与迁移前一致。
- 新 runtime artifacts 中不再出现 `tool_call` 或 `tool_trace`。

## 迁移顺序

1. 新增 `.opencode/` 配置、runtime config、serve manager、sandbox builder，先通过 mock 测试。
2. 接入 opencode task understanding。
3. 接入 opencode rule assessment。
4. 接入 opencode rubric scoring。
5. 替换 workflow/state/types/report 中的旧内部观测字段，保持业务输出字段不变。
6. 删除本地 `tool_call` 协议文件和旧测试。
7. 更新 README、`.env.example` 和部署文档。
8. 使用真实 opencode server 跑一个端到端用例。
9. 再开启远程评分流量。

## 风险与缓解

- **风险：opencode 仍继承用户全局配置。**
  - 缓解：启动时设置隔离的 `HOME` 和所有 `XDG_*`，并显式设置 `OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR`。
- **风险：opencode 权限字段随版本变化。**
  - 缓解：增加配置测试；部署 smoke test 中运行 `opencode debug config`，检查关键工具权限是否为 deny。
- **风险：opencode 在工作目录内仍能读取过多文件。**
  - 缓解：永远在最小化 sandbox 中运行，不在服务仓库或原始上传根目录运行。
- **风险：`opencode run --attach --format json` 事件格式变化。**
  - 缓解：事件解析集中在 `opencodeCliRunner.ts`，保存 raw events，并用部署版本的真实 event fixture 做测试。
- **风险：长期运行 server 泄漏 session 或状态。**
  - 缓解：每个请求使用新 run/session；记录 session id；初期限制并发；定期重启 sidecar。
- **风险：没有 `response_format` 后最终 JSON 稳定性下降。**
  - 缓解：严格 prompt、本地 JSON 提取、本地 schema 校验、invalid output 状态和 raw artifact 保留。
- **风险：为了兼容 opencode 输出而改变业务 schema。**
  - 缓解：prompt 必须贴合现有类型；opencode 输出先映射回现有业务结构，再进入现有校验和 score fusion；新增输出字段只能进入 opencode debug artifact，不能进入业务结果。
- **风险：迁移时顺手重构无关模块引入回归。**
  - 缓解：禁止改动规则引擎、rubric loader、score fusion 算法和报告主体模板；只允许改依赖注入、agent 调用、旧协议删除和必要测试。
- **风险：sandbox 复制大项目导致性能下降。**
  - 缓解：复用现有 ignored files 规则；跳过构建产物和依赖目录；记录 sandbox 文件数量和字节数；必要时改为硬链接或只读 bind mount，但必须保持越界保护。

## 完成标准

- 服务启动时找不到 `opencode` 会明确失败。
- 评分流程不再调用 `/chat/completions`。
- 运行时代码不再创建或注入 `ChatModelClient` 作为评分 agent fallback。
- 所有模型辅助评分步骤都通过 opencode。
- 任务理解、规则判定、rubric 评分的业务输出字段和含义与迁移前一致。
- opencode 使用工程自带 `.opencode/` 配置和隔离 runtime 目录。
- 每个用例都有独立最小 sandbox。
- opencode 权限拒绝 edit、bash、task、web、external directory、question。
- 旧本地 `tool_call` 协议文件已删除或不再被运行时代码引用。
- 报告和 artifacts 展示 opencode direct 状态，而不是本地工具轨迹。
- score fusion 算法、规则引擎、rubric loader 和报告主体未做无关重构。
- `npm run lint`、`npm run build`、`npm test` 通过。
- 至少一个真实 opencode 端到端用例通过。
