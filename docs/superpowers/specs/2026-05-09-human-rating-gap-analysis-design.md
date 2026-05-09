# 人工评级差异分析设计

Date: 2026-05-09

## Background

当前远程评分流程会为每个任务生成 `outputs/result.json`，其中包含自动评分结果、维度明细、风险项、人工复核候选项等内容。项目里已经存在 `POST /score/remote-tasks/:taskId/human-review`，用于提交逐项人工复核，并在存在 `score_effect` 时重算分数、写回 `outputs/result.json`。

本需求是另一类人工输入：人工按整单质量给出 L1-L6 评级和评级依据。服务端收到人工评级后，需要比较人工评级与自动评分差异，筛出差异较大的任务，启动一个 agent 分析差异原因，并输出汇总表。该流程必须保留自动评分原始产物，不改变原始 `outputs/result.json`。

## Goals

- 新增人工评级接口，支持提交人工评级 `L1` 到 `L6`、评级依据、审核人信息和可选备注。
- 新增处理节点，读取原始 `outputs/result.json`，计算自动分对应等级，与人工评级比较。
- 不改写、不覆盖、不追加修改 `outputs/result.json`。
- 仅将差异较大的任务进入下一步 agent 分析：
  - 人工评级为 `L1` 且自动分 `>=70`。
  - 人工评级为 `L2` 且自动分 `>=80`。
  - 人工评级 `L3` 及以上本期不处理。
- 启动一个专用 agent，使用新 skill 分析人工评级与自动评分差异原因。
- agent 结论需要判断主要责任方向：
  - `human_rating_needs_improvement`：人工评级可能需要改进。
  - `scoring_system_needs_improvement`：自动评分系统可能需要改进。
  - `both_need_review`：两侧都需要复核。
  - `insufficient_evidence`：证据不足，无法归因。
- 将差异分析结论写成一张表汇总，便于后续人工复盘。
- 保留机器可读 JSON 产物，便于前端或后续统计读取。

## Non-Goals

- 不替代现有逐项 `human-review` 接口。
- 不让人工评级影响自动总分、维度分、风险等级或 `result.json` 内容。
- 不重新运行完整评分 workflow。
- 不重新调用 rubric scoring agent 或 rule assessment agent。
- 不处理人工 `L3` 及以上评级差异。
- 不从人工依据中推导新的分数。
- 不在首版本做跨任务批量重算、BI 聚合或前端页面。

## Existing Constraints

现有代码边界：

- API 路由集中在 `src/api/app.ts` 和 `src/api/apiDefinitions.ts`。
- 远程任务状态与 caseDir 由 `RemoteTaskRegistry` 管理。
- 完整评分结果落在每个 caseDir 的 `outputs/result.json`。
- 已有 `humanReviewHandler` 会调用 `applyHumanReviewRecalculation` 并写回 `outputs/result.json`，因此本需求不能复用该写回路径。
- opencode agent 调用已有三套模式：agent-specific runner、prompt renderer、Zod schema 校验、节点调用。
- agent skill 已落在 `.opencode/skills/<skill-name>/SKILL.md`，运行时配置会复制 skills。

## Recommended Approach

采用“独立人工评级接口 + 独立差异分析节点 + 独立产物”的方案。

### Approach A: 扩展现有 human-review 接口

在 `POST /score/remote-tasks/:taskId/human-review` 中增加整单评级字段。

Pros:

- 接口数量少。
- 可复用现有 handler 的任务校验逻辑。

Cons:

- 现有接口语义是逐项复核和重算，会写回 `result.json`。
- 新需求明确要求不改变 `result.json`，两种语义放在一个接口里容易误用。
- 测试和文档需要解释同一接口的两种副作用模式，维护成本高。

### Approach B: 新增独立 manual-rating 接口

新增 `POST /score/remote-tasks/:taskId/manual-rating`，只接收整单人工评级并触发差异分析。产物写入独立目录，不影响原始评分结果。

Pros:

- 语义清晰，副作用边界明确。
- 避免触碰现有重算逻辑。
- 便于后续对人工评级流程单独扩展、重试和统计。
- 满足“不改变 result.json”的核心约束。

Cons:

- 增加一个 API 定义和 handler。
- 需要新增一套 agent runner、skill 和产物结构。

### Approach C: 离线批处理脚本

不新增服务接口，只提供本地脚本读取人工评级文件和 result.json，批量生成差异表。

Pros:

