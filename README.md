# hmos-score-agent

基于 LangGraph + TypeScript 的 HarmonyOS 代码评分服务。工作流把“原始工程 + prompt + 生成工程 + patch”作为单条用例输入，通过 opencode 接管任务理解、rubric 评分和规则辅助判定，最终输出结构化 `result.json` 与可视化 `report.html`。

## 1. 工程如何运作

### 核心流程

当前工作流在 `src/workflow/scoreWorkflow.ts`，按固定顺序串联节点：

1. `remoteTaskPreparationNode`：远端任务预处理，下载并物化标准 case；本地 case 会直接进入任务理解。
2. `taskUnderstandingNode`：构建 opencode sandbox，完成显式/上下文/隐式约束理解。
3. `inputClassificationNode`：任务分类（`full_generation` / `continuation` / `bug_fix`）。
4. `ruleAuditNode`：静态规则审计，产出确定性规则结果、Agent 辅助候选规则、证据索引和违规项。
5. `rubricPreparationNode`：按任务类型加载 rubric，并生成评分快照。
6. `rubricScoringPromptBuilderNode`：组装 rubric 评分 payload 和落盘 prompt。
7. `ruleAgentPromptBuilderNode`：组装规则辅助判定 payload 和落盘 prompt。
8. `rubricScoringAgentNode`：通过 opencode 在只读 sandbox 内完成 rubric 逐项评分。
9. `ruleAssessmentAgentNode`：通过 opencode 在只读 sandbox 内完成候选规则辅助判定。
10. `ruleMergeNode`：合并确定性规则结果与 opencode 规则判定结果。
11. `scoreFusionOrchestrationNode`：基于合并后的规则审计结果、rubric 与约束执行评分融合。
12. `reportGenerationNode`：生成并校验结构化 `result.json`。
13. `artifactPostProcessNode`：基于 `result.json` 渲染 `report.html`。
14. `persistAndUploadNode`：写入输入、中间产物和输出文件，并按需回调上传。

生产运行时不会回退到直接模型 API。工作流启动时会先检查 `opencode` CLI 是否可用，再基于工程内 `.opencode/opencode.template.json` 生成运行时配置并启动或复用长期 `opencode serve`。缺少 CLI、缺少 opencode 环境变量或 serve 健康检查失败都会直接失败。

### 输入与输出

默认输入目录：`cases/` 下按名称排序后的首个用例目录。

用例输入结构：

- `input.txt`：prompt
- `original/`：原始工程
- `workspace/`：生成工程
- `diff/changes.patch`：patch，可选；缺失或为空时会由 `original/` 和 `workspace/` 生成有效 patch

opencode 不直接读取原始 case 目录。每次评分都会创建只读 sandbox，并把材料映射为：

- `generated/`：待评分生成工程，对应 case 的 `workspace/`
- `original/`：原始工程
- `patch/effective.patch`：本次评分实际使用的 patch
- `metadata/`：任务、规则、结构摘要等元数据
- `references/`：评分参考材料

运行后会在本地生成：

- `.local-cases/<caseId>/inputs/`
- `.local-cases/<caseId>/intermediate/`
  - `constraint-summary.json`
  - `rule-audit.json`
  - `opencode-sandbox/`
- `.local-cases/<caseId>/outputs/`
  - `result.json`
  - `report.html`

## 2. 快速开始

### 环境要求

- Node.js 18+（建议 20+）
- npm 9+
- `opencode` CLI，运行进程必须能直接执行 `opencode`

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
- `HMOS_OPENCODE_HOST`：`opencode serve` 监听地址，建议 `127.0.0.1`
- `HMOS_OPENCODE_PORT`：`opencode serve` 监听端口
- `HMOS_OPENCODE_PROVIDER_ID`：工程级 opencode provider 标识
- `HMOS_OPENCODE_MODEL_ID`：工程级 opencode model 标识
- `HMOS_OPENCODE_MODEL_NAME`：展示用模型名称
- `HMOS_OPENCODE_BASE_URL`：OpenAI-compatible provider 地址
- `HMOS_OPENCODE_API_KEY`：provider 鉴权密钥
- `HMOS_OPENCODE_TIMEOUT_MS`：单次 opencode 调用超时时间
- `HMOS_OPENCODE_MAX_OUTPUT_BYTES`：单次 opencode 输出上限

