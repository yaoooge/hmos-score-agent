# hmos-score-agent

基于 LangGraph + TypeScript 的 HarmonyOS 代码评分服务骨架。  
目标是把“原始工程 + prompt + 生成工程 + patch”作为单条用例输入，执行统一评分工作流，输出结构化 `result.json` 与可视化 `report.html`。

## 1. 工程如何运作

### 核心流程

当前工作流在 `src/workflow/scoreWorkflow.ts`，按固定顺序串联节点：

1. `taskUnderstandingNode`：任务理解（显式/上下文/隐式约束）
2. `inputClassificationNode`：任务分类（`full_generation` / `continuation` / `bug_fix`）
3. `featureExtractionNode`：代码特征抽取（基础/结构/语义/变更）
4. `ruleAuditNode`：规则审计（读取 `arkts_internal_rules.yaml`）
5. `scoringOrchestrationNode`：评分编排（加权、硬门槛预留）
6. `reportGenerationNode`：组装 `result.json` 与 HTML 报告内容
7. `persistAndUploadNode`：落盘并尝试上传 `result.json`

### 输入与输出

- 默认输入目录：`init-input`
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
- `DEFAULT_REFERENCE_ROOT`：rubric/rules/schema 参考目录
- `UPLOAD_ENDPOINT`：结果上传地址（为空则跳过上传）
- `UPLOAD_TOKEN`：上传鉴权 token（可选）

## 3. 本地调试

### 3.1 CLI 调试（推荐）

直接跑默认用例：

```bash
npm run dev:cli -- --case init-input
```

成功后终端会打印用例产物目录，例如：

```text
Scoring completed. Case artifacts: .../.local-cases/init-input
Upload: UPLOAD_ENDPOINT is empty; skipped upload.
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
  -d '{"casePath":"init-input"}'
```

## 4. 常用命令

- `npm run build`：TypeScript 编译检查
- `npm run dev:cli -- --case <path>`：命令行运行单用例
- `npm run dev:api`：本地 HTTP 服务调试
- `npm run score -- --case <path>`：与 `dev:cli` 等价
- `npm run case:patch -- --case <path>`：基于 `original/` 和 `workspace/` 目录差异生成 `diff/changes.patch`

### Patch 生成说明

`init-input/workspace` 应作为主仓库中的普通目录使用，不依赖独立 Git 仓库。需要 patch 时，统一通过目录差异生成：

```bash
npm run case:patch -- --case init-input
```

底层等价于在用例目录执行：

```bash
git diff --no-index -- original workspace > diff/changes.patch
```

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
