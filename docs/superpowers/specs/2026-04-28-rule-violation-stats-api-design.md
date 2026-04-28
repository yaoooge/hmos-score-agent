# 规则不满足项统计接口设计

## 背景

当前每次远端用例执行完成后，评分流程会生成完整 `outputs/result.json`，其中已经包含：

- `bound_rule_packs`：本次用例绑定的规则包。
- `rule_audit_results`：每条规则的最终判定结果。
- `rule_violations`：最终进入报告的不满足项摘要。

但这些信息只存在于单次执行结果中。随着用例多次执行，当前没有一个统一视角回答以下问题：

- 一共执行了几次用例。
- 每个用例绑定过哪些静态规则包。
- 每条规则累计有几次违反。
- 哪些用例或任务触发了某条规则的不满足。

因此需要设计一个统计接口，把每次执行完成后的静态规则判定结果沉淀为可查询的聚合数据。用例约束规则只服务单次评分报告，不进入本统计口径。

## 目标

- 新增规则不满足项统计接口，用于查看历史执行维度的规则违反情况。
- 只统计静态规则包中的规则，不统计用例动态生成的约束规则。
- 响应只输出 `rules` 维度的规则统计，不输出 `cases` 维度摘要。
- 统计每条静态规则的累计违反次数、影响用例数、影响执行次数、影响用例 ID 和任务 ID。
- 支持按 `caseId`、`testCaseId`、`packId`、时间范围过滤。
- 优先使用本地文件索引落盘，保持当前服务部署简单。
- 统计数据只在任务完成且 `outputs/result.json` 已生成后写入，避免把失败或未完成任务计入规则违反统计。
- 统计索引只保存远端用例执行记录；本地 CLI 或交互式执行结果不进入该索引。

## 非目标

- 不引入数据库作为第一阶段强依赖。
- 不新增前端页面或可视化看板。
- 不改变评分规则的判定逻辑。
- 不修改远端 `POST /score/run-remote-task` 请求协议。
- 不改变现有 completed callback 或完整结果读取接口的语义。
- 不统计未完成、失败、超时任务的规则不满足项；这些任务仍由远端任务状态或日志排查。
- 不统计 `case_rule_results` 或 `is_case_rule === true` 的用例约束规则。
- 不在 `rule-violation-stats.json` 中保存 `满足`、`不涉及`、`待人工复核` 等非违反规则。

## 当前相关代码

- `src/api/app.ts`：挂载 Express API，当前已有 `POST /score/run-remote-task` 和 `GET /score/remote-tasks/:taskId/result`。
- `src/api/apiDefinitions.ts`：集中定义已开放 API 路径和接口文档。
- `src/api/remoteTaskRegistry.ts`：使用本地 JSON 文件维护远端任务索引，可作为本地统计索引实现参考。
- `src/nodes/reportGenerationNode.ts`：生成 `resultJson`，包含 `bound_rule_packs`、`rule_audit_results`、`case_rule_results` 和 `rule_violations`；统计接口只消费其中的静态规则信息。
- `src/nodes/persistAndUploadNode.ts`：将完整结果写入 `<caseDir>/outputs/result.json`。

## 总体设计

第一阶段采用本地文件索引方案：在每次远端任务完成后，从本次 `resultJson` 中提取规则统计快照，追加或更新到本地统计索引文件。

```text
remote task completed
  -> workflow produces resultJson
  -> persist outputs/result.json
  -> extract rule stats snapshot
  -> upsert .local-cases/rule-violation-stats.json
  -> GET /score/rule-violation-stats reads index and returns aggregated view
```

统计接口不直接扫描所有历史 `outputs/result.json`，避免请求时进行大量文件 IO。历史数据通过每次完成任务时增量写入索引。若后续需要重建索引，可单独增加离线 rebuild 工具，不放入本轮范围。

## 存储设计

新增本地统计索引文件：

```text
<LOCAL_CASE_ROOT>/rule-violation-stats.json
```

索引文件按执行记录保存原始快照，而不是只保存聚合值。这样可以在查询阶段灵活按时间、用例、规则包过滤，也方便未来重算聚合逻辑。

