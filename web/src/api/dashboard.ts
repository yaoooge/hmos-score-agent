export type StatusCounts = {
  received: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
};

export type TaskTypeCount = {
  taskType: string;
  count: number;
};

export type DashboardTask = {
  taskId: number;
  testCaseId?: number;
  name: string;
  status: string;
  statusCategory: keyof StatusCounts;
  taskType: string;
  score: number | null;
  hardGateTriggered: boolean | null;
  createdAt: string;
  updatedAt: string;
  resultAvailable: boolean;
  error?: string;
};

export type DashboardSummary = {
  success: true;
  generatedAt: string;
  statusCounts: StatusCounts;
  taskTypeCounts: TaskTypeCount[];
  scoreSummary: {
    completedWithScore: number;
    averageScore: number | null;
    minScore: number | null;
    maxScore: number | null;
  };
};

export type TaskListResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  items: DashboardTask[];
};

export type TaskLogResponse = {
  success: true;
  taskId: number;
  status: string;
  logPath: string;
  available: boolean;
  truncated: boolean;
  tailBytes: number;
  content: string;
};

export type TaskResultResponse = {
  success: true;
  taskId: number;
  status: string;
  resultData: unknown;
};

export type AgentTraceEvent = {
  id: string;
  sequence: number;
  attemptId?: string;
  retryIndex?: number;
  type: string;
  title: string;
  status?: string;
  timestampMs?: number;
  elapsedMs?: number;
  toolName?: string;
  summary?: string;
  hasRawPayload?: boolean;
};

export type AgentTraceAttempt = {
  id: string;
  sequence: number;
  retryIndex: number;
  requestTag: string;
  status: string;
  elapsedMs: number;
  totalTokens?: number;
  warningCount?: number;
  warnings?: string[];
};

export type AgentTraceRun = {
  id: string;
  baseRequestTag: string;
  agentName: string;
  status: string;
  elapsedMs: number;
  tokenUsage?: { total?: number };
  attempts: AgentTraceAttempt[];
  events: AgentTraceEvent[];
  opencodeSession?: { id?: string };
  rawAvailable?: boolean;
  warnings?: string[];
};

export type AgentTraceResponse = {
  success: true;
  taskId: number;
  traceAvailable: boolean;
  source: "artifact" | "sqlite" | "mixed";
  rawAvailable?: boolean;
  report?: {
    summary: {
      runCount: number;
      attemptCount: number;
      eventCount: number;
      toolEventCount: number;
      errorCount: number;
      totalElapsedMs: number;
      totalTokens?: number;
    };
    runs: AgentTraceRun[];
    warnings?: string[];
  };
  message?: string;
};

export type AgentTraceRunRawResponse = {
  success: true;
  taskId: number;
  traceRunId: string;
  prompt?: string;
  assistantText?: string;
  outputFileText?: string;
  opencodeMessages?: unknown[];
};

export type AgentTraceEventRawResponse = {
  success: true;
  taskId: number;
  traceEventId: string;
  rawPayload?: unknown;
};

export type DailyReportItem = {
  date: string;
  received: number;
  completed: number;
  failed: number;
  queued: number;
  running: number;
  averageScore: number | null;
};

export type ScoreBucket = {
  label: string;
  min: number;
  max: number;
  count: number;
};

export type ManualAnalysisStatus = "pending" | "analyzed";

export type HumanRatingGap = {
  taskId: number;
  testCaseId?: number;
  caseName?: string;
  reviewedAt?: string;
  reviewer?: string;
  manualRating?: string;
  autoScore?: number;
  autoRating?: string;
  primaryConclusion?: string;
  confidence?: string;
  reasonSummary?: string;
  recommendedActions?: string[];
  manualAnalysisStatus?: ManualAnalysisStatus;
  manualAnalyzedAt?: string;
};

