# hmos-understanding

任务理解 agent，负责把预处理后的 case 输入压缩成后续阶段可消费的约束摘要。

## 概览

| 项目 | 内容 |
| --- | --- |
| 入口 | `src/agents/runners/opencodeTaskUnderstanding.ts` |
| system prompt | `.opencode/prompts/hmos-understanding-system.md` |
| skill | `.opencode/skills/hmos-understanding/SKILL.md` |
| 输出文件 | `metadata/agent-output/task-understanding.json` |

## 职责

- 只从工作流预处理后的 prompt 中提取任务约束。
- 只使用 prompt 中的 `agent_input` 或 `constraint_draft`。
- 不读取 `generated/`、`original/`、`patch/` 或业务 `references/`。
- 不探索工程文件，不补充缺失信息。

## 输出

顶层字段固定为：

| 字段 | 说明 |
| --- | --- |
| `explicitConstraints` | 明确要求。 |
| `contextualConstraints` | 工程上下文约束。 |
| `implicitConstraints` | patch 和变更范围带来的隐含约束。 |
| `classificationHints` | 给后续分类使用的短标签。 |

## 权限

- `read` 允许。
- `glob`、`grep`、`list` 禁止。
- 只能调用 `hmos-understanding` skill。
- 只能写 `metadata/agent-output/*.json`。

## 备注

这个 agent 不保留 `references/`，也不应依赖仓库内业务资料作为评分依据。
