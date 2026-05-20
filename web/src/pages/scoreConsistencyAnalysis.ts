export type RemoteEvaluationTaskInput = {
  taskId: number;
  testCase: {
    id: number;
    name: string;
    type: string;
    description: string;
    input: string;
    expectedOutput: string;
    fileUrl: string;
  };
  executionResult: {
    isBuildSuccess: boolean;
    outputCodeUrl: string;
    diffFileUrl?: string;
  };
  callback: string;
};

export type RemoteTaskValidationResult =
  | {
      valid: true;
      task: RemoteEvaluationTaskInput;
      errors: [];
    }
  | {
      valid: false;
      task?: undefined;
      errors: string[];
    };

export type ConsistencyRunStatus =
  | "pending_submit"
  | "submitted"
  | "preparing"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "missing";

const consistencyRunStatuses = new Set<string>([
  "pending_submit",
  "submitted",
  "preparing",
  "queued",
  "running",
  "completed",
  "failed",
  "timed_out",
  "missing",
]);

export function normalizeConsistencyRunStatus(status: unknown): ConsistencyRunStatus {
  return typeof status === "string" && consistencyRunStatuses.has(status)
    ? (status as ConsistencyRunStatus)
    : "pending_submit";
}

export type ConsistencyRuleSummary = {
  ruleId: string;
  summary: string;
  conclusion?: string;
};

export type ConsistencyRiskSummary = {
  key: string;
  id?: number;
  level?: string;
  title?: string;
  description?: string;
  evidence?: string;
};

export type ConsistencyRunSummary = {
  runIndex: number;
  taskId: number;
  status: ConsistencyRunStatus;
  totalScore?: number;
  hardGateTriggered?: boolean;
  summary?: string;
  ruleUnsatisfactionRatio?: number;
  unsatisfiedRules: ConsistencyRuleSummary[];
  risks: ConsistencyRiskSummary[];
  error?: string;
};

export type ConsistencyAnalysisSummary = {
  completedRuns: number;
  failedRuns: number;
  consistentCompletedRuns: number;
  consistencyPercentage: number | null;
  averageScore: number | null;
  medianScore: number | null;
  minScore: number | null;
  maxScore: number | null;
  scoreStandardDeviation: number | null;
  averageRuleUnsatisfactionRatio: number | null;
  averageRiskCount: number | null;
  conclusion: string;
  runConsistencyByTaskId: Record<number, boolean>;
};

export type RuleConsistencyReportItem = {
  ruleId: string;
  summary: string;
  unsatisfiedCount: number;
  unsatisfiedRate: number;
  conclusionSample?: string;
  runIndexes: number[];
  stability: "稳定不满足" | "稳定满足或不涉及" | "判定波动";
};

export type RiskConsistencyReportItem = {
  key: string;
  level?: string;
  title?: string;
  appearanceCount: number;
  appearanceRate: number;
  runIndexes: number[];
  evidenceSample?: string;
  stability: "稳定出现" | "偶发出现" | "未出现";
};

export type ConsistencyAnalysisHistoryItem = {
  round: number;
  capturedAt: string;
  summary: ConsistencyAnalysisSummary;
  ruleReport: RuleConsistencyReportItem[];
  riskReport: RiskConsistencyReportItem[];
  runs: ConsistencyRunSummary[];
};

export type ConsistencyExportTask = ConsistencyTaskSnapshot & {
  analysis: ConsistencyAnalysisSummary;
  ruleReport: RuleConsistencyReportItem[];
  riskReport: RiskConsistencyReportItem[];
  analysisHistory: ConsistencyAnalysisHistoryItem[];
};

export type ConsistencyExportPayload = {
  task: {
    id: string;
    originalTaskId: number;
    caseId: number;
    caseName: string;
    createdAt: string;
    status: string;
    serviceBaseUrl: string;
  };
  analysis: {
    summary: ConsistencyAnalysisSummary;
    ruleReport: RuleConsistencyReportItem[];
    riskReport: RiskConsistencyReportItem[];
  };
  analysisHistory: ConsistencyAnalysisHistoryItem[];
  runs: Array<{
    runIndex: number;
    taskId: number;
    status: ConsistencyRunStatus;
    summary: ConsistencyRunSummary;
    resultData?: unknown;
    error?: string;
  }>;
};

