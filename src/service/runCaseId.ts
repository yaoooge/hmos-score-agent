import { randomUUID } from "node:crypto";
import { CaseInput, TaskType } from "../types.js";

// 启动前先做一遍轻量 task type 推断，确保运行目录命名与实际工作流一致。
export function inferTaskTypeFromCaseInput(caseInput: Pick<CaseInput, "promptText" | "patchPath">): TaskType {
  const prompt = caseInput.promptText.toLowerCase();
  if (prompt.includes("bug") || prompt.includes("修复")) {
    return "bug_fix";
  }
  if (caseInput.patchPath) {
    return "continuation";
  }
  return "full_generation";
}

type BuildRunCaseIdInput = {
  now?: Date;
  taskType: TaskType;
  uniqueId?: string;
};

// 运行目录命名规则：时间 + task_type + 唯一 id。
export function buildRunCaseId(input: BuildRunCaseIdInput): string {
  const now = input.now ?? new Date();
  const uniqueId = input.uniqueId ?? randomUUID().replace(/-/g, "").slice(0, 8);
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("") +
    "T" +
    [
      String(now.getUTCHours()).padStart(2, "0"),
      String(now.getUTCMinutes()).padStart(2, "0"),
      String(now.getUTCSeconds()).padStart(2, "0"),
    ].join("");

  return `${timestamp}_${input.taskType}_${uniqueId}`;
}