- 实现最小，不影响服务端 API。
- 适合一次性离线分析。

Cons:

- 不满足“调用接口写入人工评级”的需求。
- 无法和远程任务生命周期自然衔接。
- 后续平台集成成本高。

推荐 Approach B。它与现有逐项复核能力隔离，保留 `result.json` 原样，同时为后续平台通过接口提交人工评级提供稳定入口。

## API Design

新增路径：

```http
POST /score/remote-tasks/:taskId/manual-rating
Content-Type: application/json
```

请求体：

```json
{
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "manualRating": "L1",
  "basis": "无法编译运行，核心页面启动即崩溃。",
  "details": {
    "compileStatus": "failed",
    "runStatus": "not_started",
    "notes": "DevEco 编译报 ArkTS 类型错误。"
  }
}
```

字段规则：

- `manualRating` 必填，只允许 `L1`、`L2`、`L3`、`L4`、`L5`、`L6`。
- `basis` 必填，非空字符串，记录人工评级依据。
- `reviewer` 可选，结构与现有人工复核 reviewer 保持一致。
- `details` 可选，保存平台侧补充证据，不参与自动分计算。

响应体：

```json
{
  "success": true,
  "taskId": 88,
  "status": "completed",
  "summary": {
    "manualRating": "L1",
    "autoScore": 92,
    "autoRating": "L5",
    "gapQualified": true,
    "analysisStatus": "completed",
    "analysisArtifact": "human-rating/analysis.json",
    "summaryTable": "human-rating/rating-gap-summary.csv"
  },
  "message": "人工评级已接收，评分差异较大，已完成差异原因分析。"
}
```

非差异样例：

```json
{
  "success": true,
  "taskId": 88,
  "status": "completed",
  "summary": {
    "manualRating": "L1",
    "autoScore": 65,
    "autoRating": "L3",
    "gapQualified": false,
    "analysisStatus": "skipped"
  },
  "message": "人工评级已接收，未达到差异分析阈值。"
}
```

错误处理：

- `400`：请求体非法、评级非法、basis 为空。
- `404`：任务不存在或 `outputs/result.json` 不存在。
- `409`：任务尚未完成。
- `500`：读取结果、写入产物或 agent 运行失败。

## Rating Mapping and Gap Rules

自动分推定等级：

| 自动分 | 推定等级 |
| --- | --- |
| 100 | L6 |
| 90-99 | L5 |
| 80-89 | L4 |
| 60-79 | L3 |
| <60 | L2 |

本期只处理人工低评级且自动分明显偏高的情况：

| 人工评级 | 自动分阈值 | 是否进入 agent 分析 |
| --- | --- | --- |
| L1 | `>=70` | 是 |
| L2 | `>=80` | 是 |
| L3-L6 | 任意 | 否 |

`autoScore` 从 `resultJson.overall_conclusion.total_score` 读取。缺失或非有限数字时，请求返回 `409`，message 说明自动总分缺失，不能做差异判断。

## Processing Flow

新增处理模块建议命名：

- `src/humanRating/humanRatingTypes.ts`
- `src/humanRating/humanRatingGapRules.ts`
- `src/humanRating/humanRatingArtifactStore.ts`
- `src/api/manualRatingHandler.ts`
- `src/nodes/humanRatingGapAnalysisNode.ts`
- `src/agent/opencodeHumanRatingGapAnalysis.ts`

接口处理流程：

1. `manualRatingHandler` 读取 `taskId`，校验请求体。
2. 通过 `RemoteTaskRegistry` 获取任务记录。
3. 校验任务状态必须为 `completed`，且 `caseDir` 存在。
4. 读取 `caseDir/outputs/result.json`，只读使用，不写回。
5. 从 `overall_conclusion.total_score` 读取自动总分，映射为自动等级。
6. 将人工评级、人工依据、自动分、自动等级、阈值判断写入 `human-rating/manual-rating.json`。
7. 如果未命中差异阈值，写入 `human-rating/analysis-skipped.json` 并返回。
8. 如果命中差异阈值，调用 `humanRatingGapAnalysisNode`。
9. 节点构造 agent 输入，启动 `hmos-human-rating-gap-analysis` agent。
10. agent 使用 `hmos-human-rating-gap-analysis` skill，读取 sandbox 中的 `outputs/result.json`、人工评级 payload、相关 intermediate 证据，输出差异归因 JSON。
11. 本地 runner 用 Zod 校验 agent 输出。
12. 写入机器可读产物 `human-rating/analysis.json`。
13. 生成或覆盖汇总表 `human-rating/rating-gap-summary.csv`。首版本固定使用 CSV，不生成 xlsx。
14. 接口同步返回处理摘要。

