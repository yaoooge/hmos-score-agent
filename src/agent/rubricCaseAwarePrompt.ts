import path from "node:path";
import type {
  CaseInput,
  ConstraintSummary,
  LoadedRubricSnapshot,
  ProjectStructureSummary,
  RubricScoringPayload,
  TaskType,
} from "../types.js";
import {
  createRubricAgentToolContract,
  SHARED_CASE_TOOL_ARGUMENT_LINES,
} from "./caseAwareToolContract.js";

type BuildRubricCaseAwarePayloadInput = {
  caseInput: CaseInput;
  caseRoot: string;
  effectivePatchPath?: string;
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
  initialTargetFiles: string[];
  workspaceProjectStructure?: ProjectStructureSummary;
  workspaceProjectStructureNote?: string;
};

type RubricCaseAwareInteractionPayload = {
  case_context: {
    case_id: string;
    task_type: TaskType;
    original_prompt_summary: string;
    generated_project_root: string;
    has_effective_patch: boolean;
    effective_patch_path?: string;
  };
  task_understanding: ConstraintSummary;
  initial_target_files: string[];
  workspace_project_structure?: {
    top_level_entries: string[];
    module_paths: string[];
    representative_files: string[];
    implementation_hints: string[];
    omitted_file_count: number;
  };
  workspace_project_structure_note?: string;
  rubric_items: Array<{
    dimension_name: string;
    dimension_intent: string;
    items: Array<{
      item_name: string;
      max_score: number;
      allowed_scores: Array<{
        score: number;
        criteria: string;
      }>;
    }>;
  }>;
  hard_gate_ids: string[];
};

type RubricCaseAwareRepairPayload = Pick<
  RubricCaseAwareInteractionPayload,
  "case_context" | "task_understanding" | "initial_target_files"
> & {
  suggested_next_tools: string[];
  workspace_project_structure?: RubricCaseAwareInteractionPayload["workspace_project_structure"];
  workspace_project_structure_note?: string;
};

function toPromptPath(caseRoot: string, filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  const relativePath = path.relative(caseRoot, filePath);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join("/");
  }

  return filePath.split(path.sep).join("/");
}

function toPromptWorkspaceProjectStructure(
  projectStructure?: ProjectStructureSummary,
): RubricCaseAwareInteractionPayload["workspace_project_structure"] | undefined {
  if (!projectStructure) {
    return undefined;
  }

  return {
    top_level_entries: projectStructure.topLevelEntries,
    module_paths: projectStructure.modulePaths,
    representative_files: projectStructure.representativeFiles,
    implementation_hints: projectStructure.implementationHints,
    omitted_file_count: projectStructure.omittedFileCount,
  };
}

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
    workspace_project_structure: input.workspaceProjectStructure,
    workspace_project_structure_note: input.workspaceProjectStructureNote,
    tool_contract: createRubricAgentToolContract(),
    response_contract: {
      action_enum: ["tool_call", "final_answer"],
      output_language: "zh-CN",
      json_only: true,
    },
  };
}

function buildRubricCaseAwareInteractionPayload(
  payload: RubricScoringPayload,
): RubricCaseAwareInteractionPayload {
  return {
    case_context: {
      case_id: payload.case_context.case_id,
      task_type: payload.case_context.task_type,
      original_prompt_summary: payload.case_context.original_prompt_summary,
      generated_project_root: "workspace",
      has_effective_patch: Boolean(payload.case_context.effective_patch_path),
      effective_patch_path: toPromptPath(
        payload.case_context.case_root,
        payload.case_context.effective_patch_path,
      ),
    },
    task_understanding: payload.task_understanding,
    initial_target_files: payload.initial_target_files ?? [],
    workspace_project_structure: toPromptWorkspaceProjectStructure(
      payload.workspace_project_structure,
    ),
    workspace_project_structure_note: payload.workspace_project_structure_note,
    rubric_items: payload.rubric_summary.dimension_summaries.map((dimension) => ({
      dimension_name: dimension.name,
      dimension_intent: dimension.intent,
      items: dimension.item_summaries.map((item) => ({
        item_name: item.name,
        max_score: item.weight,
        allowed_scores: item.scoring_bands.map((band) => ({
          score: band.score,
          criteria: band.criteria,
        })),
      })),
    })),
    hard_gate_ids: payload.rubric_summary.hard_gates.map((gate) => gate.id),
  };
}

