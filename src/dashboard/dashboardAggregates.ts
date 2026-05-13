import type { RuleViolationRunSnapshot } from "../api/ruleViolationStatsStore.js";
import type {
  DashboardStatusCategory,
  DashboardTaskSummary,
  HumanRatingGapDashboardItem,
} from "./dashboardTypes.js";

type TaskQuery = {
  status?: DashboardStatusCategory;
  taskType?: string;
  keyword?: string;
  scoreMin?: number;
  scoreMax?: number;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
  sortBy: "createdAt" | "updatedAt" | "score" | "taskId";
  sortOrder: "asc" | "desc";
};

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number,
): { items: T[]; total: number } {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
  };
}

export function buildStatusCounts(tasks: DashboardTaskSummary[]) {
  const counts: Record<DashboardStatusCategory, number> = {
    received: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const task of tasks) {
    counts[task.statusCategory] += 1;
  }
  return counts;
}

export function buildTaskTypeCounts(tasks: DashboardTaskSummary[]) {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    counts.set(task.taskType, (counts.get(task.taskType) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskType, count]) => ({ taskType, count }));
}

export function buildScoreSummary(tasks: DashboardTaskSummary[]) {
  const scores = tasks
    .filter((task) => task.statusCategory === "completed")
    .map((task) => task.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  if (scores.length === 0) {
    return { completedWithScore: 0, averageScore: null, minScore: null, maxScore: null };
  }
  return {
    completedWithScore: scores.length,
    averageScore: Number(
      (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2),
    ),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
  };
}

function matchesDateRange(task: DashboardTaskSummary, from?: string, to?: string): boolean {
  const createdAt = Date.parse(task.createdAt);
  if (from !== undefined && createdAt < Date.parse(from)) {
    return false;
  }
  if (to !== undefined && createdAt > Date.parse(to)) {
    return false;
  }
  return true;
}

export function filterTasks(
  tasks: DashboardTaskSummary[],
  query: TaskQuery,
): DashboardTaskSummary[] {
  const keyword = query.keyword?.trim().toLowerCase();
  return tasks
    .filter((task) => (query.status ? task.statusCategory === query.status : true))
    .filter((task) => (query.taskType ? task.taskType === query.taskType : true))
    .filter((task) => matchesDateRange(task, query.from, query.to))
    .filter((task) =>
      query.scoreMin !== undefined && task.score !== null
        ? task.score >= query.scoreMin
        : query.scoreMin === undefined,
    )
    .filter((task) =>
      query.scoreMax !== undefined && task.score !== null
        ? task.score <= query.scoreMax
        : query.scoreMax === undefined,
    )
    .filter((task) => {
      if (!keyword) {
        return true;
      }
      return [String(task.taskId), String(task.testCaseId ?? ""), task.name]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    })
    .sort((left, right) => {
      const direction = query.sortOrder === "asc" ? 1 : -1;
      const leftValue = query.sortBy === "score" ? (left.score ?? -Infinity) : left[query.sortBy];
      const rightValue =
        query.sortBy === "score" ? (right.score ?? -Infinity) : right[query.sortBy];
      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }
      return String(leftValue).localeCompare(String(rightValue)) * direction;
    });
}

export function buildDailyReport(tasks: DashboardTaskSummary[]) {
  const byDate = new Map<
    string,
    {
      date: string;
      received: number;
      completed: number;
      failed: number;
      queued: number;
      running: number;
      scores: number[];
    }
  >();
  for (const task of tasks) {
    const date = task.createdAt.slice(0, 10);
    const item = byDate.get(date) ?? {
      date,
      received: 0,
      completed: 0,
      failed: 0,
      queued: 0,
      running: 0,
      scores: [],
    };
    item.received += 1;
    if (task.statusCategory === "completed") {
      item.completed += 1;
      if (typeof task.score === "number") {
        item.scores.push(task.score);
      }
    }
    if (task.statusCategory === "failed") {
      item.failed += 1;
    }
    if (task.statusCategory === "queued") {
      item.queued += 1;
    }
    if (task.statusCategory === "running") {
      item.running += 1;
    }
    byDate.set(date, item);
  }
  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ scores, ...item }) => ({
      ...item,
      averageScore:
        scores.length === 0
          ? null
          : Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)),
    }));
}