export type RiskReviewCalibration = {
  taskId: number;
  testCaseId?: number;
  riskId?: number;
  riskIndex?: number;
  evidenceId?: string;
  taskSummary?: string;
  caseName?: string;
  resultRisk?: {
    id?: number;
    level?: string;
    title?: string;
    description?: string;
    evidence?: string;
  };
  humanReview?: {
    agree?: boolean;
    agreeWithResultLevel?: boolean;
    correctedLevel?: string;
    reason?: string;
    comment?: string;
  };
  manualAnalysisStatus?: ManualAnalysisStatus;
  manualAnalyzedAt?: string;
};

export type CrossDeviceCase = {
  taskId: number;
  testCaseId?: number;
  name: string;
  status: string;
  statusCategory: keyof StatusCounts;
  taskType: string;
  score: number | null;
  hardGateTriggered: boolean | null;
  createdAt: string;
  updatedAt: string;
  resultAvailable: boolean;
  reasons: string[];
  officialLinterRunStatus?: string;
  crossDeviceRuleSetApplied: boolean;
  crossDeviceFindingCount: number;
  riskCount: number;
  boundRulePacks: Array<{
    packId: string;
    displayName: string;
  }>;
  crossDeviceRuleAuditCounts: {
    violated: number;
    review: number;
    satisfied: number;
    notInvolved: number;
    total: number;
  };
  crossDeviceRuleAuditResults: Array<{
    packId?: string;
    packDisplayName?: string;
    ruleId: string;
    ruleSummary?: string;
    ruleSource?: string;
    result?: string;
    conclusion?: string;
  }>;
  crossDeviceOfficialLinterResults: Array<{
    ruleId: string;
    ruleResultId?: string;
    sourceRuleSet?: string;
    severity?: string;
    findingCount: number;
    conclusion?: string;
  }>;
  topRuleViolations: Array<{
    ruleId: string;
    sourceRuleSet: string;
    findingCount: number;
  }>;
  riskLevelCounts: Array<{ level: string; count: number }>;
};

export type CrossDeviceCaseListResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  items: CrossDeviceCase[];
};

export type CrossDeviceRuleViolation = {
  ruleId: string;
  ruleSummary?: string;
  sourceRuleSet?: string;
  severity?: string;
  violationCount: number;
  affectedTaskCount: number;
  affectedTaskIds: number[];
  lastViolatedAt: string;
};

export type CrossDeviceRuleViolationsResponse = {
  success: true;
  page: number;
  pageSize: number;
  total: number;
  summary: {
    relatedCaseCount: number;
    violatedRuleCount: number;
    totalViolationEvents: number;
  };
  items: CrossDeviceRuleViolation[];
};

export type NegativeResults = {
  success: true;
  summary: {
    failedTaskCount: number;
    lowScoreTaskCount: number;
    hardGateTaskCount: number;
    highRiskTaskCount: number;
    violatedRuleCount: number;
  };
  failedTasks: DashboardTask[];
  lowScoreTasks: DashboardTask[];
  hardGateTasks: DashboardTask[];
  riskLevelCounts: Array<{ level: string; count: number }>;
  topRuleViolations: Array<{
    pack_id: string;
    rule_id: string;
    rule_summary: string;
    violationCount: number;
    affectedTaskIds: number[];
  }>;
};

async function getJson<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

export function fetchSummary(params?: Record<string, string | number | undefined>) {
  return getJson<DashboardSummary>("/dashboard/summary", params);
}

export function fetchTasks(params: Record<string, string | number | undefined>) {
  return getJson<TaskListResponse>("/dashboard/tasks", params);
}

export function fetchTaskLog(taskId: number, tailBytes = 65536) {
  return getJson<TaskLogResponse>(`/dashboard/tasks/${String(taskId)}/logs`, { tailBytes });
}

export function fetchTaskResult(taskId: number) {
  return getJson<TaskResultResponse>(`/score/remote-tasks/${String(taskId)}/result`);
}

