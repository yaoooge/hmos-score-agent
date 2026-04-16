# 交互式启动器与中文化报告增强设计

## 1. 背景

当前工程已经具备：

- 交互式启动评分脚本 `launch:score`
- 基于目录差异生成 patch 的能力
- 评分工作流、规则审计、schema 校验和本地落盘能力

但在实际使用中仍存在以下不足：

1. 交互式启动脚本只能跑默认 `init-input`，不能通过 `--case <path>` 指定输入目录。
2. 评分结果中的描述型文案仍有英文模板句，不符合“所有描述型文案使用中文”的要求。
3. 当前 case 落盘内容缺少初始 prompt 快照，不利于后续追踪。
4. 当前 `logs/` 目录未记录统一的关键流程日志，难以在本地调试和部署执行中排查问题。

本设计定义这轮增强的目标：在不重排现有 workflow 结构的前提下，补齐交互式启动、结果中文化、输入快照和关键日志落盘能力，并保证本地调试与部署执行复用同一套主流程逻辑。

## 2. 目标

本轮实现目标如下：

1. `npm run launch:score -- --case <path>` 支持运行指定用例目录。
2. `npm run launch:score` 在不传 `--case` 时默认读取 `init-input/`。
3. 启动时交互获取 `MODEL_PROVIDER_BASE_URL` 和 `MODEL_PROVIDER_API_KEY`，写入项目根目录 `.env`，并同步写入当前进程环境变量。
4. 评分启动后在 `.local-cases/` 下创建 `时间_task_type_唯一id` 格式的目录。
5. 在 case 目录下新增：
   - `inputs/prompt.txt`
   - `inputs/case-info.json`
   - `logs/run.log`
6. 所有描述型文案统一改成中文。
7. 本地调试和部署执行共用同一套 `runSingleCase()` 落盘、日志和工作流调用逻辑。

## 3. 非目标

本轮明确不做以下事项：

- 不改动评分 workflow 的节点顺序
- 不新增外部日志库
- 不改变 `result.json` 的 schema 字段名
- 不将 `task_type`、`rule_id`、`rule_source` 等约束性英文标识翻译成中文
- 不改动 API 层接口协议

## 4. 设计原则

### 4.1 交互层保持薄

交互式启动器只负责：

- 解析命令行参数
- 读取用户输入
- 更新 `.env`
- 调用统一 service 入口

避免把核心落盘逻辑埋进 readline 代码里。

### 4.2 Service 作为唯一编排入口

`runSingleCase()` 负责：

- 读取 case
- 推断 `task_type`
- 生成运行目录
- 初始化 case logger
- 写 inputs 快照
- 调 workflow
- 记录关键日志

这样 CLI、本地交互启动、未来 API 和部署执行都复用同一条主链。

### 4.3 中文文案只改“描述型内容”

统一中文化的范围：

- 报告 summary
- comment
- rationale
- evidence 中的模板性说明
- strengths
- main_issues
- final_recommendation
- human_review_items
- risks 的标题和描述
- rule_audit_results.conclusion
- rule_violations.rule_summary
- 终端提示和日志内容

不改动：

- schema 字段名
- `task_type`
- `rule_id`
- `rule_source`
- 文件路径
- 外部系统关键字

### 4.4 日志可读优先

`logs/run.log` 采用稳定单行文本格式，不引入额外日志框架。

## 5. 总体方案

### 5.1 启动入口

交互式启动脚本 `src/tools/runInteractiveScore.ts` 增强为：

- 支持解析 `--case <path>`
- 默认 case 路径回退到 `resolveDefaultCasePath()`
- 交互读取 `baseURL` / `apiKey`
- 将输入值写入 `.env`
- 同步写入 `process.env`
- 调用 `runSingleCase(casePath)`

### 5.2 Service 主链

`src/service.ts` 中的 `runSingleCase()` 扩展为统一编排入口，新增职责：

- 推断 `task_type`
- 生成运行目录名
- 初始化 logger
- 写 `inputs/prompt.txt`
- 写 `inputs/case-info.json`
- 在关键步骤写入 `logs/run.log`

### 5.3 输入快照

在 case 目录中新增：

#### `inputs/prompt.txt`

保存初始 prompt 原文，不做格式化或压缩。

#### `inputs/case-info.json`

保存标准化元信息，例如：

