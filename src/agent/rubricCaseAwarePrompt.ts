import type {
  CaseInput,
  ConstraintSummary,
  LoadedRubricSnapshot,
  RubricScoringPayload,
  TaskType,
} from "../types.js";

type BuildRubricCaseAwarePayloadInput = {
  caseInput: CaseInput;
  caseRoot: string;
  effectivePatchPath?: string;
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
  initialTargetFiles: string[];
};

export function buildRubricCaseAwarePayload(
  input: BuildRubricCaseAwarePayloadInput,
): RubricScoringPayload {
  return {
    case_context: {
      case_id: input.caseInput.caseId,
      case_root: input.caseRoot,
      task_type: input.taskType,
      original_prompt_summary: input.caseInput.promptText,
      original_project_path: input.caseInput.originalProjectPath,
      generated_project_path: input.caseInput.generatedProjectPath,
      effective_patch_path: input.effectivePatchPath,
    },
    task_understanding: input.constraintSummary,
    rubric_summary: input.rubricSnapshot,
    initial_target_files: input.initialTargetFiles,
    tool_contract: {
      allowed_tools: [
        "read_patch",
        "list_dir",
        "read_file",
        "read_file_chunk",
        "grep_in_files",
        "read_json",
      ],
      max_tool_calls: 4,
      max_total_bytes: 40960,
      max_files: 12,
    },
    response_contract: {
      action_enum: ["tool_call", "final_answer"],
      output_language: "zh-CN",
      json_only: true,
    },
  };
}

