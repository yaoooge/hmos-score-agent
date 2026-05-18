type DashboardDataLoaderInput<Summary, Tasks> = {
  includeSummary: boolean;
  fetchSummary: () => Promise<Summary>;
  fetchTasks: () => Promise<Tasks>;
};

export async function loadTaskDashboardData<Summary, Tasks>({
  includeSummary,
  fetchSummary,
  fetchTasks,
}: DashboardDataLoaderInput<Summary, Tasks>): Promise<{
  summary: Summary | undefined;
  tasks: Tasks;
}> {
  if (!includeSummary) {
    return {
      summary: undefined,
      tasks: await fetchTasks(),
    };
  }

  const [summary, tasks] = await Promise.all([fetchSummary(), fetchTasks()]);
  return { summary, tasks };
}