工程级 opencode 配置位于 `.opencode/`：

- `.opencode/opencode.template.json`：受版本管理的模板
- `.opencode/README.md`：权限和运行时说明
- `.opencode/runtime/`：运行时生成目录，已加入 `.gitignore`

默认参考资源：

- `references/scoring/rubric.yaml`
- `references/scoring/report_result_schema.json`

评分规则位于 `src/rules/packs/`。

## 3. 本地调试

### CLI 调试

直接跑指定用例：

```bash
npm run dev:cli -- --case cases/bug_fix_001
```

成功后终端会打印用例产物目录，例如：

```text
评分完成，结果目录：.../.local-cases/20260416T112233_bug_fix_a1b2c3d4
```

### API 调试

启动服务：

```bash
npm run dev:api
```

健康检查：

```bash
curl http://localhost:3000/health
```

触发远端评分任务：

```bash
curl -X POST http://localhost:3000/score/run-remote-task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": 4,
    "testCase": {
      "id": 8,
      "name": "remote-case",
      "type": "requirement",
      "description": "新增页面",
      "input": "请实现登录页",
      "expectedOutput": "实现登录页",
      "fileUrl": "https://example.com/original.json"
    },
    "executionResult": {
      "isBuildSuccess": true,
      "outputCodeUrl": "https://example.com/workspace.json",
      "diffFileUrl": "https://example.com/changes.patch"
    },
    "token": "callback-token",
    "callback": "http://localhost:3000/api/evaluation-tasks/callback"
  }'
```

接口完成以下同步阶段后立即返回：

- 远端目录清单和 patch 下载
- case 物化
- 初始任务分析
- 任务类型判定

后台评分阶段按接收顺序排队执行，完成后向 `callback` 发起 `POST` 回传，header 使用 `token: <token>`。

成功响应示例：

```json
{
  "success": true,
  "taskId": 4,
  "caseDir": "/abs/path/.local-cases/full_generation_xxx",
  "message": "任务接收成功，结果将通过 callback 返回"
}
```

回调请求体示例：

```json
{
  "success": true,
  "taskId": 4,
  "status": "completed",
  "resultData": {
    "basic_info": {},
    "overall_conclusion": {}
  }
}
```

`completed` 回调的 `resultData` 只保留完整结果中的 `basic_info` 和 `overall_conclusion`；完整 `outputs/result.json` 由管理台通过结果查询接口获取。

远程资源格式约定：

- `testCase.fileUrl`：原始工程目录清单 JSON
- `executionResult.outputCodeUrl`：待评分工程目录清单 JSON
- `executionResult.diffFileUrl`：patch 文本，可选

目录清单 JSON 结构：

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

## 4. 常用命令

- `npm run build`：TypeScript 编译检查
- `npm test`：运行全部 node:test 测试
- `npm run dev:cli -- --case <path>`：命令行运行单用例
- `npm run dev:api`：本地 HTTP 服务调试
- `npm run launch:score -- --case <path>`：交互式选择或指定用例并启动评分
- `npm run score -- --case <path>`：与 `dev:cli` 等价

### Patch 生成说明

`cases/<caseId>/workspace` 应作为主仓库中的普通目录使用，不依赖独立 Git 仓库。评分主流程会在运行期基于 `original/` 和 `workspace/` 目录差异生成有效 patch，底层等价于在用例目录执行：

```bash
git diff --no-index -- original workspace > diff/changes.patch
```

Patch 生成逻辑会分别读取 `original/.gitignore` 和 `workspace/.gitignore`。规则评测采集文件时，也会按对应目录根级 `.gitignore` 过滤。如果 `.gitignore` 缺失或不可读，会回退到内置保底忽略项。

## 5. 代码结构速览

