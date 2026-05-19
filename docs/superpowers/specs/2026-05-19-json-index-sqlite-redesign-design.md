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

## 方案对比

### 方案 A: SQLite 嵌入式数据库

优点：

- 单机部署最简单，一个数据库文件即可。
- 查询可以使用索引，避免全量扫 JSON。
- 写入、更新、事务、幂等控制比 JSON 文件稳定。
- 迁移成本低，和现有 Node 进程集成直接。
- 原始 case 产物仍保留在文件系统，便于回放和排障。

缺点：

- 不适合后续多实例共享写入。
- 复杂报表和高并发写入能力不如服务型数据库。
- 需要自己维护 schema migration 和回填工具。

### 方案 B: MySQL / PostgreSQL 独立数据库服务

优点：

- 并发、事务、索引和备份能力更强。
- 后续如果要做多实例、共享状态或对外服务化，扩展更自然。
- 更适合未来把评测服务拆成多进程/多机器。

缺点：

- 对当前单机部署来说太重。
- 要额外处理连接池、运维、故障恢复和部署依赖。
- 迁移和测试成本明显更高。

### 结论

当前明确是单机运行，所以优先选择 SQLite。它能解决现在的主要瓶颈，又不会把部署复杂度抬高。

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

### 3. `rule_violation_run_pack`

记录一次 run 绑定了哪些静态规则包。

核心字段：

- `task_id`
- `pack_id`
- `display_name`

主键：

- `(task_id, pack_id)`

用途：

- 保留当前 `packId` 过滤语义
- 让规则包过滤不必扫描整份 run 明细

### 4. `rule_violation_item`

记录一次 run 中真正不满足的静态规则。

核心字段：

- `task_id`
- `pack_id`
- `rule_id`
- `rule_summary`
- `rule_source`
- `conclusion`

主键：

- `(task_id, pack_id, rule_id)`

用途：

- 支撑按规则维度的聚合统计
- 支撑 `violationCount`、`affectedCaseIds`、`affectedTaskIds`、`lastViolatedAt`

建议索引：

- `(pack_id, rule_id)`
- `task_id`
- `pack_id`

### 5. `consistency_task`

替代 `consistency-task-index.json`。

核心字段：

- `id`，主键
- `sequence`
- `payload_json`
- `updated_at_ms`

说明：

- `payload_json` 保留现有任意扩展字段。
- 如果后续发现 `sequence` 是唯一排序条件，也可以把它提升成索引字段。

### 6. `analysis_event`

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
3. 提取规则违反快照，写入 `rule_violation_run`、`rule_violation_run_pack`、`rule_violation_item`。
4. 需要时写入分析事件表。

### 查询时

- `GET /score/rule-violation-stats` 直接查 SQLite 聚合，不再先拉全量 run 到内存。
- `GET /dashboard/tasks` 直接查 `remote_task`，不再逐个读 case 文件。
- `GET /score/consistency-tasks` / `PUT /score/consistency-tasks` 直接读写 `consistency_task`。
- 分析页直接查 `analysis_event`。

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

## 优劣总结

### SQLite 适合当前阶段

- 单机部署
- 查询量持续增长
- 需要低运维成本
- 需要保留文件产物作为事实源

### MySQL / PostgreSQL 更适合后续阶段

- 多实例共享
- 更高并发写入
- 更强的运维和备份要求
- 未来需要把这套索引升级成服务级数据层

结论还是一样：现在先做 SQLite，把查询瓶颈先解决掉。

## 测试与验收

### 单元测试

- 远端任务注册的 upsert / list / 回填。
- 规则违反快照的幂等写入和聚合查询。
- 一致性任务表的 replace 和 list。
- 分析事件表的 upsert / delete / list。

### 集成测试

- 任务完成后，`GET /dashboard/tasks` 不再依赖逐个读取 `result.json` 才能返回基础列表。
- `GET /score/rule-violation-stats` 在大量历史记录下仍能稳定完成筛选和聚合。
- `PUT /score/consistency-tasks` 写入后再次启动服务，数据可恢复。

### 验收标准

- 现有接口对外语义不变。
- 任务数量增长后，规则统计和任务列表响应时间不再按 JSON 文件线性恶化。
- 原始 case 产物仍能独立回放和排障。
- 旧 JSON 索引可以回填到 SQLite，且回填结果与现有接口输出一致。
