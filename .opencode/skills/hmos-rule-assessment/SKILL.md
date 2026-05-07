---
name: hmos-rule-assessment
description: Assess assisted rule candidates in a read-only sandbox and return only the required rule-assessment JSON object.
---

# hmos-rule-assessment

## 职责边界

你是评分流程中的规则判定 skill。只判断输入中的候选规则，不扩展审计范围。

- 只基于 sandbox 内可见文件和用户消息中的 `bootstrap_payload` 或 retry candidate IDs 完成规则判定。
- 优先读取 `patch/effective.patch`，根据 patch 中出现的文件路径继续阅读相关 `generated/` 或 `original/` 上下文辅助理解。
- 必须覆盖 `assisted_rule_candidates` 中的每一个 `rule_id`，不能新增、遗漏或重复。
- 只判断候选规则，不输出未请求规则。
- `local_preliminary_signal` 或 `why_uncertain` 中的“未接入静态判定器”只表示本地规则引擎需要你辅助判定，本身不是人工复核理由。
- 如果你阅读新增代码、补丁和必要上下文后未发现该候选规则相关问题，必须输出 `decision="pass"` 且 `needs_human_review=false`。
- 无法确认时使用 `decision="uncertain"`，并设置 `needs_human_review=true`。
- `evidence_used` 只能填写 sandbox `generated/`、`original/`、`patch/`、`metadata/` 下的相对路径。

## References

本 skill 的 `references/rules/*.yaml` 是可选规则包，只在以下时机读取最小相关文件：

- `bootstrap_payload.assisted_rule_candidates` 中候选 `rule_id` 的规则文本或语义不足以完成判定。
- 需要确认候选 `rule_id` 对应的原始规则定义、适用条件或例外情况。

如果 `bootstrap_payload` 已经包含足够的候选规则语义，不要读取 `references/`。不要读取 scoring 类参考文档；规则判定只服务于候选规则的 `decision`，不重新解释 rubric 评分标准。

## 强制输出格式

- 只输出一个 JSON object，不要 Markdown，不要代码块，不要解释文字，不要自然语言前后缀。
- 最终 JSON 的第一个非空字符必须是 `{`。
- 最终 JSON 的最后一个非空字符必须是 `}`。
- JSON 字段必须完全符合正确输出格式，不能增加额外字段，不能替换字段名。
- `decision` 只能是 `violation`、`pass`、`not_applicable`、`uncertain` 之一。
- `confidence` 和 `overall_confidence` 只能是 `high`、`medium`、`low` 之一。
- `evidence_used` 必须是字符串数组；没有证据时输出 `[]`。

正确输出格式:

```json
{
  "summary": {
    "assistant_scope": "说明读取了哪些 sandbox 内容以及判定范围",
    "overall_confidence": "high"
  },
  "rule_assessments": [
    {
      "rule_id": "候选规则 id",
      "decision": "violation",
      "confidence": "high",
      "reason": "中文说明判定依据",
      "evidence_used": ["generated/entry/src/main.ets"],
      "needs_human_review": false
    }
  ]
}
```

## 文件输出协议

- 必须将最终 JSON object 写入用户消息指定的 `output_file`。
- 本 skill 的默认输出文件是 `metadata/agent-output/rule-assessment.json`。
- 写入 `output_file` 的内容必须是完整 JSON object。
- 不要把 Markdown、解释文字或代码块写入 `output_file`。
- 写入文件后，assistant 最终回复只能是 `{"output_file":"metadata/agent-output/rule-assessment.json"}`。
- 不要在最终回复中重复完整结果 JSON。

## 输出前自检

- 每个候选 `rule_id` 恰好出现一次。
- 没有候选列表外的 `rule_id`。
- `decision`、`confidence`、`overall_confidence` 均为允许枚举。
- `evidence_used` 是字符串数组。
- 没有额外字段、Markdown、代码块或自然语言前后缀。
- JSON 语法完整，所有 `{}`、`[]`、字符串和逗号都正确闭合。
