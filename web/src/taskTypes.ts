import type { DashboardTask, TaskTypeCount } from "./api/dashboard";

const managementConsoleTaskTypeMap: Record<string, string> = {
  new_development: "full_generation",
  incremental: "continuation",
  bugfix: "bug_fix",
};

export function normalizeDashboardTaskType(taskType: string): string {
  return managementConsoleTaskTypeMap[taskType] ?? taskType;
}

export function summarizeTaskTypeCounts(counts: TaskTypeCount[]): TaskTypeCount[] {
  const merged = new Map<string, number>();
  for (const item of counts) {
    const taskType = normalizeDashboardTaskType(item.taskType);
    merged.set(taskType, (merged.get(taskType) ?? 0) + item.count);
  }
  return Array.from(merged, ([taskType, count]) => ({ taskType, count })).sort((left, right) =>
    left.taskType.localeCompare(right.taskType),
  );
}

export function buildTaskTypeOptions(counts: TaskTypeCount[]): string[] {
  return summarizeTaskTypeCounts(counts).map((item) => item.taskType);
}

export function normalizeDashboardTask(task: DashboardTask): DashboardTask {
  return {
    ...task,
    taskType: normalizeDashboardTaskType(task.taskType),
  };
}
