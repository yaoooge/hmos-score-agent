import type { DashboardTask, NegativeResults } from "../api/dashboard";

export type NegativeTaskSelectionKey = "failed" | "lowScore";

export type NegativeTaskListSelection = {
  title: string;
  emptyText: string;
  rows: DashboardTask[];
  total: number;
};

export type NegativeTaskPagination = {
  page: number;
  pageSize: number;
};

export function selectNegativeTaskList(
  negative: NegativeResults | null,
  selected: NegativeTaskSelectionKey,
  pagination?: NegativeTaskPagination,
): NegativeTaskListSelection {
  if (selected === "lowScore") {
    const rows = negative?.lowScoreTasks ?? [];
    return {
      title: "低分任务列表",
      emptyText: "暂无低分任务",
      rows: paginateRows(rows, pagination),
      total: rows.length,
    };
  }

  const rows = negative?.failedTasks ?? [];
  return {
    title: "失败任务列表",
    emptyText: "暂无失败任务",
    rows: paginateRows(rows, pagination),
    total: rows.length,
  };
}

export function buildScoringResultUrl(taskId: number): string {
  return `http://47.100.28.161:3000/web/dashboard/scoring-results/${String(taskId)}`;
}

function paginateRows<T>(rows: T[], pagination?: NegativeTaskPagination): T[] {
  if (!pagination) {
    return rows;
  }
  const page = Math.max(1, pagination.page);
  const pageSize = Math.max(1, pagination.pageSize);
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}
