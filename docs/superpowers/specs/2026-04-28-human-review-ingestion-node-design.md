# 人工复核结果入库与后训练数据集构建设计

## 背景

当前远端评分任务完成后会生成 `outputs/result.json`，其中包含自动评分结论、规则判定结果、风险项以及 `human_review_items`。这些人工复核项用于提示管理台或人工审核人员进一步确认自动评分的不确定点。

后续希望远程评分管理台在完成人工复核后，把复核结果回传给评分服务。评分服务需要将复核结果沉淀为一个结果库，并进一步整理为代码生成 LLM 后训练可用的正向/负向测评集，尤其服务于提升鸿蒙 ArkTS / ArkUI 代码生成能力。

需要注意的是，`human_review_items` 并不总是直接描述生成代码质量。例如“硬门槛复核”“Patch 上下文缺失”“Rubric Agent 降级”等复核点更偏向评分流程、证据完整性或自动评估可靠性，不一定适合作为代码生成后训练样本。此类复核结果仍应保存原始记录，但默认不进入正向/负向训练数据集。

## 目标

- 新增一个由远程评分管理台调用的人工复核结果提交接口。
- 接口接收到合法人工复核 payload 并完成原始记录落盘后立即返回成功，避免等待 LLM 分类、文件索引更新或数据集生成。
- 人工复核处理不接入现有评分工作流主链路，不重新执行评分，只复用远端任务索引、`outputs/result.json` 和任务上下文。
- 在接口后台启动独立的 `HumanReviewIngestionNode`，负责复核项归一化、过滤、分类、总结和数据集写入。
- 节点内部允许再启动一个专用分类 Agent，用于把可学习复核样本总结为后训练友好的结构化数据。
- 原始复核结果必须完整入库，保证人工审核记录可追溯。
- 进入训练数据集前必须过滤与生成代码无直接关系、证据不足或仍不确定的复核点。
- 第一阶段每次请求仅提交一个远端任务的人工复核结果，不支持跨任务批量导入。

## 非目标

- 不修改 `POST /score/run-remote-task` 的请求协议。
- 不修改现有评分 LangGraph / workflow 节点顺序。
- 不改变 `outputs/result.json` 的现有必填 schema。
- 不在提交接口中同步等待 LLM 处理完成。
- 不强制要求接入数据库或对象存储，第一阶段继续使用本地文件库。
- 不把所有人工复核项无差别写入训练数据集。
- 不把完整工程源码直接塞入训练样本；训练样本只保存必要上下文、patch、证据片段和总结。
- 不支持一次请求提交多个任务的人工复核结果。
- 不把生产环境的复核结果库默认写入工程代码目录；工程目录只允许作为本地开发兜底路径。

## 当前相关代码

- `src/api/app.ts`：Express API 挂载位置，当前已有远端任务提交、规则统计和完整结果读取接口。
- `src/api/apiDefinitions.ts`：集中声明 API 路径、请求和响应文档。
- `src/api/remoteTaskRegistry.ts`：维护远端任务本地索引，人工复核接口可复用 `taskId`、`token`、`status`、`caseDir`、`testCaseId`。
- `src/nodes/reportGenerationNode.ts`：生成 `result.json`，其中 `human_review_items` 是人工复核入口数据来源。
- `src/types.ts`：定义 `HumanReviewItem` 等结果结构。
- `src/config.ts`：集中管理本地 case 根目录和 reference 根目录，可扩展人工复核结果库路径。

## 总体设计

新增人工复核提交接口：

```http
POST /score/remote-tasks/:taskId/human-review
```

链路如下：

```text
remote scoring console submits review
  -> API validates taskId/token/status/body
  -> API reads outputs/result.json for association
  -> API writes immutable raw review record
  -> API creates ingestion status = queued
  -> API returns success immediately
  -> background HumanReviewIngestionNode runs asynchronously
      -> normalize submitted review items
      -> match result.json human_review_items
      -> filter non-code-generation review points
      -> collect minimal evidence context
      -> run classifier agent for eligible items
      -> write classified evidence cards
      -> append training JSONL datasets
      -> update index and status
```

