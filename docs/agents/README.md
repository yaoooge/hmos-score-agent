# Agents

本目录记录当前仓库内的 4 个 opencode agent。每个文件说明它的职责、输入输出、权限和调用入口。

## 一览

| Agent | 阶段 | 文档 |
| --- | --- | --- |
| `hmos-understanding` | 任务理解 | [hmos-understanding.md](hmos-understanding.md) |
| `hmos-rubric-scoring` | rubric 评分 | [hmos-rubric-scoring.md](hmos-rubric-scoring.md) |
| `hmos-rule-assessment` | 规则辅助判定 | [hmos-rule-assessment.md](hmos-rule-assessment.md) |
| `hmos-human-rating-gap-analysis` | 人工评级差异分析 | [hmos-human-rating-gap-analysis.md](hmos-human-rating-gap-analysis.md) |

## 阅读顺序

1. 先看 [hmos-understanding.md](hmos-understanding.md)，理解任务理解 agent 的最小输入和输出。
2. 再看 [hmos-rubric-scoring.md](hmos-rubric-scoring.md)，理解评分阶段的 JSON 契约。
3. 然后看 [hmos-rule-assessment.md](hmos-rule-assessment.md)，理解规则辅助判定如何补强静态规则。
4. 最后看 [hmos-human-rating-gap-analysis.md](hmos-human-rating-gap-analysis.md)，理解人工评级差异分析的触发条件和输出约束。
