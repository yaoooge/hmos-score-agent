import path from "node:path";
import {
  buildRubricCaseAwarePayload,
  renderRubricCaseAwareBootstrapPrompt,
} from "../agent/rubricCaseAwarePrompt.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";
import type { ProjectStructureSummary } from "../types.js";

function buildInitialTargetFiles(state: ScoreGraphState): string[] {
  const changedFiles = state.evidenceSummary?.changedFiles ?? [];
  const normalized = changedFiles
    .filter((filePath) => typeof filePath === "string" && filePath.trim().length > 0)
    .map((filePath) =>
      filePath.startsWith("workspace/") ? filePath : path.posix.join("workspace", filePath),
    );

  return Array.from(new Set(normalized)).slice(0, 20);
}

function buildWorkspaceProjectStructureContext(state: ScoreGraphState): {
  workspaceProjectStructure?: ProjectStructureSummary;
  workspaceProjectStructureNote?: string;
} {
  const changedFiles = state.evidenceSummary?.changedFiles ?? [];
  const changedFileCount = changedFiles.length;
  const workspaceProjectStructure = state.workspaceProjectStructure;

  if (!workspaceProjectStructure || changedFileCount <= 20) {
    return {};
  }

  return {
    workspaceProjectStructure: {
      ...workspaceProjectStructure,
      topLevelEntries: workspaceProjectStructure.topLevelEntries.slice(0, 20),
      modulePaths: workspaceProjectStructure.modulePaths.slice(0, 20),
      representativeFiles: workspaceProjectStructure.representativeFiles.slice(0, 30),
      implementationHints: workspaceProjectStructure.implementationHints.slice(0, 10),
    },
    workspaceProjectStructureNote: `当前 changedFiles 共 ${changedFileCount} 个，已超过 initial_target_files 上限 20。请先优先检查 effective_patch_path 和 initial_target_files，再结合 workspace_project_structure 选择代表性目录或文件继续取证。`,
  };
}

export async function rubricScoringPromptBuilderNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("rubricScoringPromptBuilderNode");
  try {
    const caseRoot = state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath);
    const payload = buildRubricCaseAwarePayload({
      caseInput: state.caseInput,
      caseRoot,
      effectivePatchPath: state.effectivePatchPath,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
      initialTargetFiles: buildInitialTargetFiles(state),
      ...buildWorkspaceProjectStructureContext(state),
    });
    const prompt = renderRubricCaseAwareBootstrapPrompt(payload);
    await deps.logger?.info(
      `rubric scoring prompt 组装完成 dimensions=${payload.rubric_summary.dimension_summaries.length} promptLength=${prompt.length}`,
    );

    return {
      rubricScoringPayload: payload,
      rubricScoringPromptText: prompt,
    };
  } catch (error) {
    emitNodeFailed("rubricScoringPromptBuilderNode", error);
    throw error;
  }
}