提交接口只承诺“复核结果已接收并落 raw 库”。分类结果属于异步后处理，可通过后续状态接口查看。

## 接口设计

### 提交人工复核结果

```http
POST /score/remote-tasks/:taskId/human-review
token: <remoteTask.token>
Content-Type: application/json
```

请求体：

```json
{
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "overallDecision": "adjust_required",
  "overallComment": "自动评分低估了状态管理实现，但接口接入违规成立。",
  "itemReviews": [
    {
      "reviewItemKey": "硬门槛复核",
      "sourceItem": "硬门槛复核",
      "humanVerdict": "confirmed_issue",
      "correctedAssessment": "确实触发硬门槛，但该项用于校准评分 cap，不直接进入代码生成训练集。",
      "evidence": {
        "files": ["entry/src/main/ets/pages/Index.ets"],
        "snippets": ["使用本地 mockData 替代接口请求"],
        "comment": "与 prompt 中要求的真实接口接入不一致。"
      },
      "scoreAdjustment": {
        "finalScore": 60,
        "reason": "硬门槛 cap 应保留。"
      },
      "preferredFix": {
        "summary": "应调用项目已有 ApiClient 获取数据，并处理 loading/error 状态。"
      },
      "tags": ["api_integration", "hard_gate"]
    }
  ]
}
```

字段说明：

- `reviewer`：可选，记录人工复核人员或系统身份。
- `overallDecision`：必填，取值为 `accepted`、`rejected`、`adjust_required`、`uncertain`。
- `overallComment`：可选，整单复核说明。
- `itemReviews`：必填，至少一项；第一阶段不支持批量任务，但允许一个任务内提交多个复核项。
- `reviewItemKey`：可选，管理台传入的复核项稳定标识。
- `sourceItem`：可选，原 `human_review_items[].item` 名称，用于和 `result.json` 对齐。
- `humanVerdict`：必填，取值为 `confirmed_correct`、`confirmed_issue`、`auto_false_positive`、`auto_false_negative`、`partially_correct`、`uncertain`。
- `correctedAssessment`：必填，人工修正后的判断或说明。
- `evidence`：可选但推荐。缺少可定位代码证据时，该项默认不进入训练数据集。
- `preferredFix`：可选。若提供，可用于生成偏好对比或负向诊断数据。

成功响应在 raw 入库后立即返回：

```json
{
  "success": true,
  "taskId": 88,
  "reviewId": "hr_20260428_88_abcd",
  "status": "accepted",
  "rawPath": "/data/hmos-score-agent/human-review-evidences/raw/2026-04-28/task-88-review-hr_20260428_88_abcd.json",
  "classificationStatus": "queued",
  "message": "人工复核结果已接收，分类入库将在后台异步完成。"
}
```

错误响应：

- `400`：请求体非法、`itemReviews` 为空、枚举值非法。
- `401`：`token` 与远端任务记录不匹配。
- `404`：任务不存在或缺少结果文件。
- `409`：任务尚未完成，不能提交人工复核。
- `500`：raw 记录写入失败。

### 查询人工复核处理状态

建议新增轻量查询接口：

```http
GET /score/human-reviews/:reviewId
```

成功响应：

```json
{
  "success": true,
  "reviewId": "hr_20260428_88_abcd",
  "taskId": 88,
  "status": "completed",
  "classificationSummary": {
    "rawItemCount": 3,
    "eligibleItemCount": 1,
    "filteredItemCount": 2,
    "datasetItemCount": 1,
    "positive": 0,
    "negative": 1,
    "neutral": 0
  },
  "filteredReasons": [
    {
      "reviewItemKey": "硬门槛复核",
      "reason": "process_or_scoring_review_point"
    }
  ]
}
```

第一阶段如果不需要管理台展示后台处理状态，可只实现提交接口和本地 status 文件；但内部状态文件仍应保留，便于排障和重跑。

## 入库目录设计

