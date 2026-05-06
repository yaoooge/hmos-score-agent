import path from "node:path";
import { buildOpencodeRubricPayload } from "../agent/opencodeRubricPrompt.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";
import type { ProjectStructureSummary } from "../types.js";

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
    workspaceProjectStructureNote: `当前 changedFiles 共 ${changedFileCount} 个。请先优先检查 effective_patch_path，再根据 patch 中出现的文件路径阅读相关 generated/ 或 original/ 上下文；必要时结合 workspace_project_structure 选择代表性目录或文件辅助理解。`,
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
    const payload = buildOpencodeRubricPayload({
      caseInput: state.caseInput,
      caseRoot,
      effectivePatchPath: state.effectivePatchPath,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
      ...buildWorkspaceProjectStructureContext(state),
    });
    await deps.logger?.info(
      `rubric scoring payload 组装完成 dimensions=${payload.rubric_summary.dimension_summaries.length}`,
    );

    return {
      rubricScoringPayload: payload,
    };
  } catch (error) {
    emitNodeFailed("rubricScoringPromptBuilderNode", error);
    throw error;
  }
}
