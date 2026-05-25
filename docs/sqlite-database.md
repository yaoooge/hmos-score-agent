# SQLite 数据库

本项目把高频查询数据落在本地 SQLite 中，数据库文件默认位于：

```text
<LOCAL_CASE_ROOT>/score-index.sqlite3
```

API 服务启动时会自动创建 schema 并开启 `WAL`；离线回填或重建可用：

```bash
npm run db:generate
```

## 约定

- 时间字段统一使用毫秒时间戳，字段名通常以 `_at_ms` 结尾。
- 布尔字段通常存为 `0/1`。
- 大字段或扩展字段会放进 `*_json` 文本列。
- `remote_task.status` 的原始值包含 `preparing`、`queued`、`running`、`completed`、`failed`、`timed_out`。

## 表结构

| 表 | 用途 |
| --- | --- |
| `schema_migrations` | schema 版本记录。 |
| `remote_task` | 远端任务注册信息、任务摘要、分数和风险摘要。 |
| `rule_violation_run` | 规则违反统计的 run 级快照。 |
| `rule_violation_item` | 单条违反规则明细。 |
| `consistency_task` | 一致性任务索引和 payload。 |
| `analysis_event` | 人工评级差异、风险复核等分析数据。 |

`remote_task` 的常用列包括：`task_id`、`status`、`created_at_ms`、`updated_at_ms`、`test_case_id`、`case_name`、`task_type`、`score`、`hard_gate_triggered`、`result_available` 和 `risks_json`。

`rule_violation_run` 的常用列包括：`task_id`、`case_id`、`test_case_id`、`case_name`、`completed_at_ms`。

`rule_violation_item` 通过 `(task_id, item_index)` 定位单次 run 内的明细，核心列是 `pack_id`、`rule_id`、`rule_summary`、`rule_source`、`conclusion`。

`analysis_event` 使用 `(dataset_type, event_key)` 作为主键，常见字段是 `task_id`、`test_case_id`、`risk_id`、`case_name`、`manual_analysis_status`、`manual_analyzed_at_ms` 和 `payload_json`。

## 常用查询

### 查看表和索引

```sql
SELECT name, type
  FROM sqlite_master
 WHERE type IN ('table', 'index')
 ORDER BY type, name;
```

### 查看最近 20 条任务

```sql
SELECT task_id, status, created_at_ms, updated_at_ms, case_name, task_type, score
  FROM remote_task
 ORDER BY updated_at_ms DESC
 LIMIT 20;
```

### 按状态统计任务数

```sql
SELECT status, COUNT(*) AS count
  FROM remote_task
 GROUP BY status
 ORDER BY count DESC, status;
```

### 按日期统计任务量和平均分

```sql
SELECT date(created_at_ms / 1000, 'unixepoch') AS day,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
       ROUND(AVG(CASE WHEN status = 'completed' THEN score END), 2) AS average_score
  FROM remote_task
 GROUP BY day
 ORDER BY day;
```

### 分数区间分布

```sql
SELECT CASE
         WHEN score BETWEEN 0 AND 59 THEN '0-59'
         WHEN score BETWEEN 60 AND 69 THEN '60-69'
         WHEN score BETWEEN 70 AND 79 THEN '70-79'
         WHEN score BETWEEN 80 AND 89 THEN '80-89'
         WHEN score BETWEEN 90 AND 100 THEN '90-100'
       END AS bucket,
       COUNT(*) AS count
  FROM remote_task
 WHERE score IS NOT NULL
 GROUP BY bucket
 ORDER BY bucket;
```

### 规则违反统计

```sql
SELECT r.case_id,
       r.test_case_id,
       r.case_name,
       r.completed_at_ms,
       i.pack_id,
       i.rule_id,
       i.rule_summary,
       i.rule_source,
       i.conclusion
  FROM rule_violation_run r
  JOIN rule_violation_item i ON i.task_id = r.task_id
 ORDER BY r.completed_at_ms DESC, r.task_id DESC, i.item_index ASC;
```

### 按规则包统计违反次数

```sql
SELECT i.pack_id,
       i.rule_id,
       COUNT(*) AS violation_count
  FROM rule_violation_run r
  JOIN rule_violation_item i ON i.task_id = r.task_id
 GROUP BY i.pack_id, i.rule_id
 ORDER BY violation_count DESC, i.pack_id, i.rule_id;
```

### 查看人工分析状态

```sql
SELECT dataset_type,
       event_key,
       task_id,
       test_case_id,
       risk_id,
       case_name,
       manual_analysis_status,
       manual_analyzed_at_ms
  FROM analysis_event
 ORDER BY updated_at_ms DESC
 LIMIT 50;
```

### 统计待处理分析事件

```sql
SELECT dataset_type, manual_analysis_status, COUNT(*) AS count
  FROM analysis_event
 GROUP BY dataset_type, manual_analysis_status
 ORDER BY dataset_type, manual_analysis_status;
```

### 查看一致性任务

```sql
SELECT id, sequence, updated_at_ms, payload_json
  FROM consistency_task
 ORDER BY sequence, id;
```

## 维护建议

- schema 变化时，先更新这里的表结构和常用查询，再同步代码实现。
- 如果只想看原始内容，`result.json`、日志和 HTML 报告仍然保留在 case 目录里，不会被 SQLite 替代。
