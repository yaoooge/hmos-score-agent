# hmos-human-rating-gap-analysis

人工评级差异分析 agent，负责分析整单人工评级和自动评分之间的差异来源。

## 概览

| 项目 | 内容 |
| --- | --- |
| 入口 | `src/agent/opencodeHumanRatingGapAnalysis.ts` |
| 节点 | `src/nodes/humanRatingGapAnalysisNode.ts` |
| system prompt | `.opencode/prompts/hmos-human-rating-gap-analysis-system.md` |
| skill | `.opencode/skills/hmos-human-rating-gap-analysis/SKILL.md` |
| 输出文件 | `metadata/agent-output/human-rating-gap-analysis.json` |

## 触发条件

仅在以下情况触发：

| 人工评级 | 自动分 |
| --- | --- |
| `L1` | `>= 70` |
| `L2` | `>= 80` |

触发入口是 `POST /score/remote-tasks/:taskId/manual-rating`。

## 职责

- 对比 `manual_rating_record` 和 `result_json`。
- 判断差异主要来自人工评级、评分系统、两侧都需复核或证据不足。
- 不重新打分，不修改 `outputs/result.json`。
- 只写 `human-rating/analysis.json` 和样本数据。

## 输出

顶层字段固定为：

| 字段 | 说明 |
| --- | --- |
| `primaryConclusion` | 差异归因结论。 |
| `confidence` | `high`、`medium`、`low`。 |
| `reasonSummary` | 一句话总结。 |
| `humanRatingReview` | 人工评级是否需要改进。 |
| `scoringSystemReview` | 评分系统是否需要改进。 |
| `evidence` | 可复核证据。 |
| `recommendedActions` | 建议动作。 |

## 权限

- `read`、`glob`、`grep`、`list` 允许。
- 只能调用 `hmos-human-rating-gap-analysis` skill。
- 只能写 `metadata/agent-output/*.json`。

## 备注

这个 agent 不保留 `references/`，只基于当前 case 目录内证据和输入 JSON 分析差异。
