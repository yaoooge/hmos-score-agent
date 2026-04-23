import path from "node:path";
import {
  buildRubricCaseAwarePayload,
  renderRubricCaseAwareBootstrapPrompt,
} from "../agent/rubricCaseAwarePrompt.js";
import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";

function buildInitialTargetFiles(state: ScoreGraphState): string[] {
  const changedFiles = state.evidenceSummary?.changedFiles ?? [];
  const normalized = changedFiles
    .filter((filePath) => typeof filePath === "string" && filePath.trim().length > 0)
    .map((filePath) =>
      filePath.startsWith("workspace/") ? filePath : path.posix.join("workspace", filePath),
    );

  return Array.from(new Set(normalized)).slice(0, 20);
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