export type ConsistencyExportOverview = {
  task: ConsistencyExportPayload["task"];
  analysis: ConsistencyExportPayload["analysis"];
  analysisHistory: Array<{
    round: number;
    capturedAt: string;
    summary: ConsistencyAnalysisSummary;
    ruleReportPath: string;
    riskReportPath: string;
    runsPath: string;
  }>;
  runs: Array<{
    runIndex: number;
    taskId: number;
    status: ConsistencyRunStatus;
    summaryPath: string;
    resultPath: string;
    error?: string;
  }>;
};

export type ConsistencyHistoryChartRow = {
  label: string;
  capturedAt: string;
  completedRuns: number;
  failedRuns: number;
  consistencyPercentage: number | null;
  averageScore: number | null;
  scoreStandardDeviation: number | null;
  ruleUnsatisfactionPercentage: number | null;
  averageRiskCount: number | null;
};

type RunSignature = {
  taskId: number;
  scoreBand: number;
  hardGateTriggered: boolean;
  unsatisfiedRuleKeys: string[];
  riskKeys: string[];
};

export type ConsistencyTaskCollectionRecord = {
  id: string;
  sequence: number;
  serviceBaseUrl: string;
  originalTaskId: number;
  caseId: number;
  caseName: string;
  createdAt: string;
  status: string;
  sourceTask?: RemoteEvaluationTaskInput;
  runs: ConsistencyRunSummary[];
  analysisHistory?: ConsistencyAnalysisHistoryItem[];
};

export type ConsistencyTaskSnapshot = ConsistencyTaskCollectionRecord & {
  analysis?: ConsistencyAnalysisSummary;
  ruleReport?: RuleConsistencyReportItem[];
  riskReport?: RiskConsistencyReportItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 100);
}

function roundNumber(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function mode<T extends string | number | boolean>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let selected: T | undefined;
  let selectedCount = -1;
  for (const [value, count] of counts) {
    if (count > selectedCount) {
      selected = value;
      selectedCount = count;
    }
  }
  return selected;
}

function createFallbackSourceTask(record: ConsistencyTaskCollectionRecord): RemoteEvaluationTaskInput {
  return {
    taskId: record.originalTaskId,
    testCase: {
      id: record.caseId,
      name: record.caseName,
      type: "",
      description: "",
      input: "",
      expectedOutput: "",
      fileUrl: "",
    },
    executionResult: { isBuildSuccess: true, outputCodeUrl: "" },
    callback: "",
  };
}

function normalizeRunSnapshot(run: ConsistencyRunSummary): ConsistencyRunSummary {
  return {
    ...run,
    status: normalizeConsistencyRunStatus(run.status),
  };
}

function isTerminalRunStatus(status: ConsistencyRunStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "timed_out" ||
    status === "missing"
  );
}

function cloneRunSummary(run: ConsistencyRunSummary): ConsistencyRunSummary {
  return {
    ...run,
    unsatisfiedRules: run.unsatisfiedRules.map((rule) => ({ ...rule })),
    risks: run.risks.map((risk) => ({ ...risk })),
  };
}

function runSetKey(runs: ConsistencyRunSummary[]): string {
  return runs
    .map((run) =>
      [
        run.runIndex,
        run.taskId,
        run.status,
        run.totalScore ?? "",
        run.hardGateTriggered ?? "",
        run.ruleUnsatisfactionRatio ?? "",
        run.unsatisfiedRules.map((rule) => `${rule.ruleId}:${rule.summary}`).join(","),
        run.risks.map((risk) => risk.key).join(","),
      ].join(":"),
    )
    .join("|");
}

