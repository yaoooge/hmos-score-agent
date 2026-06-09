import path from "node:path";
import { buildRubricSnapshot } from "../../../agents/normalization/ruleAssistance.js";
import { buildOpencodeRubricPayload } from "../../../agents/prompts/rubricPrompt.js";
import { loadRubricForTaskType } from "../../../scoring/rubricLoader.js";
import { loadRiskTaxonomy } from "../../../scoring/riskTaxonomy.js";
import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../../graph/state.js";
import type { ProjectStructureSummary } from "../../../types.js";

function buildWorkspaceProjectStructureContext(state: ScoreGraphState): {
  workspaceProjectStructure?: ProjectStructureSummary;
  workspaceProjectStructureNote?: string;
} {
  const changedFiles = state.evidenceSummary?.changedFiles ?? state.changedFiles ?? [];
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
      implementationHints: workspaceProjectStructure.implementationHints.slice(0, 10),
    },
    workspaceProjectStructureNote: `当前 changedFiles 共 ${changedFileCount} 个。请先优先检查 effective_patch_path，再根据 patch 中出现的文件路径阅读相关 generated/ 或 original/ 上下文；必要时结合 workspace_project_structure 选择代表性目录或文件辅助理解。`,
  };
}

export async function rubricPreparationNode(
  state: ScoreGraphState,
  deps: {
    referenceRoot: string;
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("rubricPreparationNode");
  try {
    const rubric = await loadRubricForTaskType(state.taskType, deps.referenceRoot);
    const riskTaxonomyPath = path.resolve(deps.referenceRoot, "..", "risks", "risk-taxonomy.yaml");
    const riskTaxonomy = loadRiskTaxonomy(riskTaxonomyPath);
    const rubricSnapshot = {
      ...buildRubricSnapshot(rubric),
      risk_taxonomy: riskTaxonomy.entries.map((entry) => ({
        code: entry.code,
        level: entry.level,
        title: entry.title,
        description: entry.description,
      })),
    };
    const caseRoot = state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath);
    const payload = buildOpencodeRubricPayload({
      caseInput: state.caseInput,
      caseRoot,
      effectivePatchPath: state.effectivePatchPath,
      taskType: state.taskType,
      taskUnderstanding: state.taskUnderstanding,
      rubricSnapshot,
      ...buildWorkspaceProjectStructureContext(state),
    });
    await deps.logger?.info(`rubric 加载完成 taskType=${state.taskType}`);

    return {
      rubricSnapshot,
      rubricScoringPayload: payload,
    };
  } catch (error) {
    emitNodeFailed("rubricPreparationNode", error);
    throw error;
  }
}
