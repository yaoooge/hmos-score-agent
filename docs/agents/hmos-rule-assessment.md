# hmos-rule-assessment

规则辅助判定 agent，负责对静态规则审计产生的候选规则给出最终判定。

## 概览

| 项目 | 内容 |
| --- | --- |
| 入口 | `src/agent/opencodeRuleAssessment.ts` |
| system prompt | `.opencode/prompts/hmos-rule-assessment-system.md` |
| skill | `.opencode/skills/hmos-rule-assessment/SKILL.md` |
| 输出文件 | `metadata/agent-output/rule-assessment.json` |

## 职责

- 只判断输入中的候选规则，不扩展审计范围。
- 结合 patch、相关上下文、候选规则语义和鸿蒙工程语境做判定。
- 输出 JSON 后逐条检视结论相关性；如果 `reason` 与候选规则、任务期望或证据不相关，必须重新判定该规则。
- 每个候选 `rule_id` 必须恰好输出一次。
- 结果只能是 `violation`、`pass`、`not_applicable`、`uncertain`。

## 输出

输出 JSON 顶层固定包含：

| 字段 | 说明 |
| --- | --- |
| `summary` | 判定范围和总体置信度。 |
| `rule_assessments` | 每个候选规则的最终判定。 |

## 权限

- `read`、`glob`、`grep`、`list` 允许。
- 只能调用 `hmos-rule-assessment` skill。
- 只能写 `metadata/agent-output/*.json`。

## 备注

`references/rules/*.yaml` 只在候选语义不足时按需读取最小相关文件。
