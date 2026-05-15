import type { DashboardTask, NegativeResults } from "../api/dashboard";

export type NegativeTaskSelectionKey = "failed" | "lowScore";

export type NegativeTaskListSelection = {
  title: string;
  emptyText: string;
  rows: DashboardTask[];
};

export function selectNegativeTaskList(
  negative: NegativeResults | null,
  selected: NegativeTaskSelectionKey,
): NegativeTaskListSelection {
  if (selected === "lowScore") {
    return {
      title: "低分任务列表",
      emptyText: "暂无低分任务",
      rows: negative?.lowScoreTasks ?? [],
    };
  }

  return {
    title: "失败任务列表",
    emptyText: "暂无失败任务",
    rows: negative?.failedTasks ?? [],
  };
}
