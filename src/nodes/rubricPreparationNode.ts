import path from "node:path";
import { buildRubricSnapshot } from "../agent/ruleAssistance.js";
import { loadRubricForTaskType } from "../scoring/rubricLoader.js";
import { loadRiskTaxonomy } from "../scoring/riskTaxonomy.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

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
    await deps.logger?.info(`rubric 加载完成 taskType=${state.taskType}`);

    return {
      rubricSnapshot: {
        ...buildRubricSnapshot(rubric),
        risk_taxonomy: riskTaxonomy.entries.map((entry) => ({
          code: entry.code,
          level: entry.level,
          title: entry.title,
          description: entry.description,
        })),
      },
    };
  } catch (error) {
    emitNodeFailed("rubricPreparationNode", error);
    throw error;
  }
}
