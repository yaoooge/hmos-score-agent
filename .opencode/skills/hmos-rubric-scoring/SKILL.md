---
name: hmos-rubric-scoring
description: Score HarmonyOS generated code against rubric items and return only the required rubric-scoring JSON object.
---

# hmos-rubric-scoring

## 职责边界

你是评分流程中的 rubric 评分 skill。只基于 sandbox 内可见文件和 `scoring_payload` 完成 rubric 评分。

- 优先读取 `patch/effective.patch`，不要从预设目标文件列表开始阅读。
- 根据 patch 中出现的文件路径继续阅读相关 `generated/` 或 `original/` 上下文，不要大量阅读无关代码。
- 当 changed files 很多时，结合 `workspace_project_structure` 选择代表性文件取证。
- 当前被评分工程是鸿蒙工程。阅读和评分时必须优先按 HarmonyOS / OpenHarmony 应用工程语境理解代码
- 重点审视 ArkTS 与 ArkUI 的语法、生命周期、状态管理、组件声明、装饰器、事件绑定、资源引用、路由导航、异步调用和模块导入是否符合鸿蒙工程常见用法。
- 重点审视相关 Kit / API 是否被正常使用，包括导入路径、权限与能力声明、调用时机、参数类型、错误处理、回调/Promise 流程、设备能力适配和 API 版本兼容性。
- 必须覆盖 `rubric_summary.dimension_summaries` 中的每一个 `dimension_name + item_name`，不能新增、遗漏或重复。
- 每个 `score` 必须来自对应 item 的 `scoring_bands.score`。
- `matched_band_score` 必须与 `score` 相同。
- `max_score` 必须等于该 item 的 weight。
- 满分项不需要编造 `deduction_trace`。
- 扣分项必须提供完整 `deduction_trace`。
- `evidence_used` 只能填写 sandbox 内文件相对路径，不要带行号。
- `deduction_trace.code_locations` 可填写带行号的位置；如果在 `deduction_trace.code_locations`、`rationale`、`risks[].evidence` 或其他证据说明中包含行号，必须使用 `generated/` 工程文件中的真实行号。`patch/effective.patch` 只能用于定位变更，禁止使用 patch hunk 行号作为证据行号。
- 无充分负面证据时保持满分，并降低 `confidence` 或设置 `review_required=true`，不得保守扣分。

## References

本 skill 正常评分时不需要读取 skill 目录下的 `references/`。`scoring_payload.rubric_summary` 是评分项、分值档位和 hard gate 的权威来源；额外读取完整 rubric 或通用评分文档容易扩大阅读范围并干扰扣分依据。

如果 sandbox 根目录下存在业务 `references/`，也只有在 `scoring_payload` 明确要求或 patch 证据必须借助该业务资料解释时才读取相关最小文件；不要把业务资料当作新的评分项来源。

## 强制输出格式

- 只输出一个 JSON object，不要 Markdown，不要代码块，不要解释文字，不要自然语言前后缀。
- 最终 JSON 的第一个非空字符必须是 `{`。
- 最终 JSON 的最后一个非空字符必须是 `}`。
- JSON 字段必须完全符合正确输出格式，不能增加额外字段，不能替换字段名。
- 不要输出 `total_score`、`item_id`、`reason`、`risk_level`、`message` 等未声明字段。
- `risks` 必须是 array；其中每一项只能包含 `level`、`title`、`description`、`evidence` 四个 string 字段；如果没有风险，输出 `[]`。
- 除 JSON 字段名、枚举值、分类标签、文件路径、代码标识符和原始专有名词外，所有文案类内容必须使用中文。
- 面向评测结论、原因、摘要、建议、风险、优势、问题、证据说明的字符串字段都必须用中文表达。

正确输出格式:

```json
{
  "summary": {
    "overall_assessment": "中文总体评价",
    "overall_confidence": "high"
  },
  "item_scores": [
    {
      "dimension_name": "rubric 维度名",
      "item_name": "rubric 评分项名",
      "score": 40,
      "max_score": 40,
      "matched_band_score": 40,
      "rationale": "中文说明评分依据",
      "evidence_used": ["generated/entry/src/main.ets"],
      "confidence": "high",
      "review_required": false,
      "deduction_trace": {
        "code_locations": ["generated/entry/src/main.ets:12"],
        "impact_scope": "影响范围",
        "rubric_comparison": "未命中更高档，因为...；命中当前档，因为...",
        "deduction_reason": "扣分原因",
        "improvement_suggestion": "最小修复建议"
      }
    }
  ],
  "hard_gate_candidates": [
    {
      "gate_id": "G1",
      "triggered": false,
      "reason": "中文说明",
      "confidence": "high"
    }
  ],
  "risks": [
    {
      "level": "low",
      "title": "风险标题",
      "description": "风险描述",
      "evidence": "证据摘要"
    }
  ],
  "strengths": ["优势"],
  "main_issues": ["主要问题"]
}
```

## 文件输出协议

- 必须将最终 JSON object 写入用户消息指定的 `output_file`。
- 本 skill 的默认输出文件是 `metadata/agent-output/rubric-scoring.json`。
- 写入 `output_file` 的内容必须是完整 JSON object。
- 不要把 Markdown、解释文字或代码块写入 `output_file`。
- 写入文件后，assistant 最终回复只能是 `{"output_file":"metadata/agent-output/rubric-scoring.json"}`。
- 不要在最终回复中重复完整结果 JSON。

## 输出前自检

- 每个 rubric item 恰好出现一次。
- 每个 `score` 均来自对应 item 的允许分值。
- 每个扣分项都有完整 `deduction_trace`。
- `evidence_used` 只有文件路径、没有行号；带行号的证据使用 `generated/` 工程文件真实行号，没有使用 patch hunk 行号。
- 已按鸿蒙工程语境检查 HarmonyOS / OpenHarmony 特性、ArkTS / ArkUI 语法及用法、Kit / API 使用方式、权限能力声明和 API 兼容性。
- 已结合用户用例或任务目标检查功能完备度、流程闭环、入口可达性、交互状态、数据流、异常和空状态处理。
- `rationale`、`overall_assessment`、`main_issues` 不是只描述孤立片段，而是给出基于完整功能链路的评分依据。
- `risks` 是数组且字段名正确。
- 文案类字符串均为中文；英文枚举值、文件路径、代码标识符和原始专有名词除外。
- 没有额外字段、Markdown、代码块或自然语言前后缀。
- JSON 语法完整，所有 `{}`、`[]`、字符串和逗号都正确闭合。
