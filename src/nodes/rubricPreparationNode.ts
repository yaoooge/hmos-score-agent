import { buildRubricSnapshot } from "../agent/ruleAssistance.js";
import { loadRubricForTaskType } from "../scoring/rubricLoader.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function rubricPreparationNode(
  state: ScoreGraphState,
  deps: {
    referenceRoot: string;
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  const rubric = await loadRubricForTaskType(state.taskType, deps.referenceRoot);
  await deps.logger?.info(`rubric 加载完成 taskType=${state.taskType}`);

  return {
    rubricSnapshot: buildRubricSnapshot(rubric),
  };
}