新增配置：

```text
HUMAN_REVIEW_EVIDENCE_ROOT=/data/hmos-score-agent/human-review-evidences
```

生产环境必须将 `HUMAN_REVIEW_EVIDENCE_ROOT` 指向独立持久化目录或挂载卷，不应放在工程目录、发布包目录或容器镜像层内。工程目录会随服务版本发布、代码拉取、镜像重建或清理脚本变化，存在复核结果和后训练数据集被覆盖、删除或分散到不同版本目录的风险。

推荐部署目录划分：

```text
/opt/hmos-score-agent/          # 服务代码或发布包，只随版本更新
/data/hmos-score-agent/
  local-cases/                  # LOCAL_CASE_ROOT，远端任务执行产物
  human-review-evidences/       # HUMAN_REVIEW_EVIDENCE_ROOT，人工复核结果库
/var/log/hmos-score-agent/      # 服务日志
```

容器或 K8s 部署时，`/data/hmos-score-agent/human-review-evidences` 必须挂载 volume / PVC。服务升级只替换镜像或 `/opt/hmos-score-agent`，不得清理 `/data/hmos-score-agent`。

结果库目录结构：

```text
/data/hmos-score-agent/human-review-evidences/
  raw/
    2026-04-28/
      task-88-review-hr_20260428_88_abcd.json
  classified/
    positive/
      api_integration/
        hr_20260428_88_abcd-item-1.json
    negative/
      requirement_following/
        hr_20260428_88_abcd-item-2.json
    neutral/
      uncertain/
        hr_20260428_88_abcd-item-3.json
  datasets/
    sft_positive.jsonl
    preference_pairs.jsonl
    negative_diagnostics.jsonl
  status/
    hr_20260428_88_abcd.json
  index.json
```

写入规则：

- `raw` 保存完整原始请求、关联任务信息、`result.json` 摘要、接收时间和 schema version。
- `status` 记录异步处理状态、错误、重试次数、分类摘要和过滤原因。
- `classified` 保存单条复核项归档后的 evidence card。
- `datasets/*.jsonl` 只追加通过训练过滤的样本。
- `index.json` 只保存检索元数据，不保存完整源码或大段 patch。
- raw 写入必须原子化；`index.json` 和 JSONL 写入需要串行化，避免并发提交互相覆盖。
- 服务启动时如果检测到 `HUMAN_REVIEW_EVIDENCE_ROOT` 位于当前工程目录下，应输出 warning；生产环境建议直接拒绝启动或由部署检查阻断。

## 部署后数据获取

第一阶段推荐通过持久化目录直接获取复核结果和 JSONL 数据集：

```text
/data/hmos-score-agent/human-review-evidences/raw/
/data/hmos-score-agent/human-review-evidences/classified/
/data/hmos-score-agent/human-review-evidences/datasets/sft_positive.jsonl
/data/hmos-score-agent/human-review-evidences/datasets/preference_pairs.jsonl
/data/hmos-score-agent/human-review-evidences/datasets/negative_diagnostics.jsonl
/data/hmos-score-agent/human-review-evidences/index.json
```

后训练平台与评分服务不在同一台机器时，可由运维任务定时同步 `datasets/*.jsonl`：

```bash
rsync -av user@server:/data/hmos-score-agent/human-review-evidences/datasets/ ./datasets/
```

管理台不应直接读取服务器文件系统。管理台只需要通过 `GET /score/human-reviews/:reviewId` 查询某次复核的处理状态；如果后训练平台需要通过 HTTP 拉取数据集，可在后续增加只读下载接口。

建议后续下载接口：

```http
GET /score/human-review-datasets
GET /score/human-review-datasets/:datasetName
GET /score/human-review-evidences/:reviewId
```

下载接口必须使用管理员级鉴权，不复用单个远端任务的 `token`。`datasetName` 只允许白名单值：`sft_positive`、`preference_pairs`、`negative_diagnostics`，避免任意文件读取。

## HumanReviewIngestionNode 设计

