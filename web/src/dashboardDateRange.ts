export type DashboardDateRange = [Date, Date];

export function createRecentDashboardRange(days: number, now = new Date()): DashboardDateRange {
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return [start, end];
}

export function refreshDashboardRangeEnd(
  range: DashboardDateRange | null,
  now = new Date(),
): DashboardDateRange | null {
  if (!range) {
    return null;
  }
  return [range[0], new Date(now)];
}
