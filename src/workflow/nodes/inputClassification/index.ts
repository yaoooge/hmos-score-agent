import { emitNodeFailed, emitNodeStarted } from "../../observability/nodeCustomEvents.js";
import { ScoreGraphState } from "../../graph/state.js";
import { inferTaskTypeFromCaseInput } from "../../../service/runCaseId.js";

export async function inputClassificationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  emitNodeStarted("inputClassificationNode");
  try {
    if (state.taskType) {
      return { taskType: state.taskType };
    }
    return { taskType: inferTaskTypeFromCaseInput(state.caseInput) };
  } catch (error) {
    emitNodeFailed("inputClassificationNode", error);
    throw error;
  }
}