该节点不是评分 workflow 节点，而是 API 接收复核后启动的后台处理单元。

输入：

```ts
type HumanReviewIngestionInput = {
  taskId: number;
  reviewId: string;
  submittedAt: string;
  reviewer?: {
    id?: string;
    role?: string;
  };
  resultJson: Record<string, unknown>;
  caseContext: {
    caseDir?: string;
    testCaseId?: number;
    caseId?: string;
    prompt?: string;
    taskType?: string;
  };
  reviewPayload: HumanReviewSubmissionPayload;
};
```

输出：

```ts
type HumanReviewIngestionOutput = {
  reviewId: string;
  status: "completed" | "failed";
  summary: {
    rawItemCount: number;
    eligibleItemCount: number;
    filteredItemCount: number;
    datasetItemCount: number;
    positive: number;
    negative: number;
    neutral: number;
  };
  filteredItems: Array<{
    reviewItemKey: string;
    reason: HumanReviewFilterReason;
  }>;
  evidenceIds: string[];
  error?: string;
};
```

节点步骤：

1. **归一化复核项**：为每个 `itemReview` 生成稳定 `reviewItemKey`。优先使用请求字段，其次使用 `sourceItem`，最后使用 `sha256(item + correctedAssessment + index)`。
2. **匹配自动复核项**：和 `resultJson.human_review_items` 对齐。无法匹配的人工额外复核项保留为 `manual_extra_review`，这类可能代表自动评测漏检。
3. **基础事实抽取**：提取 `basic_info`、`overall_conclusion`、相关 `dimension_results`、`rule_audit_results`、`case_rule_results`、`risks` 和人工提供的 evidence。
4. **训练资格过滤**：先用确定性规则过滤不适合进入训练集的复核项。
5. **分类 Agent 总结**：只把通过资格过滤的候选项交给专用 Agent，生成训练友好的结构化 evidence card。
6. **二次安全过滤**：校验 Agent 输出是否有证据、是否泄露无关本地路径、是否声称了输入中不存在的代码事实。
7. **分类入库**：写入 `classified`、追加 JSONL 数据集、更新 `index.json` 和 `status`。

## 训练资格过滤规则

过滤发生在调用分类 Agent 之前，避免把流程性复核项误当成代码生成训练样本。

过滤原因枚举：

```ts
type HumanReviewFilterReason =
  | "process_or_scoring_review_point"
  | "missing_code_evidence"
  | "uncertain_human_verdict"
  | "score_only_adjustment"
  | "non_generation_related"
  | "duplicate_item"
  | "unsupported_payload";
```

默认过滤条件：

- `sourceItem` 或自动复核项 `item` 命中流程性关键词：`硬门槛复核`、`Patch 上下文缺失`、`Rubric Agent 降级`、`置信度复核`、`评分 cap`、`score cap`。
- `humanVerdict === "uncertain"`。
- 只有分数调整，没有代码文件、代码片段、需求遵循、API 接入、ArkTS / ArkUI 等生成质量证据。
- 复核内容只描述评分系统可靠性、证据缺失、模型置信度或人工流程。
- 同一 `reviewId` 内重复提交同一 `reviewItemKey`，只保留第一条，后续记为 duplicate。

允许进入候选集的条件：

- 复核项明确指向生成代码行为、工程结构、需求遵循、鸿蒙平台 API 使用、ArkTS / ArkUI 语义、构建运行错误或性能稳定性问题。
- 至少具备一种可定位证据：文件路径、代码片段、patch 片段、规则 ID、rubric 评分项或人工说明中的具体实现事实。
- 人工判断不是 `uncertain`。

特殊规则：

- “硬门槛复核”默认过滤；如果同一人工复核项同时提供了明确代码缺陷证据，例如“使用 mock 替代真实接口”，节点可以拆分为两个结果：流程性 hard gate 记录被过滤，代码缺陷部分作为 `requirement_following` 或 `api_integration` 候选进入 Agent。
- `auto_false_positive` 可作为正向样本候选，但必须有人工说明为什么代码实现正确。
- `auto_false_negative` 可作为负向诊断候选，并标记为自动评测漏检。

