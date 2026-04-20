# hmos-score-agent

基于 LangGraph + TypeScript 的 HarmonyOS 代码评分服务骨架。  
目标是把“原始工程 + prompt + 生成工程 + patch”作为单条用例输入，执行统一评分工作流，输出结构化 `result.json` 与可视化 `report.html`。

## 1. 工程如何运作

### 核心流程

当前工作流在 `src/workflow/scoreWorkflow.ts`，按固定顺序串联节点：

1. `taskUnderstandingNode`：任务理解（显式/上下文/隐式约束）
2. `inputClassificationNode`：任务分类（`full_generation` / `continuation` / `bug_fix`）
3. `featureExtractionNode`：代码特征抽取（基础/结构/语义/变更）
4. `ruleAuditNode`：规则审计，产出确定性规则结果、Agent 辅助候选规则、证据索引和违规项
5. `rubricPreparationNode`：按任务类型加载 rubric，并生成评分快照
6. `agentPromptBuilderNode`：基于任务信息、rubric、规则结果组装 Agent 判定 prompt 与 payload
7. `agentAssistedRuleNode`：调用 Agent 对候选规则做辅助判定；无候选或未配置 client 时会跳过
8. `ruleMergeNode`：合并确定性规则结果与 Agent 判定结果；Agent 不可用时回退为“待人工复核”
9. `scoringOrchestrationNode`：基于合并后的规则审计结果、rubric、特征与约束执行评分编排
10. `reportGenerationNode`：生成并校验结构化 `result.json`
11. `artifactPostProcessNode`：基于 `result.json` 渲染 `report.html`
12. `persistAndUploadNode`：写入输入/中间产物/输出文件，并按配置尝试上传 `result.json`

### 输入与输出

- 默认输入目录：`cases/` 下按名称排序后的首个用例目录
- 用例输入结构（骨架约定）：
  - `input.txt`：prompt
  - `original/`：原始工程
  - `workspace/`：生成工程
  - `diff/changes.patch`：patch（可选）

运行后会在本地生成：

- `.local-cases/<caseId>/inputs/`
- `.local-cases/<caseId>/intermediate/`
  - `constraint-summary.json`
  - `feature-extraction.json`
  - `rule-audit.json`
- `.local-cases/<caseId>/outputs/`
  - `result.json`
  - `report.html`

## 2. 快速开始

### 环境要求

- Node.js 18+（建议 20+）
- npm 9+

### 安装依赖

```bash
npm install
```

### 环境变量

先复制模板：

```bash
cp .env.example .env
```

关键变量：

- `LOCAL_CASE_ROOT`：本地产物目录，默认 `.local-cases`
- `DEFAULT_REFERENCE_ROOT`：评分参考目录，默认 `references/scoring`
- `MODEL_PROVIDER_BASE_URL`：兼容 chat completions 的模型服务地址
- `MODEL_PROVIDER_API_KEY`：模型服务鉴权密钥
- `MODEL_PROVIDER_MODEL`：模型名称，默认 `gpt-5.4`
- `UPLOAD_ENDPOINT`：结果上传地址（为空则跳过上传）
- `UPLOAD_TOKEN`：上传鉴权 token（可选）

默认参考资源：

- `references/scoring/rubric.yaml`
- `references/scoring/report_result_schema.json`

评分规则:

-  `src/rules/packs/`。

## 3. 本地调试

### 3.1 CLI 调试（推荐）

直接跑默认用例：

```bash
npm run dev:cli -- --case cases/bug_fix_001
```

成功后终端会打印用例产物目录，例如：

```text
评分完成，结果目录：.../.local-cases/20260416T112233_bug_fix_a1b2c3d4
上传信息：未配置 UPLOAD_ENDPOINT，已跳过上传。
```

### 3.2 API 调试

启动服务：

```bash
npm run dev:api
```

健康检查：

```bash
curl http://localhost:3000/health
```

触发评分：

```bash
curl -X POST http://localhost:3000/score/run \
  -H "Content-Type: application/json" \
  -d '{"casePath":"cases/bug_fix_001"}'
```