首版本接口同步等待 agent 完成。异步队列和查询接口不在本期范围内。

## Artifact Design

所有新产物写在 caseDir 的 `human-rating/` 下，不放入 `outputs/`，避免被误认为原始评分输出。

```text
caseDir/
  outputs/
    result.json
  human-rating/
    manual-rating.json
    analysis.json
    analysis-skipped.json
    rating-gap-summary.csv
    agent-output/
      human-rating-gap-analysis.json
```

`manual-rating.json`：

```json
{
  "taskId": 88,
  "testCaseId": 188,
  "reviewedAt": "2026-05-09T02:30:00.000Z",
  "reviewer": {
    "id": "alice",
    "role": "qa"
  },
  "manualRating": "L1",
  "basis": "无法编译运行，核心页面启动即崩溃。",
  "details": {
    "compileStatus": "failed"
  },
  "autoScore": 92,
  "autoRating": "L5",
  "gapQualified": true,
  "gapRule": "manual=L1 autoScore>=70"
}
```

`analysis.json`：

```json
{
  "taskId": 88,
  "manualRating": "L1",
  "autoScore": 92,
  "autoRating": "L5",
  "primaryConclusion": "scoring_system_needs_improvement",
  "confidence": "medium",
  "reasonSummary": "自动评分未充分识别编译失败证据，仍按功能完成度高给出 L5。",
  "humanRatingReview": {
    "needsImprovement": false,
    "reason": "人工依据明确指向无法编译，符合 L1 标准。"
  },
  "scoringSystemReview": {
    "needsImprovement": true,
    "reason": "result.json 中缺少编译失败 hard gate 或未将构建失败映射为强制低分。"
  },
  "evidence": [
    "outputs/result.json: overall_conclusion.total_score=92",
    "human-rating/manual-rating.json: manualRating=L1 basis=无法编译运行"
  ],
  "recommendedActions": [
    "评分系统应将远程构建失败作为 L1 hard gate。",
    "在 result.json 中暴露构建失败证据，便于复核。"
  ]
}
```

`rating-gap-summary.csv` 字段：

| 字段 | 说明 |
| --- | --- |
| taskId | 远程任务 id |
| testCaseId | 测试用例 id |
| caseName | 用例名称，来自 registry 或 result.json basic_info |
| manualRating | 人工评级 |
| manualBasis | 人工依据 |
| autoScore | 自动总分 |
| autoRating | 自动分推定等级 |
| gapRule | 命中的差异规则 |
| primaryConclusion | agent 归因结论 |
| confidence | agent 结论置信度 |
| reasonSummary | 差异原因摘要 |
| humanNeedsImprovement | 人工评级是否建议改进 |
| scoringNeedsImprovement | 评分系统是否建议改进 |
| recommendedActions | 建议动作，多个建议用 `; ` 连接 |
| artifactPath | analysis.json 相对路径 |

## Agent and Skill Design

新增 opencode agent：

- agent name: `hmos-human-rating-gap-analysis`
- system prompt: `.opencode/prompts/hmos-human-rating-gap-analysis-system.md`
- skill: `.opencode/skills/hmos-human-rating-gap-analysis/SKILL.md`
- output file: `metadata/agent-output/human-rating-gap-analysis.json`

权限边界与现有评分 agent 一致：

- 只能读取 sandbox 内文件。
- 不能修改业务代码。
- 不能访问网络。
- 最终 JSON 只能写到指定 `metadata/agent-output/*.json`。
- assistant 最终回复只返回 `{"output_file":"metadata/agent-output/human-rating-gap-analysis.json"}`。

skill 职责：

- 明确 L1-L6 人工评级标准。
- 明确本期只分析人工 L1/L2 与自动高分的差异。
- 要求比较人工依据、自动总分、自动评分摘要、风险项、人工复核候选项、规则命中、构建/运行证据。
- 要求判断差异主要来源于人工评级口径问题、评分系统漏判/误判、双方都需复核，还是证据不足。
- 要求给出可执行改进建议。
- 禁止修改原评分结论或重新打分。

agent 输出 schema：

