import { emitNodeFailed, emitNodeStarted } from "../workflow/observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../workflow/state.js";
import { inferTaskTypeFromCaseInput } from "../service/runCaseId.js";

export async function inputClassificationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("inputClassificationNode");
  try {
    return { taskType: inferTaskTypeFromCaseInput(state.caseInput) };
  } catch (error) {
    emitNodeFailed("inputClassificationNode", error);
    throw error;
  }
}