文件结构：

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "taskId": 101,
      "caseId": "004",
      "testCaseId": 4,
      "caseName": "位置能力用例",
      "completedAt": "2026-04-28T10:20:30.000Z",
      "boundRulePacks": [
        { "pack_id": "arkts-language", "display_name": "ArkTS 语言规范" },
        { "pack_id": "arkts-performance", "display_name": "ArkTS 性能规范" }
      ],
      "rules": [
        {
          "pack_id": "arkts-language",
          "rule_id": "ARKTS-MUST-001",
          "rule_summary": "必须遵循 ArkTS 语言约束",
          "rule_source": "must_rule",
          "result": "不满足",
          "conclusion": "发现不符合 ArkTS 语言约束的实现。"
        }
      ]
    }
  ]
}
```

写入规则：

- 以 `taskId` 作为一次执行记录的幂等键。
- 同一 `taskId` 重复写入时覆盖旧记录，避免重试或重复回调导致重复计数。
- 只保留规则最终判定结果，不保存完整报告 HTML 或源码路径。
- `boundRulePacks` 只保存静态规则包，过滤掉 `case-requirement_*` 等用例约束规则包。
- `rules` 只保存静态规则包中 `result === "不满足"` 的规则；`满足`、`不涉及`、`待人工复核` 不写入索引。
- `boundRulePacks` 只保存存在不满足规则的静态规则包；没有违反事件的静态规则包不写入该执行快照。

## 规则与规则包关联

统计“每条静态规则属于哪个规则包”需要稳定的 `pack_id`。当前 `rule_audit_results` 只有 `rule_id`、`rule_source`、`rule_summary`、`result`、`conclusion`，没有直接携带 `pack_id`。

本设计要求新增一个规则元数据映射步骤：

1. 使用内置静态规则注册表建立 `rule_id -> pack_id` 映射，不传入 `state.caseRuleDefinitions`。
2. 提取统计快照时，只保留能在静态规则注册表中找到且结果为 `不满足` 的 `rule_audit_results`。
3. 过滤掉 `case_rule_results`、`is_case_rule === true`、`case-requirement_*` 等用例约束规则。
4. 如果某条规则找不到静态 `pack_id`，默认认为它不属于本统计口径并跳过，不写入 `unknown`。

该补齐逻辑只影响统计快照，不要求第一阶段修改 `result.json` schema。若后续希望报告本身也展示规则包归属，可以再扩展 `rule_audit_results` schema。

## 接口设计

新增接口：

```http
GET /score/rule-violation-stats
```

查询参数：

- `caseId`：可选，按本地评分用例 ID 过滤。
- `testCaseId`：可选，按远端测试用例 ID 过滤。
- `packId`：可选，按静态规则包 ID 过滤。
- `from`：可选，ISO 时间字符串，包含该时间之后完成的执行。
- `to`：可选，ISO 时间字符串，包含该时间之前完成的执行。

如果传入的 `packId` 是用例规则包，例如 `case-requirement_*`，接口返回空统计；它不会回退为全量查询，也不会把用例规则纳入统计。

成功响应：

```json
{
  "success": true,
  "filters": {
    "caseId": "004",
    "testCaseId": 4,
    "packId": "arkts-language",
    "from": "2026-04-01T00:00:00.000Z",
    "to": "2026-04-28T23:59:59.999Z"
  },
  "summary": {
    "totalRuns": 5,
    "caseCount": 1,
    "violatedRuleCount": 2,
    "totalViolationEvents": 4
  },
  "rules": [
    {
      "pack_id": "arkts-language",
      "rule_id": "ARKTS-MUST-001",
      "rule_summary": "必须遵循 ArkTS 语言约束",
      "rule_source": "must_rule",
      "violationCount": 3,
      "affectedCaseCount": 1,
      "affectedRunCount": 3,
      "affectedCaseIds": ["004"],
      "affectedTaskIds": [101, 108, 116],
      "lastViolatedAt": "2026-04-28T10:20:30.000Z"
    }
  ]
}
```

字段说明：

- `summary.totalRuns`：过滤后纳入统计的完成执行次数。
- `summary.caseCount`：过滤后出现过的用例数量。
- `summary.violatedRuleCount`：过滤后至少违反过一次的唯一静态规则数量，唯一键为 `pack_id + rule_id`。
- `summary.totalViolationEvents`：过滤后所有静态规则不满足事件总数。同一执行中一条静态规则不满足计为一次。
- `rules[].violationCount`：全局维度该规则违反次数。
- `rules[].affectedRunCount`：触发该规则不满足的执行次数，第一阶段与 `violationCount` 等价。
- `rules[].affectedCaseIds`：触发该静态规则不满足的用例 ID 去重集合。
- `rules[].affectedTaskIds`：触发该静态规则不满足的任务 ID 去重集合。

## 错误响应

统计索引不存在时返回空统计，不视为错误：

```json
{
  "success": true,
  "filters": {},
  "summary": {
    "totalRuns": 0,
    "caseCount": 0,
    "violatedRuleCount": 0,
    "totalViolationEvents": 0
  },
  "rules": []
}
```

查询参数非法时返回 `400`：

```json
{
  "success": false,
  "message": "Invalid query parameter: from must be an ISO timestamp"
}
```

统计索引文件损坏或读取失败时返回 `500`，并在服务日志中记录具体错误。接口响应不暴露本地绝对路径。

## 组件设计

### `ruleViolationStatsStore`

新增本地 store，职责类似 `remoteTaskRegistry`：

- 懒加载 `<LOCAL_CASE_ROOT>/rule-violation-stats.json`。
- 串行化读写，避免并发完成任务时覆盖数据。
- 提供 `upsertRun(snapshot)` 写入单次执行快照。
- 提供 `listRuns()` 给查询 handler 聚合。
- 保存时使用临时文件加 rename，避免写入中断导致索引半截损坏。

### `ruleViolationStatsExtractor`

新增快照提取模块：

- 从 `ScoreGraphState` 或完成后的 `resultJson` 中提取 `taskId`、`caseId`、`testCaseId`、`caseName`、静态 `boundRulePacks`。
- 从最终规则判定结果提取结果为 `不满足` 的静态规则列表。
- 通过内置静态规则注册表补齐 `pack_id`，并跳过用例约束规则。
- 输出不包含本地路径和大字段的轻量统计快照。

### 离线 rebuild 工具

新增 `src/tools/rebuildRuleViolationStats.ts` 用于从历史产物重建 `<LOCAL_CASE_ROOT>/rule-violation-stats.json`：

- 扫描 `<LOCAL_CASE_ROOT>/**/outputs/result.json`。
- 读取同级用例目录下的 `inputs/case-info.json` 补充远端任务元数据。
- 只重建包含 `remote_task_id` 或 `report_meta.unit_name` 为 `remote-task-<id>` 的远端用例。
- 本地执行用例即使存在 `outputs/result.json` 也会被忽略。
- 写入索引前仍执行相同的静态规则和 `不满足` 过滤。

### API handler

新增 `createGetRuleViolationStatsHandler(store)`：

- 解析并校验查询参数。
- 从 store 读取所有 run snapshots。
- 应用过滤条件。
- 聚合 `summary` 和 `rules`。
- 返回稳定排序结果，方便调用方展示和测试断言。

排序规则：

- `rules` 按 `violationCount` 降序，再按 `pack_id`、`rule_id` 升序。

## 写入时机

统计快照应在评分成功并生成最终 `resultJson` 后写入。推荐接入点是远端任务执行完成路径，而不是报告生成节点内部：

- 报告生成节点只负责构造报告内容，避免耦合历史统计副作用。
- 远端任务完成路径已经知道 `taskId`、`remoteTask.testCase.id` 和 `caseDir`，更适合补充执行级元数据。
- 如果未来本地 CLI 也需要纳入统计，可以复用同一个 `ruleViolationStatsStore.upsertRun()`，但本轮先覆盖远端任务执行。

## 数据库取舍

第一阶段不接数据库，原因：

- 当前服务已经用本地 JSON 文件记录远端任务索引，部署模型偏单机轻量。
- 统计数据量预计以用例执行次数为主，短期 JSON 索引足以支撑查询。
- 本地索引开发成本低，便于快速验证统计维度是否满足业务需求。

建议升级数据库的条件：

- 执行记录达到数万级，单文件读取和聚合明显变慢。
- 服务需要多实例部署，共享同一份统计数据。
- 需要复杂查询，例如按团队、项目、分支、规则优先级做多维分析。
- 需要长期留存、权限隔离、审计或定期归档。

数据库演进方向：

- `run_records(task_id, case_id, test_case_id, case_name, completed_at)`
- `run_rule_packs(task_id, pack_id, display_name)`
- `run_rule_results(task_id, pack_id, rule_id, rule_summary, rule_source, result, conclusion)`

API 响应结构保持不变，底层 store 从文件实现切换为数据库实现。

## 安全与隐私

- 统计接口不返回 `caseDir`、源码路径、本地绝对路径、callback token。
- 第一阶段不新增鉴权，保持与当前健康检查和结果接口所在服务部署方式一致。
- 如果该服务暴露到非可信网络，应在网关层或后续接口层增加鉴权；鉴权方案不放入本轮实现范围。

## 测试计划

新增或更新测试覆盖：

1. 完成任务后写入一条统计快照，包含用例、静态规则包和静态规则结果。
2. 同一 `taskId` 重复写入不会重复计数。
3. `GET /score/rule-violation-stats` 返回总执行次数和 `rules` 规则聚合，不返回 `cases` 摘要。
4. 只统计静态规则中 `result === "不满足"` 的规则，`满足`、`不涉及`、`待人工复核` 不计入违反次数。
5. `caseId`、`testCaseId`、`packId`、`from`、`to` 过滤生效。
6. 统计索引不存在时返回空统计。
7. 非法时间查询参数返回 `400`。
8. 用例约束规则、`case-requirement_*` 规则包和缺少静态 `pack_id` 映射的规则不会进入统计。

## 兼容性

- 不改变现有评分结果文件位置。
- 不改变 `outputs/result.json` 第一阶段 schema。
- 不改变远端任务提交接口和 callback 协议。
- 新接口为增量能力，旧调用方不受影响。

## 后续扩展

- 增加 `GET /score/rule-violation-stats/runs` 查看明细执行记录。
- 增加离线 rebuild 工具，从历史 `outputs/result.json` 重建统计索引。
- 在 `result.json` 的 `rule_audit_results` 中直接补充 `pack_id`。
- 增加静态规则优先级、规则来源、P0 hard gate 维度统计。
- 如后续业务需要，再单独设计用例约束规则统计接口，避免与静态规则包统计口径混用。
- 增加数据库 store 实现，支持多实例和大规模查询。
