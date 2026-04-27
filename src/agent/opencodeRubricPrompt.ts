import path from "node:path";
import type {
  CaseInput,
  ConstraintSummary,
  LoadedRubricSnapshot,
  ProjectStructureSummary,
  RubricScoringPayload,
  TaskType,
} from "../types.js";

type BuildOpencodeRubricPayloadInput = {
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

type RubricInteractionPayload = {
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
): RubricInteractionPayload["workspace_project_structure"] | undefined {
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

export function buildOpencodeRubricPayload(
  input: BuildOpencodeRubricPayloadInput,
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
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
      required_top_level_fields: [
        "summary",
        "item_scores",
        "hard_gate_candidates",
        "risks",
        "strengths",
        "main_issues",
      ],
    },
  };
}

function buildRubricInteractionPayload(payload: RubricScoringPayload): RubricInteractionPayload {
  return {
    case_context: {
      case_id: payload.case_context.case_id,
      task_type: payload.case_context.task_type,
      original_prompt_summary: payload.case_context.original_prompt_summary,
      generated_project_root: "generated",
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

export function renderOpencodeRubricPrompt(payload: RubricScoringPayload): string {
  const interactionPayload = buildRubricInteractionPayload(payload);
  return [
    "你是评分工作流中的 rubric 主评分 agent。",
    "opencode 将在 sandbox 中读取 generated/original/patch/metadata/references 下的只读文件。",
    "一次只能输出一个 JSON object，禁止 markdown、代码块或任何额外解释。",
    "每个 rubric item 默认满分；只有通过 sandbox 代码证据确认负面问题时才允许扣分。",
    "证据不足时必须保持满分，不得保守扣分。",
    "扣分项必须提供 deduction_trace，字段包含 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    "improvement_suggestion 必须给出针对当前问题点的最小修复建议，不能写空泛建议。",
    "item_scores 必须覆盖 rubric_summary.dimension_summaries 中的每个 item，且不得遗漏、重复或新增未知 item。",
    "score 与 matched_band_score 必须相等，并且只能使用该 item scoring_bands 中声明过的 score。",
    "满分项不需要编造 deduction_trace；没有足够负面证据就保持满分。",
    "请优先从 initial_target_files 和 effective_patch_path 开始收集证据。",
    "当 changedFiles 很多、initial_target_files 不足以覆盖全部风险时，请结合 workspace_project_structure 选择代表性文件阅读。",
    "最终 JSON 必须直接包含 summary、item_scores、hard_gate_candidates、risks、strengths、main_issues。",
    "当前评分上下文如下：",
    JSON.stringify(interactionPayload, null, 2),
  ].join("\n");
}
