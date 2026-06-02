# hmos-rubric-scoring

rubric 评分 agent，负责在只读 sandbox 中按 rubric 对生成代码逐项打分。

## 概览

| 项目 | 内容 |
| --- | --- |
| 入口 | `src/agents/runners/opencodeRubricScoring.ts` |
| system prompt | `.opencode/prompts/hmos-rubric-scoring-system.md` |
| skill | `.opencode/skills/hmos-rubric-scoring/SKILL.md` |
| 输出文件 | `metadata/agent-output/rubric-scoring.json` |

## 职责

- 只基于 sandbox 可见文件和 `scoring_payload` 评分。
- 优先从 `patch/effective.patch` 取证，再读取必要上下文。
- 覆盖 `rubric_summary.dimension_summaries` 中的每个评分项，不能遗漏或重复。
- 评分必须落在对应 `scoring_bands` 给出的分值集合中。

## 输出

输出 JSON 顶层固定包含：

| 字段 | 说明 |
| --- | --- |
| `summary` | 总体评价与置信度。 |
| `item_scores` | 每个 rubric item 的分数、依据、证据和扣分轨迹。 |
| `hard_gate_candidates` | 硬门槛候选判断。 |
| `risks` | 风险项列表。 |
| `strengths` | 优势列表。 |
| `main_issues` | 主要问题列表。 |

## 权限

- `read`、`glob`、`grep`、`list` 允许。
- 只能调用 `hmos-rubric-scoring` skill。
- 只能写 `metadata/agent-output/*.json`。

## 备注

`scoring_payload.rubric_summary` 是评分项和档位的权威来源，不应再回读完整 rubric 文档。