function errorMessage(value: unknown): string | undefined {
  return value instanceof Error ? value.message : undefined;
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function padNumber(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function isConsistencyTaskTerminal(runs: ConsistencyRunSummary[]): boolean {
  return runs.length > 0 && runs.every((run) => isTerminalRunStatus(run.status));
}

export function compactConsistencyTaskSnapshots(
  snapshots: ConsistencyTaskSnapshot[],
): ConsistencyTaskCollectionRecord[] {
  return snapshots.map((snapshot) => {
    const { analysis: _analysis, ruleReport: _ruleReport, riskReport: _riskReport, ...record } =
      snapshot;
    return {
      ...record,
      runs: record.runs.map(normalizeRunSnapshot),
      sourceTask: record.sourceTask,
    };
  });
}

export function buildConsistencyTaskPersistRecord(
  snapshot: ConsistencyTaskSnapshot,
  includeSourceTask = false,
): ConsistencyTaskCollectionRecord {
  const compacted = compactConsistencyTaskSnapshots([snapshot])[0];
  if (!compacted) {
    throw new Error("一致性任务记录不能为空");
  }
  if (includeSourceTask || compacted.sourceTask === undefined) {
    return compacted;
  }
  const { sourceTask: _sourceTask, ...record } = compacted;
  return record;
}

export function hydrateConsistencyTaskSnapshot(
  record: ConsistencyTaskCollectionRecord,
): ConsistencyTaskSnapshot {
  const runs = record.runs.map(normalizeRunSnapshot);
  return {
    ...record,
    runs,
    sourceTask: record.sourceTask ?? createFallbackSourceTask(record),
    analysis: analyzeConsistency(runs),
    ruleReport: buildRuleReport(runs),
    riskReport: buildRiskReport(runs),
    analysisHistory: record.analysisHistory ?? [],
  };
}

function requiredObject(value: unknown, label: string, errors: string[]): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    errors.push(`${label} 必须是对象`);
    return undefined;
  }
  return value;
}

function validateNumberField(
  source: Record<string, unknown> | undefined,
  key: string,
  label: string,
  errors: string[],
): number | undefined {
  const value = source?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} 必须是数字`);
    return undefined;
  }
  return value;
}

function validateStringField(
  source: Record<string, unknown> | undefined,
  key: string,
  label: string,
  errors: string[],
): string | undefined {
  const value = source?.[key];
  if (!isNonEmptyString(value)) {
    errors.push(`${label} 必须是非空字符串`);
    return undefined;
  }
  return value;
}

function validateStringValueField(
  source: Record<string, unknown> | undefined,
  key: string,
  label: string,
  errors: string[],
): string | undefined {
  const value = source?.[key];
  if (typeof value !== "string") {
    errors.push(`${label} 必须是字符串`);
    return undefined;
  }
  return value;
}

export function validateRemoteTaskJson(jsonText: string): RemoteTaskValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch (error) {
    return {
      valid: false,
      errors: [`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const errors: string[] = [];
  const root = requiredObject(parsed, "输入 JSON", errors);
  const taskId = validateNumberField(root, "taskId", "taskId", errors);
  const testCase = requiredObject(root?.testCase, "testCase", errors);
  const testCaseId = validateNumberField(testCase, "id", "testCase.id", errors);
  const testCaseName = validateStringField(testCase, "name", "testCase.name", errors);
  const testCaseType = validateStringField(testCase, "type", "testCase.type", errors);
  const testCaseDescription = validateStringField(
    testCase,
    "description",
    "testCase.description",
    errors,
  );
  const testCaseInput = validateStringField(testCase, "input", "testCase.input", errors);
  const testCaseExpectedOutput = validateStringValueField(
    testCase,
    "expectedOutput",
    "testCase.expectedOutput",
    errors,
  );
  const testCaseFileUrl = validateStringField(testCase, "fileUrl", "testCase.fileUrl", errors);
  const executionResult = requiredObject(root?.executionResult, "executionResult", errors);
  const isBuildSuccess = executionResult?.isBuildSuccess;
  if (executionResult && typeof isBuildSuccess !== "boolean") {
    errors.push("executionResult.isBuildSuccess 必须是布尔值");
  }
  const outputCodeUrl = executionResult
    ? validateStringField(
        executionResult,
        "outputCodeUrl",
        "executionResult.outputCodeUrl",
        errors,
      )
    : undefined;
  const diffFileUrlValue = executionResult?.diffFileUrl;
  if (
    executionResult &&
    diffFileUrlValue !== undefined &&
    !isNonEmptyString(diffFileUrlValue)
  ) {
    errors.push("executionResult.diffFileUrl 必须是非空字符串");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    task: {
      taskId: taskId as number,
      testCase: {
        id: testCaseId as number,
        name: testCaseName as string,
        type: testCaseType as string,
        description: testCaseDescription as string,
        input: testCaseInput as string,
        expectedOutput: testCaseExpectedOutput as string,
        fileUrl: testCaseFileUrl as string,
      },
      executionResult: {
        isBuildSuccess: isBuildSuccess as boolean,
        outputCodeUrl: outputCodeUrl as string,
        ...(isNonEmptyString(diffFileUrlValue) ? { diffFileUrl: diffFileUrlValue } : {}),
      },
      callback: "",
    },
    errors: [],
  };
}