```ts
type HumanRatingGapAnalysis = {
  primaryConclusion:
    | "human_rating_needs_improvement"
    | "scoring_system_needs_improvement"
    | "both_need_review"
    | "insufficient_evidence";
  confidence: "high" | "medium" | "low";
  reasonSummary: string;
  humanRatingReview: {
    needsImprovement: boolean;
    reason: string;
  };
  scoringSystemReview: {
    needsImprovement: boolean;
    reason: string;
  };
  evidence: string[];
  recommendedActions: string[];
};
```

本地 runner 需要校验：

- schema 字段完整。
- `evidence` 至少 1 条。
- `recommendedActions` 至少 1 条；如果 `primaryConclusion=insufficient_evidence`，建议动作应指向补充证据。
- 不接受额外字段作为最终结果的一部分。

## Data Boundaries

agent 输入只包含必要上下文：

- `outputs/result.json`
- `human-rating/manual-rating.json`
- `intermediate/score-fusion.json`
- `intermediate/rule-audit-merged.json`
- `intermediate/rubric-agent-result.json`
- `intermediate/rule-agent-result.json`
- `logs/` 中与构建、运行、workflow 节点失败相关的摘要文件，如果存在。

如果某些 intermediate 文件不存在，runner 仍可启动 agent，但需要在 prompt 中说明缺失文件不代表不存在问题，只能作为证据不足处理。

## API Definition Updates

`src/api/apiDefinitions.ts` 新增：

```ts
manualRating: "/score/remote-tasks/:taskId/manual-rating"
```

并在 `API_DEFINITIONS` 中补充请求、响应、错误状态说明。CORS 已允许 `POST`，无需额外改动。

## Idempotency and Overwrite Policy

首版本允许同一任务重复提交人工评级，但必须保留历史：

- 当前最新评级写入 `human-rating/manual-rating.json`。
- 每次提交同时追加一行 `human-rating/manual-rating-history.jsonl`。
- 每次差异分析覆盖 `human-rating/analysis.json`，并追加一行 `human-rating/analysis-history.jsonl`。
- `rating-gap-summary.csv` 表示当前 case 最新结论，重复提交时覆盖生成，不追加重复行。

这样方便平台修正错误人工评级，同时仍能追踪历史。

## Observability

新增节点事件名称：

- `humanRatingGapAnalysisNode`

日志记录：

- 接口收到人工评级：`manual_rating_received`
- 未命中阈值跳过：`manual_rating_gap_analysis_skipped`
- 命中阈值启动 agent：`manual_rating_gap_analysis_started`
- agent 成功：`manual_rating_gap_analysis_completed`
- agent 失败：`manual_rating_gap_analysis_failed`

日志中包含 `taskId`、`testCaseId`、`manualRating`、`autoScore`、`autoRating`、`gapQualified`。

## Testing Plan

新增或扩展测试：

- `manualRatingHandler` 接收合法 L1 请求，自动分 `>=70` 时触发分析。
- `manualRatingHandler` 接收合法 L2 请求，自动分 `>=80` 时触发分析。
- 人工 L1 自动分 `<70` 时写入 manual-rating 产物但跳过 agent。
- 人工 L2 自动分 `<80` 时写入 manual-rating 产物但跳过 agent。
- 人工 L3-L6 总是跳过 agent。
- 非法评级、空 basis、任务未完成、缺少 `result.json`、缺少 `overall_conclusion.total_score` 返回正确错误。
- 确认提交人工评级后 `outputs/result.json` 字节内容不变。
- agent runner 校验合法 JSON 输出。
- agent runner 拒绝缺字段、非法枚举、空 evidence、空 recommendedActions。
- 汇总 CSV 包含期望字段和当前最新分析结论。
- API definitions 包含新路径、请求 schema 和响应 schema。

## Acceptance Criteria

- 平台可通过新接口写入人工 L1-L6 评级和依据。
- 对人工 L1 且自动分 `>=70`、人工 L2 且自动分 `>=80` 的任务，系统启动专用 agent 做差异原因分析。
- 对人工 L3-L6 或未达到阈值的任务，系统保存人工评级但不启动 agent。
- 任意路径都不修改 `outputs/result.json`。
- 每个命中阈值的任务生成：
  - `human-rating/manual-rating.json`
  - `human-rating/analysis.json`
  - `human-rating/rating-gap-summary.csv`
- agent 结论能明确指向人工评级改进、评分系统改进、双方复核或证据不足。
- 自动化测试覆盖阈值判断、result.json 不变、agent 输出校验和 API 协议。
