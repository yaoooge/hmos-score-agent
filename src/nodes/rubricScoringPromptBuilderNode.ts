import path from "node:path";
import {
  buildRubricScoringPayload,
  renderRubricScoringPrompt,
} from "../agent/rubricScoring.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

export async function rubricScoringPromptBuilderNode(
  state: ScoreGraphState,
  deps: {
    logger?: { info(message: string): Promise<void> };
  },
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("rubricScoringPromptBuilderNode");
  try {
    const caseRoot = state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath);
    const payload = buildRubricScoringPayload({
      caseInput: state.caseInput,
      caseRoot,
      effectivePatchPath: state.effectivePatchPath,
      taskType: state.taskType,
      constraintSummary: state.constraintSummary,
      rubricSnapshot: state.rubricSnapshot,
    });
    const prompt = renderRubricScoringPrompt(payload);
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