export function generateSubmittedTaskIds(
  baseTaskId: number,
  taskSequence: number,
  runCount = 10,
): number[] {
  const taskSeed = baseTaskId * 100000 + taskSequence * 100 + 1;
  const ids = Array.from({ length: runCount }, (_, index) => taskSeed + index);
  if (!ids.every(Number.isSafeInteger)) {
    throw new Error("生成后的 taskId 超出安全整数范围");
  }
  return ids;
}

export function extractConsistencyRunSummary(
  runIndex: number,
  taskId: number,
  resultData: unknown,
): ConsistencyRunSummary {
  const result = isRecord(resultData) ? resultData : {};
  const conclusion = isRecord(result.overall_conclusion) ? result.overall_conclusion : {};
  const totalScore = numberValue(conclusion.total_score);
  const hardGateTriggered =
    typeof conclusion.hard_gate_triggered === "boolean"
      ? conclusion.hard_gate_triggered
      : undefined;
  const summary = optionalString(conclusion.summary);

  const ruleRows = Array.isArray(result.rule_audit_results) ? result.rule_audit_results : [];
  const involvedRuleCount = ruleRows.filter(
    (row) => isRecord(row) && row.result !== "不涉及",
  ).length;
  const unsatisfiedRules = ruleRows
    .filter((row): row is Record<string, unknown> => isRecord(row) && row.result === "不满足")
    .map((row) => {
      const ruleId = normalizeText(row.rule_id);
      const fallback = normalizeText(row.conclusion) || ruleId;
      return {
        ruleId,
        summary: normalizeText(row.rule_summary) || fallback,
        ...(optionalString(row.conclusion) ? { conclusion: optionalString(row.conclusion) } : {}),
      };
    })
    .filter((row) => row.ruleId.length > 0);

  const riskRows = Array.isArray(result.risks) ? result.risks : [];
  const risks = riskRows
    .filter((row): row is Record<string, unknown> => isRecord(row))
    .map((row) => {
      const level = optionalString(row.level);
      const title = optionalString(row.title);
      const description = optionalString(row.description);
      const id = numberValue(row.id);
      const identityText = title ?? description ?? (id !== undefined ? String(id) : "");
      const key = `${normalizeText(level).toLowerCase()}|${normalizeText(identityText)}`;
      return {
        key,
        ...(id !== undefined ? { id } : {}),
        ...(level ? { level } : {}),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(optionalString(row.evidence) ? { evidence: optionalString(row.evidence) } : {}),
      };
    })
    .filter((risk) => risk.key !== "|");

  return {
    runIndex,
    taskId,
    status: "completed",
    ...(totalScore !== undefined ? { totalScore } : {}),
    ...(hardGateTriggered !== undefined ? { hardGateTriggered } : {}),
    ...(summary ? { summary } : {}),
    ruleUnsatisfactionRatio:
      involvedRuleCount > 0 ? unsatisfiedRules.length / involvedRuleCount : 0,
    unsatisfiedRules,
    risks,
  };
}