```text
hmos-score-agent/
  README.md                         # 使用说明、调试入口与代码结构速览
  package.json                      # npm 脚本、运行时依赖与开发依赖声明
  tsconfig.json                     # TypeScript 编译配置
  .env.example                      # 本地环境变量模板
  .opencode/                        # 工程级 opencode 配置模板和运行时目录
    opencode.template.json          # 只读权限、provider、server 配置模板
    README.md                       # opencode 接入说明
    runtime/                        # 运行时生成，禁止提交
  references/
    scoring/                        # 评分 rubrics、结果 schema 与评分说明文档
      rubric.yaml                   # 不同任务类型的维度/指标/分值配置
      report_result_schema.json     # result.json 输出结构校验 schema
      *_rubric.md                   # full_generation / continuation / bug_fix 评分细则
    rules/                          # 内置静态规则包的 YAML 导出结果
  src/
    index.ts                        # Express API 入口，注册本地评分与远端任务接口
    cli.ts                          # CLI 入口，按 --case 或默认用例执行评分
    service.ts                      # 评分服务编排层，连接用例加载、工作流与回调上传
    config.ts                       # 环境变量读取与默认配置归一化
    types.ts                        # 远端任务、用例、评分、报告等共享类型定义
    agent/                          # opencode 任务理解、rubric 评分和规则判定入口
      opencodeTaskUnderstanding.ts  # 任务理解 opencode 调用与结果归一化
      opencodeRubricScoring.ts      # rubric 评分 opencode 调用与结果校验
      opencodeRuleAssessment.ts     # 规则辅助判定 opencode 调用与结果校验
      opencodeRubricPrompt.ts       # rubric 评分 payload 和落盘 prompt 构建
      ruleAssistance.ts             # 规则候选选择、payload 构建与结果合并
    opencode/                       # CLI、serve、sandbox 和最终 JSON 提取封装
      opencodeConfig.ts             # 生成工程级 opencode runtime 配置
      opencodeServeManager.ts       # 启动或复用 opencode serve
      opencodeCliRunner.ts          # 调用 opencode run --attach
      sandboxBuilder.ts             # 构建每用例只读 sandbox
      finalJson.ts                  # 提取 opencode 最终 JSON object
    io/                             # 文件、网络、日志、patch 与产物读写工具
      caseLoader.ts                 # 从本地 case 目录加载 input/original/workspace/diff
      artifactStore.ts              # 管理 .local-cases 下 inputs/intermediate/outputs/logs
      downloader.ts                 # 下载远端目录清单、zip 或文本资源
      uploader.ts                   # 向回调地址上传最终评分结果
      patchGenerator.ts             # 基于 original/workspace 生成 gitignore-aware patch
      caseLogger.ts                 # 单用例日志写入封装
    workflow/                       # LangGraph 评分工作流定义与流式观测
      scoreWorkflow.ts              # 组装评分图节点、边和执行逻辑
      state.ts                      # 工作流状态字段定义
      observability/                # 节点标签、摘要、custom event 与日志解释器
    nodes/                          # 工作流节点实现，每个文件对应一个评分阶段
      remoteTaskPreparationNode.ts  # 远端任务预处理与初始状态补齐
      taskUnderstandingNode.ts      # 读取任务材料并生成任务理解结果
      opencodeSandboxPreparationNode.ts # 预处理恢复执行时补建 sandbox
      inputClassificationNode.ts    # 判定 full_generation / continuation / bug_fix
      ruleAuditNode.ts              # 执行静态规则审计并收集违规证据
      rubricPreparationNode.ts      # 加载评分 rubrics 与 case 约束
      rubricScoring*Node.ts         # 构建并执行 rubric opencode 评分
      rule*Node.ts                  # 构建并执行规则辅助 opencode 判定、合并规则结论
      scoreFusionOrchestrationNode.ts # 融合 rubric 分与规则扣分
      reportGenerationNode.ts       # 生成 result.json/report.html 所需报告数据
      artifactPostProcessNode.ts    # 报告 HTML 后处理
      persistAndUploadNode.ts       # 落盘产物并按需回调上传
    rules/                          # 静态规则系统：规则定义、评估器、证据采集
    scoring/                        # rubric 加载、基础评分与分数融合逻辑
    report/                         # 报告 schema 校验与 HTML 渲染
    service/                        # 运行 ID 等服务层辅助逻辑
    tools/                          # 开发/运维脚本入口
  tests/                            # node:test 测试用例与 fixtures
  docs/superpowers/                 # 历史设计文档、规格与实施计划
  .local-cases/                     # 本地运行产物目录（运行时生成，默认输出位置）
```
