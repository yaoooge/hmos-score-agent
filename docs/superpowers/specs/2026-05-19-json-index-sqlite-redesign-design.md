# JSON 索引迁移到 SQLite 的存储重构设计

## 背景

当前代码评测服务的主产物仍然是 case 目录下的 JSON 文件，例如 `outputs/result.json`、`inputs/case-info.json`、`remote-task-index.json`、`rule-violation-stats.json`、`consistency-task-index.json`，以及若干 JSONL 分析数据集。随着用例数量增长，接口侧越来越多地出现“读取全量 JSON 再在内存中过滤”的模式，查询成本会持续上升。

最典型的路径包括：

- `GET /score/rule-violation-stats` 先加载全部规则违反快照，再在内存里按 `caseId`、`testCaseId`、`packId`、时间范围过滤。
- `GET /dashboard/tasks` 会对每个任务逐个读取 `outputs/result.json` 和 `inputs/case-info.json`。
- `GET /score/consistency-tasks` / `PUT /score/consistency-tasks` 直接整文件读写本地 JSON 表。
- 结果分析页读取的 JSONL 数据集，当前也依赖逐行解析和重写。

本文档的目标不是把所有原始产物都塞进数据库，而是把“可查询索引层”迁移到本地数据库，让服务保持单机部署简单，同时把高频查询从文件扫描改成索引查询。

## 目标

- 将高频查询的 JSON 索引层迁移到本地 SQLite。
- 保留 case 目录中的原始产物文件，不改变 `result.json`、`report.html`、日志等文件落盘方式。
- 让任务列表、规则统计、一致性任务和分析页尽量不再扫描 JSON/JSONL 文件。
- 保持单机部署，不引入独立数据库服务。
- 支持从现有 JSON 文件一次性回填到数据库。
- 保证写入是幂等的，避免重试、重复回调或恢复流程造成重复计数。

## 非目标

- 不改评分主流程的业务语义。
- 不改 `outputs/result.json` 的结构。
- 不把大体量原始结果文件改成数据库 BLOB。
- 不为多实例/分布式部署设计主从或分片。
- 不在第一阶段做跨机房、高可用、读写分离。

## 现状问题

### 1. 索引层仍是 JSON 文件

当前 registry、规则违反统计、一致性任务表，本质上都是“JSON 表 + 全量读写”：

- `remote-task-index.json` 维护任务状态。
- `rule-violation-stats.json` 维护规则违反快照。
- `consistency-task-index.json` 维护一致性任务列表。

这些表随着任务数增多，读写都会变慢，尤其是读取后再按条件过滤的接口。

### 2. dashboard 仍依赖文件级派生读取

任务列表不是直接读一个摘要表，而是先遍历 registry，再逐个打开：

- `outputs/result.json`
- `inputs/case-info.json`

这会让列表页的成本和任务总量成正比，而不是和当前页数据量成正比。

### 3. 分析数据仍以 JSONL 追加文件形式存在

人工评分差异、风险复核等分析数据当前都以 JSONL 文件追加或重写。数据量上来后，列表页和筛选页会继续退化。

## 确定方案

本次改造明确使用 SQLite 嵌入式数据库，不引入独立数据库服务。当前服务按单机运行设计，SQLite 可以直接解决 JSON 全量扫描问题，同时保持部署和恢复成本可控。

优点：

- 单机部署最简单，一个数据库文件即可。
- 查询可以使用索引，避免全量扫 JSON。
- 写入、更新、事务、幂等控制比 JSON 文件稳定。
- 迁移成本低，和现有 Node 进程集成直接。
- 原始 case 产物仍保留在文件系统，便于回放和排障。

缺点：

- 不适合后续多实例共享写入。
- 需要自己维护 schema migration 和回填工具。

## 推荐架构

### 分层原则

把存储分成两层：

1. 原始产物层：继续使用 case 目录下的 JSON / HTML / 日志文件。
2. 索引层：把所有需要查询、统计、筛选的数据放到 SQLite。

原始产物负责“事实留存”，数据库负责“查询加速”。

### 数据文件位置

建议在 `localCaseRoot` 下新增一个数据库文件，例如：

```text
<LOCAL_CASE_ROOT>/score-index.sqlite3
```

数据库内只保存可查询字段和必要的摘要字段。大字段可以保留为 JSON 文本列，但查询条件必须落在普通列上。

## 数据模型

### 1. `remote_task`

统一承载远端任务注册信息和 dashboard 列表所需的摘要字段。

核心字段：

- `task_id`，主键
- `status`
- `created_at_ms`
- `updated_at_ms`
- `case_dir`
- `token`
- `test_case_id`
- `test_case_name`
- `test_case_type`
- `error`
- `remote_task_file`
- `recovery_attempt_count`
- `last_recovery_at_ms`
- `case_name`
- `task_type`
- `score`
- `hard_gate_triggered`
- `result_available`
- `result_error`
- `risks_json`

