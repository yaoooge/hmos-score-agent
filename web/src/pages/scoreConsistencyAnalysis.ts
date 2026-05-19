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