## 分类 Agent 设计

节点内部可以启动一个专用分类 Agent，职责不是重新评判人工结论，而是把已确认事实转换成后训练数据资产。

Agent 输入：

```ts
type HumanReviewClassifierInput = {
  reviewId: string;
  taskId: number;
  taskSummary: string;
  promptText?: string;
  taskType?: string;
  autoReviewItem?: Record<string, unknown>;
  humanReview: Record<string, unknown>;
  relatedRules: Array<Record<string, unknown>>;
  relatedDimensions: Array<Record<string, unknown>>;
  relatedRisks: Array<Record<string, unknown>>;
  evidence: {
    files: string[];
    snippets: string[];
    patchSummary?: string;
    humanComment?: string;
  };
};
```

Agent 输出必须符合结构化 schema：

```ts
type ClassifiedHumanReviewEvidence = {
  evidenceId: string;
  polarity: "positive" | "negative" | "neutral";
  datasetTypes: Array<"sft_positive" | "preference_pair" | "negative_diagnostic">;
  category:
    | "arkts_language"
    | "arkui_state_management"
    | "component_layout"
    | "lifecycle_routing"
    | "api_integration"
    | "project_structure"
    | "platform_capability"
    | "performance_stability"
    | "requirement_following"
    | "build_runtime"
    | "other";
  severity: "critical" | "major" | "minor" | "info";
  confidence: "high" | "medium" | "low";
  taskSummary: string;
  humanJudgement: string;
  keyEvidence: string[];
  codeGenerationLesson: string;
  recommendedTrainingUse: string;
  shouldIncludeInTraining: boolean;
  exclusionReason?: string;
};
```

Agent 约束：

- 不得覆盖或反驳人工复核结论。
- 不得编造输入中不存在的代码事实、文件路径或 API 名称。
- 当证据不足时必须设置 `shouldIncludeInTraining=false`。
- 输出的 `codeGenerationLesson` 必须面向代码生成模型，描述“以后应该如何生成/避免什么”，而不是描述评分流程。
- `category` 必须优先落到鸿蒙代码相关类别，只有无法归类时才使用 `other`。

## 数据集生成规则

### polarity 映射

确定性预映射：

- `confirmed_correct`、`auto_false_positive` -> `positive`
- `confirmed_issue`、`auto_false_negative`、`partially_correct` -> `negative`
- `uncertain` -> `neutral`，且默认不进入训练数据集

Agent 可以降低为 `neutral` 或 `shouldIncludeInTraining=false`，但不能把人工确认的问题反向改成正例。

### SFT 正向样本

写入 `datasets/sft_positive.jsonl` 的条件：

- `polarity === "positive"`。
- 人工明确确认生成代码符合需求或自动扣分为误报。
- 有足够 prompt、上下文和目标代码/patch 信息。
- 不属于流程性复核项。

样本字段：

```json
{
  "type": "sft_positive",
  "reviewId": "hr_20260428_88_abcd",
  "evidenceId": "hr_20260428_88_abcd-item-1",
  "input": {
    "prompt": "...",
    "projectContext": "...",
    "constraints": []
  },
  "targetOutput": {
    "patchSummary": "...",
    "keyFiles": []
  },
  "humanSummary": "...",
  "category": "arkui_state_management"
}
```

### 偏好对比样本

写入 `datasets/preference_pairs.jsonl` 的条件：

- 人工提供 `preferredFix.summary` 或可从复核中明确抽取“应如何改”。
- 存在 rejected 实现证据，例如原始生成 patch 或关键问题片段。
- chosen 可以是修复后 patch，也可以是自然语言修正方案；如果没有真实修复代码，应标记 `chosenType="fix_summary"`，避免伪装成代码级偏好样本。

### 负向诊断样本

写入 `datasets/negative_diagnostics.jsonl` 的条件：