export function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) {
    return 1;
  }
  let intersectionSize = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) {
      intersectionSize += 1;
    }
  }
  return intersectionSize / union.size;
}

function signatureForRun(run: ConsistencyRunSummary): RunSignature | undefined {
  if (run.status !== "completed" || run.totalScore === undefined) {
    return undefined;
  }
  return {
    taskId: run.taskId,
    scoreBand: Math.floor(run.totalScore / 3) * 3,
    hardGateTriggered: run.hardGateTriggered ?? false,
    unsatisfiedRuleKeys: run.unsatisfiedRules.map((rule) => rule.ruleId).sort(),
    riskKeys: run.risks.map((risk) => risk.key).sort(),
  };
}

function majoritySet(signatures: RunSignature[], select: (signature: RunSignature) => string[]): string[] {
  const counts = new Map<string, number>();
  for (const signature of signatures) {
    for (const key of new Set(select(signature))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = signatures.length / 2;
  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([key]) => key)
    .sort();
}

export function analyzeConsistency(runs: ConsistencyRunSummary[]): ConsistencyAnalysisSummary {
  const completedRuns = runs.filter((run) => run.status === "completed");
  const failedRuns = runs.filter(
    (run) => run.status === "failed" || run.status === "timed_out" || run.status === "missing",
  ).length;
  const signatures = completedRuns.map(signatureForRun).filter((value): value is RunSignature => Boolean(value));
  const scores = completedRuns
    .map((run) => run.totalScore)
    .filter((value): value is number => typeof value === "number");

  if (signatures.length === 0) {
    return {
      completedRuns: completedRuns.length,
      failedRuns,
      consistentCompletedRuns: 0,
      consistencyPercentage: null,
      averageScore: null,
      medianScore: null,
      minScore: null,
      maxScore: null,
      scoreStandardDeviation: null,
      averageRuleUnsatisfactionRatio: null,
      averageRiskCount: null,
      conclusion: "暂无可用于一致性分析的完成结果。",
      runConsistencyByTaskId: {},
    };
  }

  const majorityScoreBand = mode(signatures.map((signature) => signature.scoreBand));
  const majorityHardGate = mode(signatures.map((signature) => signature.hardGateTriggered));
  const majorityRules = majoritySet(signatures, (signature) => signature.unsatisfiedRuleKeys);
  const majorityRisks = majoritySet(signatures, (signature) => signature.riskKeys);
  const runConsistencyByTaskId: Record<number, boolean> = {};

  let consistentCompletedRuns = 0;
  for (const signature of signatures) {
    const consistent =
      signature.scoreBand === majorityScoreBand &&
      signature.hardGateTriggered === majorityHardGate &&
      jaccardSimilarity(signature.unsatisfiedRuleKeys, majorityRules) >= 0.8 &&
      jaccardSimilarity(signature.riskKeys, majorityRisks) >= 0.8;
    runConsistencyByTaskId[signature.taskId] = consistent;
    if (consistent) {
      consistentCompletedRuns += 1;
    }
  }

  const averageScore = scores.length
    ? roundNumber(scores.reduce((sum, score) => sum + score, 0) / scores.length)
    : null;
  const medianScore = median(scores);
  const scoreStandardDeviation =
    scores.length && averageScore !== null
      ? roundNumber(
          Math.sqrt(
            scores.reduce((sum, score) => sum + (score - averageScore) ** 2, 0) / scores.length,
          ),
        )
      : null;
  const consistencyPercentage = percentage(consistentCompletedRuns, signatures.length);
  const averageRuleUnsatisfactionRatio = completedRuns.length
    ? roundNumber(
        completedRuns.reduce((sum, run) => sum + (run.ruleUnsatisfactionRatio ?? 0), 0) /
          completedRuns.length,
        4,
      )
    : null;
  const averageRiskCount = completedRuns.length
    ? roundNumber(completedRuns.reduce((sum, run) => sum + run.risks.length, 0) / completedRuns.length)
    : null;

  const volatilityParts: string[] = [];
  const fluctuatingRules = buildRuleReport(completedRuns).filter(
    (item) => item.stability === "判定波动",
  );
  const occasionalRisks = buildRiskReport(completedRuns).filter(
    (item) => item.stability === "偶发出现",
  );
  if (fluctuatingRules[0]) {
    volatilityParts.push(`${fluctuatingRules[0].ruleId} 的规则判定`);
  }
  if (occasionalRisks.length > 0) {
    volatilityParts.push(`${occasionalRisks.length} 个偶发风险项`);
  }
  const levelText =
    consistencyPercentage >= 90
      ? "评分结果高度一致"
      : consistencyPercentage >= 70
        ? "评分结果基本一致，存在少量波动"
        : "评分结果波动明显，建议人工抽查不稳定规则和风险项";
  const lowSampleText = signatures.length < 3 ? "已完成运行少于 3 次，样本数不足。" : "";
  const volatilityText =
    volatilityParts.length > 0 ? `主要波动来自 ${volatilityParts.join("和")}。` : "";

  return {
    completedRuns: completedRuns.length,
    failedRuns,
    consistentCompletedRuns,
    consistencyPercentage,
    averageScore,
    medianScore: medianScore === null ? null : roundNumber(medianScore),
    minScore: scores.length ? Math.min(...scores) : null,
    maxScore: scores.length ? Math.max(...scores) : null,
    scoreStandardDeviation,
    averageRuleUnsatisfactionRatio,
    averageRiskCount,
    conclusion: `本次 AI 评分结果一致性为 ${String(consistencyPercentage)}%。${levelText}。${lowSampleText}${volatilityText}`,
    runConsistencyByTaskId,
  };
}

export function appendAnalysisHistorySnapshot(
  history: ConsistencyAnalysisHistoryItem[],
  runs: ConsistencyRunSummary[],
  capturedAt = new Date().toISOString(),
): ConsistencyAnalysisHistoryItem[] {
  if (!isConsistencyTaskTerminal(runs)) {
    return history;
  }
  const currentRunSetKey = runSetKey(runs);
  if (history.some((item) => runSetKey(item.runs) === currentRunSetKey)) {
    return history;
  }
  const runSnapshot = runs.map(cloneRunSummary);
  return [
    ...history,
    {
      round: history.length + 1,
      capturedAt,
      summary: analyzeConsistency(runSnapshot),
      ruleReport: buildRuleReport(runSnapshot),
      riskReport: buildRiskReport(runSnapshot),
      runs: runSnapshot,
    },
  ];
}

export function buildConsistencyExportPayload(
  task: ConsistencyExportTask,
  runResults: Map<number, unknown>,
): ConsistencyExportPayload {
  return {
    task: {
      id: task.id,
      originalTaskId: task.originalTaskId,
      caseId: task.caseId,
      caseName: task.caseName,
      createdAt: task.createdAt,
      status: task.status,
      serviceBaseUrl: task.serviceBaseUrl,
    },
    analysis: {
      summary: task.analysis,
      ruleReport: task.ruleReport,
      riskReport: task.riskReport,
    },
    analysisHistory: task.analysisHistory,
    runs: task.runs.map((run) => {
      const result = runResults.get(run.taskId);
      const error = errorMessage(result);
      return {
        runIndex: run.runIndex,
        taskId: run.taskId,
        status: run.status,
        summary: cloneRunSummary(run),
        ...(error ? { error } : { resultData: result }),
      };
    }),
  };
}

export function buildConsistencyExportFiles(payload: ConsistencyExportPayload): Map<string, string> {
  const files = new Map<string, string>();
  const roundByRunKey = new Map<string, number>();
  const analysisHistory = payload.analysisHistory.map((round) => {
    const roundDir = `rounds/round-${padNumber(round.round, 3)}`;
    for (const run of round.runs) {
      roundByRunKey.set(`${String(run.runIndex)}:${String(run.taskId)}`, round.round);
    }
    files.set(
      `${roundDir}/summary.json`,
      stringifyJson({
        round: round.round,
        capturedAt: round.capturedAt,
        summary: round.summary,
        ruleReport: round.ruleReport,
        riskReport: round.riskReport,
        runs: round.runs,
      }),
    );
    return {
      round: round.round,
      capturedAt: round.capturedAt,
      summary: round.summary,
      ruleReportPath: `${roundDir}/summary.json`,
      riskReportPath: `${roundDir}/summary.json`,
      runsPath: `${roundDir}/summary.json`,
    };
  });

  const runs = payload.runs.map((run) => {
    const round = roundByRunKey.get(`${String(run.runIndex)}:${String(run.taskId)}`) ?? 1;
    const roundDir = `rounds/round-${padNumber(round, 3)}`;
    const resultPath = `${roundDir}/run-${padNumber(run.runIndex + 1, 2)}-task-${String(
      run.taskId,
    )}.json`;
    files.set(resultPath, stringifyJson(run.error ? { error: run.error } : run.resultData));
    return {
      runIndex: run.runIndex,
      taskId: run.taskId,
      status: run.status,
      summaryPath: `${roundDir}/summary.json`,
      resultPath,
      ...(run.error ? { error: run.error } : {}),
    };
  });

  const overview: ConsistencyExportOverview = {
    task: payload.task,
    analysis: payload.analysis,
    analysisHistory,
    runs,
  };
  files.set("overview.json", stringifyJson(overview));
  return new Map([...files.entries()].sort(([left], [right]) => exportFileOrder(left, right)));
}

function exportFileOrder(left: string, right: string): number {
  if (left === "overview.json") return -1;
  if (right === "overview.json") return 1;
  const leftSummary = left.endsWith("/summary.json");
  const rightSummary = right.endsWith("/summary.json");
  if (leftSummary !== rightSummary && left.split("/").slice(0, 2).join("/") === right.split("/").slice(0, 2).join("/")) {
    return leftSummary ? -1 : 1;
  }
  return left.localeCompare(right);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function writeBytes(output: number[], bytes: Uint8Array) {
  output.push(...bytes);
}

export function createStoredZip(files: Map<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const output: number[] = [];
  const centralDirectory: number[] = [];

  for (const [path, content] of files) {
    const nameBytes = encoder.encode(path);
    const contentBytes = encoder.encode(content);
    const checksum = crc32(contentBytes);
    const localHeaderOffset = output.length;

    writeUint32(output, 0x04034b50);
    writeUint16(output, 20);
    writeUint16(output, 0x0800);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint16(output, 0);
    writeUint32(output, checksum);
    writeUint32(output, contentBytes.length);
    writeUint32(output, contentBytes.length);
    writeUint16(output, nameBytes.length);
    writeUint16(output, 0);
    writeBytes(output, nameBytes);
    writeBytes(output, contentBytes);

    writeUint32(centralDirectory, 0x02014b50);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 20);
    writeUint16(centralDirectory, 0x0800);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, checksum);
    writeUint32(centralDirectory, contentBytes.length);
    writeUint32(centralDirectory, contentBytes.length);
    writeUint16(centralDirectory, nameBytes.length);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint16(centralDirectory, 0);
    writeUint32(centralDirectory, 0);
    writeUint32(centralDirectory, localHeaderOffset);
    writeBytes(centralDirectory, nameBytes);
  }

  const centralDirectoryOffset = output.length;
  writeBytes(output, new Uint8Array(centralDirectory));
  writeUint32(output, 0x06054b50);
  writeUint16(output, 0);
  writeUint16(output, 0);
  writeUint16(output, files.size);
  writeUint16(output, files.size);
  writeUint32(output, centralDirectory.length);
  writeUint32(output, centralDirectoryOffset);
  writeUint16(output, 0);
  return new Uint8Array(output);
}