export function buildScoreDistribution(tasks: DashboardTaskSummary[]) {
  const buckets = [
    { label: "0-59", min: 0, max: 59, count: 0 },
    { label: "60-69", min: 60, max: 69, count: 0 },
    { label: "70-79", min: 70, max: 79, count: 0 },
    { label: "80-89", min: 80, max: 89, count: 0 },
    { label: "90-100", min: 90, max: 100, count: 0 },
  ];
  for (const task of tasks) {
    const score = task.score;
    if (typeof score !== "number") {
      continue;
    }
    const bucket = buckets.find((item) => score >= item.min && score <= item.max);
    if (bucket) {
      bucket.count += 1;
    }
  }
  return buckets;
}

export function filterHumanRatingGaps(
  gaps: HumanRatingGapDashboardItem[],
  query: { from?: string; to?: string; manualRating?: string; primaryConclusion?: string },
) {
  return gaps.filter((gap) => {
    if (query.manualRating && gap.manualRating !== query.manualRating) {
      return false;
    }
    if (query.primaryConclusion && gap.primaryConclusion !== query.primaryConclusion) {
      return false;
    }
    if (query.from && (!gap.reviewedAt || Date.parse(gap.reviewedAt) < Date.parse(query.from))) {
      return false;
    }
    if (query.to && (!gap.reviewedAt || Date.parse(gap.reviewedAt) > Date.parse(query.to))) {
      return false;
    }
    return true;
  });
}

export function buildNegativeResults(
  tasks: DashboardTaskSummary[],
  ruleRuns: RuleViolationRunSnapshot[],
  scoreThreshold: number,
) {
  const failedTasks = tasks.filter((task) => task.statusCategory === "failed");
  const lowScoreTasks = tasks.filter(
    (task) => typeof task.score === "number" && task.score < scoreThreshold,
  );
  const hardGateTasks = tasks.filter((task) => task.hardGateTriggered === true);
  const highRiskTasks = tasks.filter((task) => task.risks.some((risk) => risk.level === "high"));
  const riskCounts = new Map<string, number>();
  for (const task of tasks) {
    for (const risk of task.risks) {
      if (risk.level) {
        riskCounts.set(risk.level, (riskCounts.get(risk.level) ?? 0) + 1);
      }
    }
  }

  const ruleStats = new Map<
    string,
    {
      pack_id: string;
      rule_id: string;
      rule_summary: string;
      violationCount: number;
      affectedTaskIds: Set<number>;
    }
  >();
  for (const run of ruleRuns) {
    for (const rule of run.rules) {
      if (rule.result !== "不满足") {
        continue;
      }
      const key = `${rule.pack_id}:${rule.rule_id}`;
      const existing = ruleStats.get(key) ?? {
        pack_id: rule.pack_id,
        rule_id: rule.rule_id,
        rule_summary: rule.rule_summary,
        violationCount: 0,
        affectedTaskIds: new Set<number>(),
      };
      existing.violationCount += 1;
      existing.affectedTaskIds.add(run.taskId);
      ruleStats.set(key, existing);
    }
  }

  const topRuleViolations = Array.from(ruleStats.values())
    .map((rule) => ({
      pack_id: rule.pack_id,
      rule_id: rule.rule_id,
      rule_summary: rule.rule_summary,
      violationCount: rule.violationCount,
      affectedTaskIds: Array.from(rule.affectedTaskIds).sort((left, right) => left - right),
    }))
    .sort((left, right) => right.violationCount - left.violationCount);

  return {
    summary: {
      failedTaskCount: failedTasks.length,
      lowScoreTaskCount: lowScoreTasks.length,
      hardGateTaskCount: hardGateTasks.length,
      highRiskTaskCount: highRiskTasks.length,
      violatedRuleCount: topRuleViolations.length,
    },
    failedTasks,
    lowScoreTasks,
    hardGateTasks,
    riskLevelCounts: Array.from(riskCounts.entries()).map(([level, count]) => ({ level, count })),
    topRuleViolations,
  };
}