function buildRubricCaseAwareRepairPayload(
  payload: RubricScoringPayload,
): RubricCaseAwareRepairPayload {
  return {
    case_context: {
      case_id: payload.case_context.case_id,
      task_type: payload.case_context.task_type,
      original_prompt_summary: payload.case_context.original_prompt_summary,
      generated_project_root: "workspace",
      has_effective_patch: Boolean(payload.case_context.effective_patch_path),
      effective_patch_path: toPromptPath(
        payload.case_context.case_root,
        payload.case_context.effective_patch_path,
      ),
    },
    task_understanding: payload.task_understanding,
    initial_target_files: payload.initial_target_files ?? [],
    suggested_next_tools: payload.case_context.effective_patch_path
      ? ["read_patch", "list_dir", "read_file", "grep_in_files"]
      : ["list_dir", "read_file", "grep_in_files"],
    workspace_project_structure: toPromptWorkspaceProjectStructure(
      payload.workspace_project_structure,
    ),
    workspace_project_structure_note: payload.workspace_project_structure_note,
  };
}

export function renderRubricCaseAwareBootstrapPrompt(payload: RubricScoringPayload): string {
  const interactionPayload = buildRubricCaseAwareInteractionPayload(payload);
  return [
    "你是评分工作流中的 rubric case-aware 主评分 agent。",
    "你只能输出 tool_call 或 final_answer 两种 JSON action。",
    "一次只能输出一个 JSON object，禁止 markdown、代码块或任何额外解释。",
    "每个 rubric item 默认满分；只有通过工具读取到明确负面证据时才允许扣分。",
    "证据不足时必须保持满分，不得保守扣分。",
    "如果需要扣分，必须先调用 read_patch、read_file、read_files、read_file_chunk 或 grep_in_files 读取代码证据。",
    "扣分项必须提供 deduction_trace，字段包含 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    "improvement_suggestion 必须给出针对当前问题点的最小修复建议，不能写空泛建议。",
    "item_scores 必须覆盖 rubric_summary.dimension_summaries 中的每个 item，且不得遗漏、重复或新增未知 item。",
    "score 与 matched_band_score 必须相等，并且只能使用该 item scoring_bands 中声明过的 score。",
    "满分项不需要编造 deduction_trace；没有足够负面证据就保持满分。",
    "请优先从 initial_target_files 和 effective_patch_path 开始收集证据。",
    "当 changedFiles 很多、initial_target_files 不足以覆盖全部风险时，请结合 workspace_project_structure 先定位目录，再按需读取代表性文件。",
    "工具参数必须严格匹配以下结构：",
    ...SHARED_CASE_TOOL_ARGUMENT_LINES,
    "",
    "最终 final_answer 必须直接包含 summary、item_scores、hard_gate_candidates、risks、strengths、main_issues。",
    "当前评分上下文如下：",
    JSON.stringify(interactionPayload, null, 2),
  ].join("\n");
}