export function fetchTaskAgentTrace(taskId: number) {
  return getJson<AgentTraceResponse>(`/dashboard/tasks/${String(taskId)}/agent-trace`);
}

export function fetchTaskAgentTraceRunRaw(taskId: number, traceRunId: string) {
  return getJson<AgentTraceRunRawResponse>(
    `/dashboard/tasks/${String(taskId)}/agent-trace/runs/${encodeURIComponent(traceRunId)}/raw`,
  );
}

export function fetchTaskAgentTraceEventRaw(taskId: number, traceEventId: string) {
  return getJson<AgentTraceEventRawResponse>(
    `/dashboard/tasks/${String(taskId)}/agent-trace/events/${encodeURIComponent(traceEventId)}/raw`,
  );
}

export function fetchTaskRawResult(taskId: number) {
  return fetch(`/score/remote-tasks/${String(taskId)}/result/raw`);
}

export function deleteDashboardTask(taskId: number) {
  const params = new URLSearchParams({ taskIds: String(taskId) });
  return deleteJson<{ success: true; deletedTaskIds: number[] }>(
    `/score/remote-tasks?${params.toString()}`,
  );
}

export function fetchDailyReport(params?: Record<string, string | number | undefined>) {
  return getJson<{ success: true; items: DailyReportItem[] }>("/dashboard/reports/daily", params);
}

export function fetchScoreDistribution(params?: Record<string, string | number | undefined>) {
  return getJson<{ success: true; buckets: ScoreBucket[] }>(
    "/dashboard/reports/score-distribution",
    params,
  );
}

export function fetchHumanRatingGaps(params?: Record<string, string | number | undefined>) {
  return getJson<{
    success: true;
    page: number;
    pageSize: number;
    total: number;
    skippedRows: number;
    items: HumanRatingGap[];
  }>("/dashboard/analysis/human-rating-gaps", params);
}

export function updateHumanRatingGapManualAnalysisStatus(
  taskIds: number[],
  status: ManualAnalysisStatus,
) {
  return postJson<{
    success: true;
    updated: number;
    missing: Array<{ taskId: number }>;
  }>("/dashboard/analysis/human-rating-gaps/manual-analysis-status", { taskIds, status });
}

export function fetchRiskReviewCalibrations(
  params?: Record<string, string | number | undefined>,
) {
  return getJson<{
    success: true;
    page: number;
    pageSize: number;
    total: number;
    skippedRows: number;
    items: RiskReviewCalibration[];
  }>("/dashboard/analysis/risk-review-calibrations", params);
}

export function updateRiskReviewManualAnalysisStatus(
  items: Array<{ taskId: number; riskId: number }>,
  status: ManualAnalysisStatus,
) {
  return postJson<{
    success: true;
    updated: number;
    missing: Array<{ taskId: number; riskId: number }>;
    skipped: Array<{ taskId: number; riskId: number; reason: string }>;
  }>("/dashboard/analysis/risk-review-calibrations/manual-analysis-status", { items, status });
}

export function fetchNegativeResults(params?: Record<string, string | number | undefined>) {
  return getJson<NegativeResults>("/dashboard/analysis/negative-results", params);
}

export function fetchCrossDeviceCases(params?: Record<string, string | number | undefined>) {
  return getJson<CrossDeviceCaseListResponse>("/dashboard/cross-device/cases", params);
}

export function fetchCrossDeviceRuleViolations(
  params?: Record<string, string | number | undefined>,
) {
  return getJson<CrossDeviceRuleViolationsResponse>(
    "/dashboard/cross-device/rule-violations",
    params,
  );
}

export function fetchCrossDeviceRiskReviewCalibrations(
  params?: Record<string, string | number | undefined>,
) {
  return getJson<{
    success: true;
    page: number;
    pageSize: number;
    total: number;
    skippedRows: number;
    items: RiskReviewCalibration[];
  }>("/dashboard/cross-device/risk-review-calibrations", params);
}