- `polarity === "negative"`。
- 人工确认存在代码生成缺陷、需求漏实现、ArkTS / ArkUI 错误、构建运行问题或平台 API 使用问题。
- 有可定位证据和明确 lesson。

流程性复核项、纯评分调整项和证据不足项不得写入负向诊断数据集。

## raw 记录结构

```json
{
  "schemaVersion": 1,
  "reviewId": "hr_20260428_88_abcd",
  "taskId": 88,
  "testCaseId": 188,
  "receivedAt": "2026-04-28T10:20:30.000Z",
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "resultSummary": {
    "caseId": "188",
    "taskType": "bug_fix",
    "totalScore": 60,
    "humanReviewItemCount": 3,
    "riskCount": 2
  },
  "payload": {}
}
```

raw 中可以保存完整人工复核 payload，但 `resultJson` 建议只保存摘要和关联路径，避免 raw 记录过大。完整 `result.json` 仍从 `<caseDir>/outputs/result.json` 读取。

## 幂等与并发

- 如果管理台提供 `Idempotency-Key` 请求头，则使用该值参与生成 `reviewId` 并避免重复入库。
- 如果没有 `Idempotency-Key`，使用 `taskId + receivedAt + payloadHash` 生成 `reviewId`。
- 同一 `taskId` 可以有多次人工复核提交，每次生成独立 `reviewId`。
- `raw` 文件名包含 `taskId` 和 `reviewId`，避免覆盖。
- `index.json` 和 JSONL 追加必须通过 store 内部串行队列执行。
- 后台节点失败不影响已返回的提交接口结果，失败信息写入 `status/<reviewId>.json`。

## 错误处理与降级

- raw 写入失败：接口返回 `500`，不启动后台节点。
- `result.json` 读取失败：接口返回 `404` 或 `500`，不接收复核结果。
- 后台分类 Agent 失败：写入 `classification_failed` 状态，并对候选项做保守 fallback；fallback 只写 `classified/neutral`，不追加训练 JSONL。
- Agent 输出 schema 校验失败：记录错误，最多重试一次；仍失败则降级为 `classification_failed`。
- 训练样本写入失败：保留 classified evidence card，状态标记为 `dataset_append_failed`，便于后续重跑。

## API 定义与配置改动

建议新增路径：

```ts
export const API_PATHS = {
  humanReview: "/score/remote-tasks/:taskId/human-review",
  humanReviewStatus: "/score/human-reviews/:reviewId",
  humanReviewDatasets: "/score/human-review-datasets",
  humanReviewDataset: "/score/human-review-datasets/:datasetName",
  humanReviewEvidence: "/score/human-review-evidences/:reviewId"
} as const;
```

其中 `humanReviewDatasets`、`humanReviewDataset` 和 `humanReviewEvidence` 属于后训练平台拉取数据时的可选只读接口；第一阶段可以先只实现提交接口和状态接口。

建议新增配置：

```ts
export interface AppConfig {
  humanReviewEvidenceRoot: string;
}
```

生产推荐值：

```ts
path.resolve("/data/hmos-score-agent/human-review-evidences")
```

本地开发兜底值：

```ts
path.resolve(process.cwd(), "references/human-review-evidences")
```

服务启动时应区分生产和本地开发：生产环境缺少 `HUMAN_REVIEW_EVIDENCE_ROOT` 应视为配置错误；本地开发可以使用工程内兜底目录，并确保该目录加入 `.gitignore`。

同时需要修改 `scripts/aliyun-single-instance-deploy.sh` 等部署脚本，在生成 `.env` 时写入生产推荐路径：

```text
LOCAL_CASE_ROOT=/data/hmos-score-agent/local-cases
HUMAN_REVIEW_EVIDENCE_ROOT=/data/hmos-score-agent/human-review-evidences
```

部署脚本还应在启动服务前创建上述目录、设置服务运行用户的读写权限，并避免在发布新版本或清理代码目录时删除 `/data/hmos-score-agent`。

## 建议文件拆分

