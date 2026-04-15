import { ScoreGraphState } from "../workflow/state.js";
import { TaskType } from "../types.js";

export async function inputClassificationNode(
  state: ScoreGraphState,
): Promise<Partial<ScoreGraphState>> {
  const prompt = state.caseInput.promptText.toLowerCase();
  let taskType: TaskType = "full_generation";
  if (prompt.includes("bug") || prompt.includes("修复")) {
    taskType = "bug_fix";
  } else if (state.caseInput.patchPath) {
    taskType = "continuation";
  }
  return { taskType };
}