用途：

- 替代 `remote-task-index.json`
- 支撑 `GET /score/remote-tasks/status`
- 支撑 `GET /dashboard/tasks`
- 支撑任务状态统计、分页、排序和关键词搜索

建议索引：

- `task_id` 主键
- `status`
- `created_at_ms`
- `updated_at_ms`
- `test_case_id`
- `score`

### 2. `rule_violation_run`

一次任务完成后的规则违反快照头表。

核心字段：

- `task_id`，主键
- `case_id`
- `test_case_id`
- `case_name`
- `completed_at_ms`

用途：

- 替代 `rule-violation-stats.json` 中的 run 级快照
- 支撑 `GET /score/rule-violation-stats`

建议索引：

- `case_id`
- `test_case_id`
- `completed_at_ms`

### 3. `rule_violation_item`

记录一次 run 中真正不满足的静态规则。

核心字段：

- `task_id`
- `pack_id`
- `rule_id`
- `rule_summary`
- `rule_source`
- `pack_display_name`
- `conclusion`

主键：

- `(task_id, pack_id, rule_id)`

用途：

- 支撑按规则维度的聚合统计
- 支撑 `violationCount`、`affectedCaseIds`、`affectedTaskIds`、`lastViolatedAt`
- 支撑 `packId` 过滤；不再单独维护 run-pack 关系表。

建议索引：

- `(pack_id, rule_id)`
- `task_id`
- `pack_id`

说明：

- 当前统计口径只保存 `result === "不满足"` 的静态规则；因此 `packId` 过滤可以直接通过 `rule_violation_item.pack_id` 完成。
- 如果某次 run 绑定了某规则包但没有违反项，不会出现在规则不满足统计里，和当前 `rule-violation-stats.json` 只保存有违反规则包的语义一致。

### 4. `consistency_task`

替代 `consistency-task-index.json`。

核心字段：

- `id`，主键
- `sequence`
- `payload_json`
- `updated_at_ms`

说明：

- `payload_json` 保留现有任意扩展字段。
- 如果后续发现 `sequence` 是唯一排序条件，也可以把它提升成索引字段。

### 5. `analysis_event`

统一承载当前 JSONL 分析数据，避免继续用逐行扫描和重写。

建议用一个泛化表承载多个数据集：

- `dataset_type`
- `event_key`
- `task_id`
- `test_case_id`
- `risk_id`
- `case_name`
- `manual_analysis_status`
- `manual_analyzed_at_ms`
- `payload_json`
- `updated_at_ms`

主键：

- `(dataset_type, event_key)`

其中：

- `human_rating_gap_analysis` 的 `event_key` 建议使用 `task_id`
- `risk_review_calibration` 的 `event_key` 建议使用 `task_id:risk_id`
- `item_review_calibration` 的 `event_key` 建议使用该数据集稳定唯一键

用途：

- 替代 `human_rating_gap_analyses.jsonl`
- 替代 `risk_review_calibrations.jsonl`
- 替代 `item_review_calibrations.jsonl`

## 写入路径

### 任务完成时

任务完成后，写入流程应变成：

1. 继续写 `caseDir/outputs/result.json`、`report.html` 等原始产物。
2. 提取任务摘要，写入 `remote_task`。
3. 提取规则违反快照，写入 `rule_violation_run`、`rule_violation_item`。
4. 需要时写入分析事件表。

### 查询时

- `GET /score/rule-violation-stats` 直接查 SQLite 聚合，不再先拉全量 run 到内存。
- `GET /dashboard/tasks` 直接查 `remote_task`，不再逐个读 case 文件。
- `GET /score/consistency-tasks` / `PUT /score/consistency-tasks` 直接读写 `consistency_task`。
- 分析页直接查 `analysis_event`。

## 前端接口影响

这次改造不要求前端改接口协议，但需要确认所有前端页面背后的后端接口都改成 SQLite 查询，避免“后端换库但页面仍触发文件扫描”。

### 1. 评测任务页

相关接口：

- `GET /dashboard/summary`
- `GET /dashboard/tasks`
- `GET /dashboard/tasks/status-counts`

调整：

- 任务列表、任务状态计数、分数摘要、任务类型统计都从 `remote_task` 查询。
- 分页、排序、状态、任务类型、分数区间、时间范围、关键词搜索都下推到 SQL。
- `risks_json` 只用于列表摘要展示，不代替完整结果详情。

### 2. 用例报表页

相关接口：

- `GET /dashboard/reports/daily`
- `GET /dashboard/reports/score-distribution`

调整：