export function renderRubricCaseAwareBootstrapPrompt(payload: RubricScoringPayload): string {
  return [
    "你是评分工作流中的 rubric case-aware 主评分 agent。",
    "你只能输出 tool_call 或 final_answer 两种 JSON action。",
    "一次只能输出一个 JSON object，禁止 markdown、代码块或任何额外解释。",
    "每个 rubric item 默认满分；只有通过工具读取到明确负面证据时才允许扣分。",
    "证据不足时必须保持满分，不得保守扣分。",
    "如果需要扣分，必须先调用 read_patch、read_file、read_file_chunk 或 grep_in_files 读取代码证据。",
    "扣分项必须提供 deduction_trace，字段包含 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    "improvement_suggestion 必须给出针对当前问题点的最小修复建议，不能写空泛建议。",
    "item_scores 必须覆盖 rubric_summary.dimension_summaries 中的每个 item，且不得遗漏、重复或新增未知 item。",
    "score 与 matched_band_score 必须相等，并且只能使用该 item scoring_bands 中声明过的 score。",
    "满分项不需要编造 deduction_trace；没有足够负面证据就保持满分。",
    "请优先从 initial_target_files 和 effective_patch_path 开始收集证据。",
    "工具参数必须严格匹配以下结构：",
    "read_patch: args 可为空，或仅允许 path 字段。",
    "list_dir: args = { path }。",
    "read_file: args = { path }。",
    "read_file_chunk: args = { path, startLine, lineCount }。",
    "grep_in_files: args = { pattern, path, limit }。",
    "read_json: args = { path }。",
    "",
    "最终 final_answer 必须直接包含 summary、item_scores、hard_gate_candidates、risks、strengths、main_issues。",
    "当前评分上下文如下：",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

export function renderRubricCaseAwareSystemPrompt(_payload: RubricScoringPayload): string {
  return [
    "你是评分工作流中的 rubric case-aware 主评分 agent。",
    "必须只输出一个 JSON object，不得输出 markdown、代码块或解释性前后缀。",
    "合法 action 只有 tool_call 和 final_answer。",
    "评分原则：每个 rubric item 初始默认满分，找不到足够负面证据就保持满分。",
    "扣分只能基于已读取到的明确代码证据，且必须落到 rubric 已声明的 score band。",
  ].join("\n");
}

export function renderRubricCaseAwareFollowupPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
}): string {
  return [
    "你正在继续同一个 rubric case-aware 评分任务。",
    "下面是最近一次工具调用返回的结果，请结合已有上下文继续决定下一步。",
    "你后续每一轮仍只能输出一个 JSON object，action 只能是 tool_call 或 final_answer。",
    "如果证据已经足够，请输出 final_answer；如果证据不足以扣分，则必须对对应 item 保持满分。",
    "final_answer 必须覆盖所有 rubric item，扣分项必须包含 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    `当前回合: ${input.turn}`,
    "最近一次工具观察结果：",
    input.latestObservation,
    "",
    "当前评分上下文如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}

export function renderRubricCaseAwareSingleActionRetryPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
  failureReason: string;
  rawOutputText: string;
}): string {
  const rawOutputPreview =
    input.rawOutputText.length > 2000
      ? `${input.rawOutputText.slice(0, 2000)}...`
      : input.rawOutputText;

  return [
    "这是一次 rubric 顶层 action 协议修复重试。",
    "上一轮输出没有通过 JSON 协议校验。",
    "本轮只能选择 tool_call 或 final_answer 其中一个 action，并且只能输出一个 JSON object。",
    "禁止输出多个顶层 JSON object，禁止输出 markdown、代码块或解释文字。",
    "如果证据不足以 final_answer，请输出 tool_call；如果证据已经足够，请输出 final_answer。",
    `当前回合: ${input.turn}`,
    `上一轮失败原因: ${input.failureReason}`,
    "上一轮原始输出摘录：",
    rawOutputPreview,
    input.latestObservation
      ? ["最近一次工具观察结果：", input.latestObservation].join("\n")
      : "最近一次工具观察结果：无。",
    "",
    "当前评分上下文如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ].join("\n");
}

export function renderRubricCaseAwareFinalAnswerRetryPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
  failureReason?: string;
}): string {
  const requiredItems = input.bootstrapPayload.rubric_summary.dimension_summaries.flatMap(
    (dimension) =>
      dimension.item_summaries.map((item) => `${dimension.name}::${item.name}`),
  );

  return [
    "这是一次 rubric final_answer 协议修复重试。",
    "上一轮已经进入最终评分阶段，但 final_answer 未通过协议或完整性校验。",
    "本轮只能重新输出一个 final_answer JSON object，禁止继续调用工具，禁止输出 markdown、代码块或解释文字。",
    "必须直接包含 action、summary、item_scores、hard_gate_candidates、risks、strengths、main_issues。",
    "item_scores 必须逐条覆盖所有 rubric item，不能遗漏、重复或新增未知 item。",
    "score 和 matched_band_score 必须相等，且只能使用对应 scoring_bands 中声明过的分数。",
    "扣分项必须包含 deduction_trace，并给出代码位置、影响范围、rubric 档位对比、扣分理由和改进建议。",
    "找不到足够负面证据的 item 必须保持满分。",
    requiredItems.length > 0
      ? `必须覆盖这些 item: ${requiredItems.join("；")}。`
      : "当前 rubric item 为空；如果上游误调用，仍必须保持 final_answer schema 合法。",
    input.failureReason ? `上一轮失败原因: ${input.failureReason}` : "",
    `当前回合: ${input.turn}`,
    input.latestObservation
      ? ["最近一次工具观察结果：", input.latestObservation].join("\n")
      : "最近一次工具观察结果：无。",
    "",
    "当前评分上下文如下：",
    JSON.stringify(input.bootstrapPayload, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderRubricCaseAwareToolCallRetryPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
  failureReason?: string;
}): string {
  const allowedTools = input.bootstrapPayload.tool_contract?.allowed_tools ?? [];

  return [
    "这是一次 rubric tool_call 协议修复重试。",
    "上一轮准备调用工具，但 tool_call 的 JSON 结构没有通过协议校验。",
    "本轮只能重新输出一个 tool_call JSON object，禁止输出 final_answer，禁止输出 markdown、代码块或解释文字。",
    JSON.stringify(
      {
        action: "tool_call",
        tool: "read_patch",
        args: {},
        reason: "请用中文说明为什么需要调用这个工具。",
      },
      null,
      2,
    ),
    allowedTools.length > 0 ? `tool 只能从这些 allowed_tools 中选择: ${allowedTools.join(", ")}。` : "",
    "args 必须是 object；不同工具的 args 形状必须遵守首轮 prompt 中的工具参数说明。",
    input.failureReason ? `上一轮失败原因: ${input.failureReason}` : "",
    `当前回合: ${input.turn}`,
    input.latestObservation
      ? ["最近一次工具观察结果：", input.latestObservation].join("\n")
      : "最近一次工具观察结果：无。",
  ]
    .filter(Boolean)
    .join("\n");
}
