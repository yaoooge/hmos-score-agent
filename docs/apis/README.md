# 对外接口

本页汇总当前服务对外提供的 HTTP 接口和远端回调契约。路由定义在 `src/api/apiDefinitions.ts`，实现位于 `src/api/app.ts`。

## 服务接口

| 方法 | 路径 | 作用 | 请求要点 | 响应要点 |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | 健康检查。 | 无。 | `200`，返回 `{ ok: true }`。 |
| `POST` | `/score/run-remote-task` | 接收远端任务并异步执行评分。 | `taskId`、`testCase`、`executionResult`、`callback`，`token` 已废弃但仍兼容。 | `200` 返回任务接收成功信息；失败返回 `500`。 |
| `GET` | `/score/remote-tasks/:taskId/result` | 读取已完成远端任务的完整评分结果。 | 路径参数 `taskId`。 | `200` 返回 `success`、`taskId`、`status`、`resultData`；未完成返回 `409`，未找到返回 `404`。 |
| `GET` | `/score/rule-violation-stats` | 读取静态规则违反聚合统计。 | 可选查询 `caseId`、`testCaseId`、`packId`、`from`、`to`。 | `200` 返回 `success`、`filters`、`summary`、`rules`；参数非法返回 `400`。 |
| `POST` | `/score/remote-tasks/:taskId/human-review` | 提交人工复核和整单人工评级，并按复核结果重算分数。 | 路径参数 `taskId`，body 包含必填 `manualLevel`，以及可选 `reviewer`、`overallComment`、`itemReviews`、`riskReviews`。 | `200` 返回 `success`、`taskId`、`status`、`summary`、`message`。 |

## 远端任务接收

`POST /score/run-remote-task` 的请求体结构如下：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `taskId` | number | 是 | 远端任务 ID。 |
| `testCase` | object | 是 | 远端测试用例元数据，包含 `id`、`name`、`type`、`description`、`input`、`expectedOutput`、`fileUrl`。 |
| `executionResult` | object | 是 | 提交的执行结果，包含 `isBuildSuccess`、`outputCodeUrl`、可选 `diffFileUrl`。 |
| `callback` | string | 是 | 远端平台 callback 地址。 |
| `token` | string | 否 | 兼容字段，当前服务不再依赖。 |

执行成功后，服务会先完成任务预处理、case 物化、任务理解和任务类型判定，再把异步评分任务排入本地队列。

## 结果查询

`GET /score/remote-tasks/:taskId/result` 返回已完成任务的 `outputs/result.json` 内容，保留完整评分结果主体；服务会剥离少量内部辅助字段后对外返回。

## 人工复核

`POST /score/remote-tasks/:taskId/human-review` 接收逐条复核结论和整单人工评级。请求体核心字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `reviewer` | string | 可选的复核人标识。 |
| `manualLevel` | enum | 必填，`L1` 到 `L6`。 |
| `overallComment` | string | 可选的整体评价；人工评级差异分析会将它作为评级依据。 |
| `itemReviews` | array | 逐条评分项复核。 |
| `riskReviews` | array | 风险项复核。 |
| `agree` | boolean | 是否同意系统当前判断或风险等级。 |
| `correctedLevel` | enum | 不同意风险等级时填写的新等级：`high`、`medium`、`low`、`none`。 |
| `reason` | string | 不同意时必填的原因。 |

提交后，后端会把复核结果写入 `human-review/`，并对带有 `score_effect` 的风险项进行重算。再次提交会覆盖 `result.json` 中的最新 `human_review_revision`。同时，服务会记录 `manualLevel` 到 `human-rating/manual-rating.json`；当人工评级为 `L1` 且自动分 `>= 70`，或人工评级为 `L2` 且自动分 `>= 80` 时，会调用 `hmos-human-rating-gap-analysis` 生成差异分析，并写入 `human-rating/analysis.json`。响应 `summary` 会返回逐项复核数量、数据集写入数量、`hasOverallComment` 和人工评级差异分析状态；发生分数变化时额外返回重算前后总分和变更计数。

## 远端回调

`POST /score/run-remote-task` 需要调用方提供 `callback`。服务会向该地址发送进度和结果回调。任务已接收但因并发限制仍在本地排队时，会先发送一次 `status: "pending"`；任务进入执行槽位后继续发送现有的执行中和完成/失败回调。

| 字段 | 说明 |
| --- | --- |
| `success` | 完成回调为 `true`，失败回调为 `false` 或缺失。 |
| `taskId` | 远端任务 ID。 |
| `status` | `pending`、`running`、`completed`、`failed`。 |
| `totalScore` | 完成回调时的总分。 |
| `maxScore` | 完成回调时的满分。 |
| `resultData` | 完成回调时只保留 `basic_info` 和 `overall_conclusion` 的结果子集。 |
| `errorMessage` | 失败回调时的错误说明。 |

## 备注

- 服务已开启 CORS，并自动处理 `OPTIONS`。
- 目前没有额外的鉴权层，对接方按现有约定直接调用即可。