export function buildConsistencyHistoryChartRows(
  history: ConsistencyAnalysisHistoryItem[],
): ConsistencyHistoryChartRow[] {
  return history.map((item) => ({
    label: `第 ${String(item.round)} 轮`,
    capturedAt: item.capturedAt,
    completedRuns: item.summary.completedRuns,
    failedRuns: item.summary.failedRuns,
    consistencyPercentage: item.summary.consistencyPercentage,
    averageScore: item.summary.averageScore,
    scoreStandardDeviation: item.summary.scoreStandardDeviation,
    ruleUnsatisfactionPercentage:
      item.summary.averageRuleUnsatisfactionRatio === null
        ? null
        : roundNumber(item.summary.averageRuleUnsatisfactionRatio * 100, 2),
    averageRiskCount: item.summary.averageRiskCount,
  }));
}

export function buildRuleReport(runs: ConsistencyRunSummary[]): RuleConsistencyReportItem[] {
  const completedRuns = runs.filter((run) => run.status === "completed");
  const ruleMap = new Map<
    string,
    {
      summary: string;
      conclusionSample?: string;
      runIndexes: number[];
    }
  >();

  for (const run of completedRuns) {
    for (const rule of run.unsatisfiedRules) {
      const existing = ruleMap.get(rule.ruleId);
      if (existing) {
        existing.runIndexes.push(run.runIndex + 1);
        existing.conclusionSample = existing.conclusionSample ?? rule.conclusion;
        continue;
      }
      ruleMap.set(rule.ruleId, {
        summary: rule.summary,
        conclusionSample: rule.conclusion,
        runIndexes: [run.runIndex + 1],
      });
    }
  }

  return [...ruleMap.entries()]
    .map(([ruleId, item]) => {
      const unsatisfiedCount = item.runIndexes.length;
      const unsatisfiedRate = percentage(unsatisfiedCount, completedRuns.length);
      const stability: RuleConsistencyReportItem["stability"] =
        unsatisfiedRate >= 80
          ? "稳定不满足"
          : unsatisfiedRate <= 20
            ? "稳定满足或不涉及"
            : "判定波动";
      return {
        ruleId,
        summary: item.summary,
        unsatisfiedCount,
        unsatisfiedRate,
        ...(item.conclusionSample ? { conclusionSample: item.conclusionSample } : {}),
        runIndexes: item.runIndexes,
        stability,
      };
    })
    .sort((a, b) => b.unsatisfiedCount - a.unsatisfiedCount || a.ruleId.localeCompare(b.ruleId));
}