- 日报和分数分布直接从 `remote_task` 聚合。
- 不再先调用 `listDashboardTasks()` 读全量任务后在内存聚合。

### 3. 结果分析页

相关接口：

- `GET /dashboard/analysis/human-rating-gaps`
- `PUT /dashboard/analysis/human-rating-gaps/manual-analysis-status`
- `GET /dashboard/analysis/risk-review-calibrations`
- `PUT /dashboard/analysis/risk-review-calibrations/manual-analysis-status`
- `GET /dashboard/analysis/negative-results`

调整：

- 人工评分差异和风险复核从 `analysis_event` 查询。
- 手动分析状态更新直接更新 `analysis_event.manual_analysis_status` 和 `manual_analyzed_at_ms`。
- 负向结果分析从 `remote_task` 查询分数、风险和任务摘要，不再扫描每个 `result.json`。

### 4. 一多适配页

相关接口：

- `GET /dashboard/cross-device/cases`
- `GET /dashboard/cross-device/rule-violations`
- `GET /dashboard/cross-device/risk-review-calibrations`

调整：

- 一多用例列表需要的基础任务信息从 `remote_task` 查询。
- 一多规则违反从 `rule_violation_item` 聚合。
- 一多风险复核从 `analysis_event` 查询。
- 如果现有一多识别信息只存在 `constraint-summary.json`，回填时需要把“一多是否涉及”和原因摘要写入可查询字段；否则这个页面仍会退回文件扫描。

### 5. 一致性分析页

相关接口：

- `GET /score/consistency-tasks`
- `PUT /score/consistency-tasks`
- `GET /score/remote-tasks/status`
- `GET /score/remote-tasks/:taskId/result`

调整：

- 一致性任务列表从 `consistency_task` 查询。
- 批量状态查询从 `remote_task` 查询。
- 完整评分结果仍通过 `GET /score/remote-tasks/:taskId/result` 读取原始 `result.json`。

### 6. 规则不满足统计接口

相关接口：

- `GET /score/rule-violation-stats`

调整：

- 规则统计从 `rule_violation_run` join `rule_violation_item` 聚合。
- `packId` 过滤直接使用 `rule_violation_item.pack_id`。
- `caseId`、`testCaseId`、时间范围过滤使用 `rule_violation_run`。

### 原始结果读取

以下接口仍然可以保留文件读取语义，因为它们需要完整原始结果，不适合作为数据库摘要替代：

- `GET /score/remote-tasks/:taskId/result`
- 日志 tail 读取
- HTML 报告访问

## 迁移策略

### 第一步

新增 SQLite schema 和 repository 层。

### 第二步

启动时做一次回填：

- 从 `remote-task-index.json` 回填 `remote_task`
- 从 `rule-violation-stats.json` 回填 `rule_violation_run` 和明细表
- 从 `consistency-task-index.json` 回填 `consistency_task`
- 从现有 JSONL 分析文件回填 `analysis_event`
- 从历史 case 的 `constraint-summary.json` 或 `metadata.json` 补齐一多适配查询所需字段。

### 第三步

新版本运行时只写 SQLite，JSON 文件只作为原始 case 产物和历史兼容导入来源，不再作为主查询来源。

### 第四步

提供一个离线 rebuild 工具，用于数据库损坏或手工清理后重建索引。

## 错误与恢复

- SQLite 使用 WAL 模式，降低读写互斥。
- 所有写入使用事务，保证一组记录要么全部成功，要么全部失败。
- 所有 upsert 以主键为幂等键，避免重复回调造成重复统计。
- 数据库损坏时，以 case 目录原始产物和 JSON 回填为恢复来源。
- 查询不到索引时返回空结果，不把“首次启动未回填完成”当成业务错误。

## 测试与验收

### 单元测试

- 远端任务注册的 upsert / list / 回填。
- 规则违反快照的幂等写入和聚合查询。
- 一致性任务表的 replace 和 list。
- 分析事件表的 upsert / delete / list。
- dashboard 查询 repository 的分页、排序、筛选、聚合。

### 集成测试

- 任务完成后，`GET /dashboard/tasks` 不再依赖逐个读取 `result.json` 才能返回基础列表。
- `GET /score/rule-violation-stats` 在大量历史记录下仍能稳定完成筛选和聚合。
- `PUT /score/consistency-tasks` 写入后再次启动服务，数据可恢复。
- 前端现有 dashboard API 在回填后的 SQLite 数据上输出和旧实现一致的结果。

### 验收标准

- 现有接口对外语义不变。
- 任务数量增长后，规则统计和任务列表响应时间不再按 JSON 文件线性恶化。
- 原始 case 产物仍能独立回放和排障。
- 旧 JSON 索引可以回填到 SQLite，且回填结果与现有接口输出一致。