- `src/api/humanReviewHandler.ts`：HTTP 参数校验、鉴权、任务状态校验、读取 `result.json`、同步写 raw、启动后台节点。
- `src/humanReview/humanReviewTypes.ts`：请求、raw、status、classified evidence 和训练样本类型。
- `src/humanReview/humanReviewEvidenceStore.ts`：raw/classified/status/index/jsonl 文件写入和串行化控制。
- `src/humanReview/humanReviewIngestionNode.ts`：异步节点 orchestration。
- `src/humanReview/humanReviewFiltering.ts`：训练资格过滤规则和原因枚举。
- `src/agent/humanReviewEvidenceClassifier.ts`：分类 Agent prompt、schema 校验和 fallback。
- `scripts/aliyun-single-instance-deploy.sh`：写入 `HUMAN_REVIEW_EVIDENCE_ROOT`、生产化 `LOCAL_CASE_ROOT`，并创建 `/data/hmos-score-agent` 持久化目录。
- `tests/human-review-ingestion.test.ts`：接口与节点测试。

## 测试策略

接口测试：

- 合法请求在 raw 写入后立即返回 `success=true` 和 `classificationStatus=queued`。
- 任务不存在返回 `404`。
- token 不匹配返回 `401`。
- 任务未完成返回 `409`。
- `itemReviews` 为空或枚举非法返回 `400`。

节点测试：

- “硬门槛复核”默认被过滤，不写入 JSONL 数据集。
- “硬门槛复核 + 明确代码缺陷证据”可拆分出代码缺陷候选，流程性部分仍被过滤。
- `confirmed_correct` 和 `auto_false_positive` 可生成正向候选。
- `confirmed_issue` 和 `auto_false_negative` 可生成负向诊断候选。
- 缺少代码证据的复核项进入 raw 和 classified neutral，但不进入训练 JSONL。
- 分类 Agent 抛错时状态记录失败，且不追加训练数据集。
- 并发提交多个 review 时，`index.json` 和 JSONL 不丢写、不覆盖。

数据集测试：

- `sft_positive.jsonl` 只包含正向、代码相关、有证据的样本。
- `negative_diagnostics.jsonl` 不包含纯评分流程复核项。
- `preference_pairs.jsonl` 在没有真实修复代码时必须标记 `chosenType="fix_summary"`。

部署测试：

- `HUMAN_REVIEW_EVIDENCE_ROOT` 指向 `/data` 等工程外路径时，raw、classified、datasets 和 status 均写入该目录。
- 生产环境未配置 `HUMAN_REVIEW_EVIDENCE_ROOT` 时，服务启动失败或部署检查失败。
- `HUMAN_REVIEW_EVIDENCE_ROOT` 指向工程目录时，服务输出明确 warning。
- 部署脚本生成的 `.env` 包含 `LOCAL_CASE_ROOT=/data/hmos-score-agent/local-cases` 和 `HUMAN_REVIEW_EVIDENCE_ROOT=/data/hmos-score-agent/human-review-evidences`。
- 部署脚本会创建 `/data/hmos-score-agent/local-cases` 和 `/data/hmos-score-agent/human-review-evidences`，并授予服务用户读写权限。
- 服务版本升级或重启后，已有 `datasets/*.jsonl` 和 `raw` 记录不丢失。
- 可选下载接口只允许白名单 dataset 名称，不能通过路径穿越读取其他文件。

## 后续扩展

- 在 `result.json` 的 `human_review_items` 中增加稳定 `review_item_id`，减少管理台和服务端的文本匹配成本。
- 增加 `POST /score/human-reviews/:reviewId/reclassify`，支持修复 Agent prompt 或过滤规则后重跑分类。
- 增加 `GET /score/human-review-datasets/:datasetName` 等管理员只读下载接口，支持后训练平台自动拉取 JSONL。
- 将本地文件结果库迁移到数据库或对象存储，但保持 raw/classified/datasets 的逻辑模型不变。
- 将高质量 positive/negative 样本导出到后训练平台前，增加人工二次抽检或采样审核流程。