export function buildRiskReport(runs: ConsistencyRunSummary[]): RiskConsistencyReportItem[] {
  const completedRuns = runs.filter((run) => run.status === "completed");
  const riskMap = new Map<
    string,
    {
      level?: string;
      title?: string;
      evidenceSample?: string;
      runIndexes: number[];
    }
  >();

  for (const run of completedRuns) {
    for (const risk of run.risks) {
      const existing = riskMap.get(risk.key);
      if (existing) {
        existing.runIndexes.push(run.runIndex + 1);
        existing.evidenceSample = existing.evidenceSample ?? risk.evidence;
        continue;
      }
      riskMap.set(risk.key, {
        level: risk.level,
        title: risk.title ?? risk.description ?? risk.key,
        evidenceSample: risk.evidence,
        runIndexes: [run.runIndex + 1],
      });
    }
  }

  return [...riskMap.entries()]
    .map(([key, item]) => {
      const appearanceCount = item.runIndexes.length;
      const appearanceRate = percentage(appearanceCount, completedRuns.length);
      const stability: RiskConsistencyReportItem["stability"] =
        appearanceRate >= 80 ? "稳定出现" : appearanceRate > 0 ? "偶发出现" : "未出现";
      return {
        key,
        ...(item.level ? { level: item.level } : {}),
        ...(item.title ? { title: item.title } : {}),
        appearanceCount,
        appearanceRate,
        runIndexes: item.runIndexes,
        ...(item.evidenceSample ? { evidenceSample: item.evidenceSample } : {}),
        stability,
      };
    })
    .sort((a, b) => b.appearanceCount - a.appearanceCount || a.key.localeCompare(b.key));
}
