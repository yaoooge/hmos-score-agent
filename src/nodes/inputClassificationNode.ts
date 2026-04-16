import { ScoreGraphState } from "../workflow/state.js";
import { inferTaskTypeFromCaseInput } from "../service/runCaseId.js";

export async function inputClassificationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  return { taskType: inferTaskTypeFromCaseInput(state.caseInput) };
}