export function renderRubricCaseAwareSystemPrompt(payload: RubricScoringPayload): string {
  const firstDimension = payload.rubric_summary.dimension_summaries[0];
  const firstItem = firstDimension?.item_summaries[0];
  const toolCallExample = {
    action: "tool_call",
    tool: "read_patch",
    args: payload.case_context.effective_patch_path ? {} : { path: "intermediate/effective.patch" },
    reason: "先查看有效补丁以定位评分所需的代码证据。",
  };
  const finalAnswerExample = {
    action: "final_answer",
    summary: {
      overall_assessment: "未发现足够负面证据的评分项按满分保留。",
      overall_confidence: "medium",
    },
    item_scores: [
      {
        dimension_name: firstDimension?.name ?? "维度名称",
        item_name: firstItem?.name ?? "评分项名称",
        score: firstItem?.scoring_bands[0]?.score ?? 0,
        max_score: firstItem?.weight ?? 0,
        matched_band_score: firstItem?.scoring_bands[0]?.score ?? 0,
        rationale: "基于已读取证据与 rubric 档位对比给出中文理由；证据不足时保持满分。",
        evidence_used: [],
        confidence: "medium",
        review_required: false,
      },
    ],
    hard_gate_candidates: [],
    risks: [],
    strengths: [],
    main_issues: [],
  };

  return [
    "你是评分工作流中的 rubric case-aware 主评分 agent。",
    "必须只输出一个 JSON object，不得输出 markdown、代码块或解释性前后缀。",
    "合法 action 只有 tool_call 和 final_answer。",
    "一次只允许输出一个 action，一次只允许调用一个工具。",
    "禁止输出 tools 数组、tool_calls 数组或多个工具调用；如需一次读取多个文件，请使用 read_files。",
    "合法 tool_call 示例，后续所有 tool_call 必须严格遵守该形状，不允许缺失字段或自造字段：",
    JSON.stringify(toolCallExample, null, 2),
    "合法 final_answer 示例，后续所有 final_answer 必须严格遵守该形状，不允许缺失字段或自造字段：",
    JSON.stringify(finalAnswerExample, null, 2),
    "评分原则：每个 rubric item 初始默认满分，找不到足够负面证据就保持满分。",
    "扣分只能基于已读取到的明确代码证据，且必须落到 rubric 已声明的 score band。",
    "final_answer.item_scores 必须覆盖全部 rubric item；上方示例只展示一个 item 的结构，实际输出不得只返回示例项。",
    "扣分项必须额外包含 deduction_trace，并给出 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    ...SHARED_CASE_TOOL_ARGUMENT_LINES,
  ].join("\n");
}

export function renderRubricCaseAwareFollowupPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
}): string {
  const interactionPayload = buildRubricCaseAwareInteractionPayload(input.bootstrapPayload);
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
    JSON.stringify(interactionPayload, null, 2),
  ].join("\n");
}

export function renderRubricCaseAwareSingleActionRetryPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
  failureReason: string;
  rawOutputText: string;
}): string {
  const repairPayload = buildRubricCaseAwareRepairPayload(input.bootstrapPayload);
  const rawOutputPreview =
    input.rawOutputText.length > 2000
      ? `${input.rawOutputText.slice(0, 2000)}...`
      : input.rawOutputText;

  return [
    "这是一次 rubric 顶层 action 协议修复重试。",
    "上一轮输出没有通过 JSON 协议校验。",
    "本轮只能选择 tool_call 或 final_answer 其中一个 action，并且只能输出一个 JSON object。",
    "禁止输出 tools 数组或多个工具调用；如果要补查多个文件，只选择当前最关键的一个工具调用。",
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
    JSON.stringify(repairPayload, null, 2),
  ].join("\n");
}

export function renderRubricCaseAwareFinalAnswerRetryPrompt(input: {
  bootstrapPayload: RubricScoringPayload;
  turn: number;
  latestObservation: string;
  failureReason?: string;
}): string {
  const interactionPayload = buildRubricCaseAwareInteractionPayload(input.bootstrapPayload);
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
    JSON.stringify(interactionPayload, null, 2),
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
  const repairPayload = buildRubricCaseAwareRepairPayload(input.bootstrapPayload);

  return [
    "这是一次 rubric tool_call 协议修复重试。",
    "上一轮准备调用工具，但 tool_call 的 JSON 结构没有通过协议校验。",
    "本轮只能重新输出一个 tool_call JSON object，禁止输出 final_answer，禁止输出 markdown、代码块或解释文字。",
    "禁止输出 tools 数组或批量工具调用，只能输出一个 tool 字段和一个 args 对象。",
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
    "",
    "当前评分上下文如下：",
    JSON.stringify(repairPayload, null, 2),
  ]
    .filter(Boolean)
    .join("\n");
}