```json
{
  "case_id": "20260416T123456_bug_fix_ab12cd34",
  "source_case_path": "/abs/path/init-input",
  "task_type": "bug_fix",
  "original_project_path": "/abs/path/init-input/original",
  "generated_project_path": "/abs/path/init-input/workspace",
  "patch_path": "/abs/path/init-input/diff/changes.patch",
  "started_at": "2026-04-16T12:34:56.789Z"
}
```

## 6. 日志设计

新增 `src/io/caseLogger.ts`，负责将日志追加到 `logs/run.log`。

接口建议：

```ts
export class CaseLogger {
  constructor(private readonly artifactStore: ArtifactStore, private readonly caseDir: string) {}

  async info(message: string): Promise<void>
  async error(message: string): Promise<void>
}
```

日志格式：

```text
[2026-04-16T12:34:56.789Z] [INFO] 启动评分流程 casePath=/abs/path/init-input
[2026-04-16T12:34:56.900Z] [INFO] 用例加载完成 taskType=bug_fix
[2026-04-16T12:34:57.120Z] [INFO] 工作流执行完成
[2026-04-16T12:34:57.180Z] [INFO] 结果已落盘 caseDir=/.../.local-cases/20260416T123456_bug_fix_ab12cd34
[2026-04-16T12:34:57.181Z] [INFO] 上传跳过 原因=UPLOAD_ENDPOINT is empty; skipped upload.
```

本轮要求至少记录以下关键节点：

- 启动评分流程
- case 加载完成
- `task_type` 推断结果
- 运行目录创建完成
- inputs 快照写入完成
- workflow 开始执行
- workflow 执行完成
- result 输出完成
- 上传结果或上传跳过
- 执行失败（如果发生）

## 7. 中文化改造范围

### 7.1 `reportGenerationNode`

需要改成中文的模板内容：

- `basic_info.target_description`
- HTML 标题和总分说明

### 7.2 `scoringEngine`

需要改成中文的字段来源：

- `dimensionScores.comment`
- `SubmetricDetail.rationale`
- `SubmetricDetail.evidence` 中的模板句
- `overallConclusion.summary`
- `strengths`
- `mainIssues`
- `finalRecommendation`
- `humanReviewItems`
- `risks`

### 7.3 `ruleEngine` / `textRuleEvaluator`

需要改成中文的字段来源：

- 规则命中说明
- 未支持规则说明
- `ruleViolations.rule_summary`

### 7.4 启动器与日志

需要改成中文的输出：

- 终端启动提示
- 错误提示
- 启动完成信息
- 日志内容

## 8. 代码改造点

### 新增文件

- `src/io/caseLogger.ts`

### 修改文件

- `src/tools/runInteractiveScore.ts`
- `src/service.ts`
- `src/io/artifactStore.ts`
- `src/scoring/scoringEngine.ts`
- `src/rules/ruleEngine.ts`
- `src/rules/textRuleEvaluator.ts`
- `src/nodes/reportGenerationNode.ts`
- `README.md`
- `package.json`

## 9. TDD 顺序

### 第一步：交互启动器参数与 `.env` 持久化

先写测试：

- `launch:score` 支持 `--case <path>`
- `.env` 会更新 `MODEL_PROVIDER_BASE_URL` 和 `MODEL_PROVIDER_API_KEY`

### 第二步：运行目录命名与 inputs 快照

先写测试：

- `runSingleCase()` 产物目录命名符合 `时间_task_type_唯一id`
- `inputs/prompt.txt`
- `inputs/case-info.json`

### 第三步：日志落盘

先写测试：

- `logs/run.log` 被创建
- 包含关键阶段日志

### 第四步：中文文案

先写测试：

- `result.json` 中关键描述字段改为中文
- `report.html` 标题和内容改为中文

### 第五步：完整集成验证

最后验证：

- `npm run launch:score -- --case <path>`
- `npm test`
- `npm run build`

## 10. 验收标准

本轮完成后应满足：

1. `npm run launch:score -- --case <path>` 可运行指定用例目录。
2. 不传 `--case` 时默认使用 `init-input/`。
3. `.env` 被更新，当前进程环境变量同步生效。
4. case 目录命名为 `时间_task_type_唯一id`。
5. case 目录下存在：
   - `inputs/prompt.txt`
   - `inputs/case-info.json`
   - `logs/run.log`
6. `run.log` 至少包含启动、分类、workflow 完成、落盘、上传结果五类关键日志。
7. `result.json` 和 `report.html` 中新增的描述型模板文案全部为中文。
8. 本地调试和部署执行复用同一套 `runSingleCase()` 主链。
9. `npm test` 和 `npm run build` 通过。