触发云端直推远程评分任务：

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
  "token": "后续 callback 鉴权使用",
  "callback": "http://localhost:3000/api/evaluation-tasks/callback"
}
```

调用方式：

```bash
curl -X POST http://localhost:3000/score/run-remote-task \
  -H "Content-Type: application/json" \
  -d '{
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
    "token": "后续 callback 鉴权使用",
    "callback": "http://localhost:3000/api/evaluation-tasks/callback"
  }'
```

当前远程资源格式约定：

- `testCase.fileUrl`：下载原始工程目录清单 JSON
- `executionResult.outputCodeUrl`：下载待评分工程目录清单 JSON
- `executionResult.diffFileUrl`：下载 patch 文本，可选
- 目录清单 JSON 结构为：

```json
{
  "files": [
    {
      "path": "entry/src/main/ets/pages/Index.ets",
      "content": "@Entry\n@Component\nstruct Index {}"
    }
  ]
}
```

执行完成后，服务会向 `callback` 发起 `POST` 回传，header 使用 `token: <token>`，请求体格式如下：

```json
{
  "taskId": 4,
  "status": "completed",
  "totalScore": 85,
  "maxScore": 100,
  "resultData": {
    "basic_info": {
      "rubric_version": "v1"
    }
  }
}
```

## 4. 常用命令

- `npm run build`：TypeScript 编译检查
- `npm run dev:cli -- --case <path>`：命令行运行单用例
- `npm run dev:api`：本地 HTTP 服务调试
- `npm run launch:score`：交互式填写 `baseURL` / `apiKey`，写入 `.env` 后运行评分流程
- `npm run score -- --case <path>`：与 `dev:cli` 等价
- `npm run case:patch -- --case <path>`：基于 `original/` 和 `workspace/` 目录差异生成 `diff/changes.patch`

### 交互式启动评分

执行：

```bash
npm run launch:score
```

如需指定自定义用例目录：

```bash
npm run launch:score -- --case examples/my-case
```

脚本会：

1. 在终端里询问 `MODEL_PROVIDER_BASE_URL` 和 `MODEL_PROVIDER_API_KEY`
2. 将输入结果写入项目根目录 `.env`
3. 读取 `--case` 指定目录；未指定时默认读取 `cases/` 下按名称排序后的首个用例目录
4. 启动评分流程
5. 在 `.local-cases/` 下创建 `时间_task_type_唯一id` 目录并写入产物
6. 将初始 prompt 落盘到 `inputs/prompt.txt`
7. 将用例元信息落盘到 `inputs/case-info.json`
8. 将关键运行日志追加写入 `logs/run.log`

### Patch 生成说明

`cases/<caseId>/workspace` 应作为主仓库中的普通目录使用，不依赖独立 Git 仓库。需要 patch 时，统一通过目录差异生成：

```bash
npm run case:patch -- --case cases/bug_fix_001
```

底层等价于在用例目录执行：

```bash
git diff --no-index -- original workspace > diff/changes.patch
```

### Patch 与评测过滤

- `case:patch` 会分别读取 `original/.gitignore` 和 `workspace/.gitignore`
- 规则评测采集文件时，也会按对应目录根级 `.gitignore` 过滤
- 当前仅支持根级 `.gitignore` 的常见规则，例如目录模式、文件模式和简单 `*` 通配
- 如果 `.gitignore` 缺失或不可读，会回退到内置的保底忽略项

## 5. 当前实现状态（骨架阶段）

已完成：

- LangGraph 节点编排与状态骨架
- 本地输入加载与产物目录落盘
- 规则文件读取与审计节点接口
- 结果 JSON/HTML 产物输出
- HTTP 上传接口预留

未完成（后续增强）：

- 规则逐条证据级判定（满足/不满足/不涉及的真实判定）
- rubric 权重计算与硬门槛完整实现
- 更严格的 schema 校验链路与维度细分评分
- 远程下载输入（URL 模式）完整接入

## 6. 代码结构速览

```text
src/
  cli.ts
  index.ts
  service.ts
  config.ts
  types.ts
  io/
    caseLoader.ts
    artifactStore.ts
    uploader.ts
    downloader.ts
  workflow/
    state.ts
    scoreWorkflow.ts
  nodes/
    taskUnderstandingNode.ts
    inputClassificationNode.ts
    featureExtractionNode.ts
    ruleAuditNode.ts
    scoringOrchestrationNode.ts
    reportGenerationNode.ts
    persistAndUploadNode.ts
```
