import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createGetHumanReviewStatusHandler,
  createSubmitHumanReviewHandler,
} from "../src/api/humanReviewHandler.js";
import { API_DEFINITIONS, API_PATHS } from "../src/api/apiDefinitions.js";
import { createRemoteTaskRegistry } from "../src/api/remoteTaskRegistry.js";
import { getConfig } from "../src/config.js";
import { createHumanReviewEvidenceStore } from "../src/humanReview/humanReviewEvidenceStore.js";
import { runHumanReviewIngestionNode } from "../src/humanReview/humanReviewIngestionNode.js";
import { runResultRiskIngestionNode } from "../src/humanReview/resultRiskIngestionNode.js";
import { rebuildResultRiskEvidenceFromLocalCases } from "../src/humanReview/resultRiskRebuild.js";
import {
  filterHumanReviewTrainingCandidates,
  mapHumanVerdictToPolarity,
} from "../src/humanReview/humanReviewFiltering.js";
import type { HumanReviewItemReview } from "../src/humanReview/humanReviewTypes.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "human-review-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function createResponse() {
  const state: { statusCode: number; body?: Record<string, unknown> } = { statusCode: 200 };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: Record<string, unknown>) {
      state.body = body;
      return response;
    },
  };
  return { response, state };
}

function createReviewRequest(
  taskId: number,
  token: string | undefined,
  body: Record<string, unknown>,
) {
  return {
    params: { taskId: String(taskId) },
    body,
    header(name: string) {
      return name.toLowerCase() === "token" ? token : undefined;
    },
  };
}

function createStatusRequest(reviewId: string) {
  return { params: { reviewId } };
}

async function writeCompletedTask(
  t: test.TestContext,
  options: { status?: "completed" | "running" } = {},
) {
  const localCaseRoot = await makeTempDir(t);
  const caseDir = path.join(localCaseRoot, "remote-case");
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "outputs", "result.json"),
    JSON.stringify({
      basic_info: { task_type: "bug_fix" },
      overall_conclusion: { total_score: 60 },
      risks: [{ title: "接口风险" }],
      human_review_items: [{ item: "接口接入复核" }],
      report_meta: { unit_name: "case-88" },
    }),
  );
  const registry = createRemoteTaskRegistry(localCaseRoot);
  await registry.upsert({
    taskId: 88,
    status: options.status ?? "completed",
    caseDir,
    token: "remote-token",
    testCaseId: 188,
  });
  return { localCaseRoot, caseDir, registry };
}

function review(patch: Partial<HumanReviewItemReview>): HumanReviewItemReview {
  return {
    sourceItem: "代码实现复核",
    humanVerdict: "confirmed_issue",
    correctedAssessment: "生成代码使用本地 mockData 替代真实接口请求。",
    evidence: {
      files: ["entry/src/main/ets/pages/Index.ets"],
      snippets: ["const mockData = []"],
      comment: "prompt 要求接入真实接口。",
    },
    ...patch,
  };
}

test("human review filtering excludes scoring-process review points before training", () => {
  const result = filterHumanReviewTrainingCandidates([
    review({ sourceItem: "硬门槛复核", tags: ["hard_gate"] }),
    review({ sourceItem: "Patch 上下文缺失" }),
    review({ sourceItem: "Rubric Agent 降级" }),
    review({ sourceItem: "置信度复核" }),
  ]);

  assert.equal(result.eligible.length, 0);
  assert.deepEqual(
    result.filtered.map((item) => item.reason),
    [
      "process_or_scoring_review_point",
      "process_or_scoring_review_point",
      "process_or_scoring_review_point",
      "process_or_scoring_review_point",
    ],
  );
});

test("human review filtering excludes uncertain, score-only, and evidence-free items", () => {
  const result = filterHumanReviewTrainingCandidates([
    review({ sourceItem: "人工不确定复核", humanVerdict: "uncertain" }),
    review({
      sourceItem: "纯分数调整",
      evidence: undefined,
      scoreAdjustment: { finalScore: 70, reason: "人工调分" },
    }),
    review({ sourceItem: "缺少证据复核", evidence: { comment: "实现不完整" } }),
  ]);

  assert.deepEqual(
    result.filtered.map((item) => item.reason),
    ["uncertain_human_verdict", "score_only_adjustment", "missing_code_evidence"],
  );
});

test("human review filtering keeps code-generation review points with evidence", () => {
  const result = filterHumanReviewTrainingCandidates([
    review({ sourceItem: "接口接入复核", tags: ["api_integration"] }),
    review({ sourceItem: "需求遵循复核", tags: ["requirement_following"] }),
    review({ sourceItem: "ArkTS 语言复核", tags: ["arkts_language"] }),
    review({
      sourceItem: "自动误报复核",
      humanVerdict: "auto_false_positive",
      correctedAssessment: "代码已正确使用 @State 触发 UI 刷新。",
    }),
  ]);

  assert.equal(result.filtered.length, 0);
  assert.deepEqual(
    result.eligible.map((item) => item.review.humanVerdict),
    ["confirmed_issue", "confirmed_issue", "confirmed_issue", "auto_false_positive"],
  );
});

test("human review verdict maps to non-invertible training polarity", () => {
  assert.equal(mapHumanVerdictToPolarity("confirmed_correct"), "positive");
  assert.equal(mapHumanVerdictToPolarity("auto_false_positive"), "positive");
  assert.equal(mapHumanVerdictToPolarity("confirmed_issue"), "negative");
  assert.equal(mapHumanVerdictToPolarity("auto_false_negative"), "negative");
  assert.equal(mapHumanVerdictToPolarity("partially_correct"), "negative");
  assert.equal(mapHumanVerdictToPolarity("uncertain"), "neutral");
});

test("human review evidence store writes raw, status, classified, datasets, and index", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  const rawPath = await store.writeRawRecord({
    schemaVersion: 1,
    reviewId: "hr_test_1",
    taskId: 88,
    testCaseId: 188,
    receivedAt: "2026-04-28T10:20:30.000Z",
    resultSummary: {
      caseId: "case-188",
      taskType: "bug_fix",
      totalScore: 60,
      humanReviewItemCount: 1,
      riskCount: 2,
    },
    payload: { overallDecision: "adjust_required", itemReviews: [] },
  });

  assert.equal(
    path.relative(root, rawPath),
    path.join("raw", "2026-04-28", "task-88-review-hr_test_1.json"),
  );
  assert.equal(JSON.parse(await fs.readFile(rawPath, "utf-8")).reviewId, "hr_test_1");

  await store.writeStatus({
    schemaVersion: 1,
    reviewId: "hr_test_1",
    taskId: 88,
    status: "queued",
    updatedAt: "2026-04-28T10:20:31.000Z",
  });
  assert.equal((await store.readStatus("hr_test_1"))?.status, "queued");

  await store.writeClassifiedEvidence({
    evidenceId: "hr_test_1-item-1",
    reviewId: "hr_test_1",
    taskId: 88,
    polarity: "negative",
    datasetTypes: ["negative_diagnostic"],
    category: "api_integration",
    severity: "major",
    confidence: "high",
    taskSummary: "实现接口接入需求",
    humanJudgement: "使用 mockData 替代真实接口。",
    keyEvidence: ["entry/src/main/ets/pages/Index.ets"],
    codeGenerationLesson: "接口接入任务必须调用真实 API，不应以 mock 数据替代。",
    recommendedTrainingUse: "negative_diagnostic",
    shouldIncludeInTraining: true,
  });

  await store.appendDatasetSample("negative_diagnostic", {
    type: "negative_diagnostic",
    reviewId: "hr_test_1",
    evidenceId: "hr_test_1-item-1",
    category: "api_integration",
    humanSummary: "不要用 mockData 替代真实接口。",
  });

  const classifiedPath = path.join(
    root,
    "classified",
    "negative",
    "api_integration",
    "hr_test_1-item-1.json",
  );
  assert.equal(JSON.parse(await fs.readFile(classifiedPath, "utf-8")).category, "api_integration");

  const datasetLines = (
    await fs.readFile(path.join(root, "datasets", "negative_diagnostics.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  assert.equal(datasetLines.length, 1);
  assert.equal(JSON.parse(datasetLines[0] ?? "{}").evidenceId, "hr_test_1-item-1");

  const index = JSON.parse(await fs.readFile(path.join(root, "index.json"), "utf-8"));
  assert.deepEqual(
    index.reviews.map((item: { reviewId: string }) => item.reviewId),
    ["hr_test_1"],
  );
  assert.deepEqual(
    index.evidences.map((item: { evidenceId: string }) => item.evidenceId),
    ["hr_test_1-item-1"],
  );
});

test("human review evidence store serializes concurrent dataset appends", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await Promise.all(
    Array.from({ length: 5 }, async (_, index) =>
      store.appendDatasetSample("sft_positive", {
        type: "sft_positive",
        reviewId: "hr_parallel",
        evidenceId: `evidence-${String(index)}`,
      }),
    ),
  );

  const lines = (await fs.readFile(path.join(root, "datasets", "sft_positive.jsonl"), "utf-8"))
    .trim()
    .split("\n");
  assert.equal(lines.length, 5);
});

test("human review ingestion filters non-code items before classifier invocation", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  let classifierCalls = 0;

  const output = await runHumanReviewIngestionNode(
    {
      taskId: 88,
      reviewId: "hr_filter_only",
      submittedAt: "2026-04-28T10:20:30.000Z",
      resultJson: { human_review_items: [{ item: "硬门槛复核" }] },
      caseContext: { caseId: "case-88", taskType: "bug_fix" },
      reviewPayload: {
        overallDecision: "adjust_required",
        itemReviews: [review({ sourceItem: "硬门槛复核", tags: ["hard_gate"] })],
      },
    },
    {
      store,
      classifier: async () => {
        classifierCalls += 1;
        throw new Error("classifier should not be called");
      },
    },
  );

  assert.equal(classifierCalls, 0);
  assert.equal(output.summary.rawItemCount, 1);
  assert.equal(output.summary.eligibleItemCount, 0);
  assert.equal(output.summary.filteredItemCount, 1);
  assert.equal(output.summary.datasetItemCount, 0);
  assert.equal((await store.readStatus("hr_filter_only"))?.status, "completed");
});

test("human review ingestion writes positive and negative dataset samples", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await runHumanReviewIngestionNode(
    {
      taskId: 88,
      reviewId: "hr_dataset",
      submittedAt: "2026-04-28T10:20:30.000Z",
      resultJson: { human_review_items: [] },
      caseContext: { caseId: "case-88", taskType: "bug_fix", prompt: "接入真实接口" },
      reviewPayload: {
        overallDecision: "adjust_required",
        itemReviews: [
          review({ sourceItem: "接口接入复核", tags: ["api_integration"] }),
          review({
            sourceItem: "状态管理误报复核",
            humanVerdict: "auto_false_positive",
            correctedAssessment: "代码已正确使用 @State 更新 UI。",
            tags: ["arkui_state_management"],
          }),
        ],
      },
    },
    {
      store,
      classifier: async (input) => ({
        evidenceId: input.reviewItemKey,
        reviewId: input.reviewId,
        taskId: input.taskId,
        polarity: input.polarity,
        datasetTypes: input.polarity === "positive" ? ["sft_positive"] : ["negative_diagnostic"],
        category: input.polarity === "positive" ? "arkui_state_management" : "api_integration",
        severity: input.polarity === "positive" ? "info" : "major",
        confidence: "high",
        taskSummary: input.taskSummary,
        humanJudgement: input.humanReview.correctedAssessment,
        keyEvidence: input.evidence.files,
        codeGenerationLesson: "根据人工复核总结代码生成经验。",
        recommendedTrainingUse: input.polarity,
        shouldIncludeInTraining: true,
      }),
    },
  );

  const negativeLines = (
    await fs.readFile(path.join(root, "datasets", "negative_diagnostics.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  const positiveLines = (
    await fs.readFile(path.join(root, "datasets", "sft_positive.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");

  assert.equal(negativeLines.length, 1);
  assert.equal(positiveLines.length, 1);
  assert.equal(JSON.parse(negativeLines[0] ?? "{}").type, "negative_diagnostic");
  assert.equal(JSON.parse(positiveLines[0] ?? "{}").type, "sft_positive");
});

test("human review ingestion records classifier failures without appending datasets", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  const output = await runHumanReviewIngestionNode(
    {
      taskId: 88,
      reviewId: "hr_classifier_failed",
      submittedAt: "2026-04-28T10:20:30.000Z",
      resultJson: { human_review_items: [] },
      caseContext: { caseId: "case-88", taskType: "bug_fix" },
      reviewPayload: {
        overallDecision: "adjust_required",
        itemReviews: [review({ sourceItem: "接口接入复核", tags: ["api_integration"] })],
      },
    },
    {
      store,
      classifier: async () => {
        throw new Error("classifier unavailable");
      },
    },
  );

  assert.equal(output.status, "failed");
  assert.equal((await store.readStatus("hr_classifier_failed"))?.status, "classification_failed");
  await assert.rejects(
    fs.readFile(path.join(root, "datasets", "negative_diagnostics.jsonl"), "utf-8"),
    /ENOENT/,
  );
});

test("result risk ingestion appends agent-discovered risks as negative diagnostics", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  const output = await runResultRiskIngestionNode(
    {
      taskId: 88,
      testCaseId: 188,
      reviewId: "risk_20260428_88",
      receivedAt: "2026-04-28T10:20:30.000Z",
      caseContext: {
        caseId: "case-88",
        taskType: "bug_fix",
        prompt: "接入真实接口并刷新列表",
      },
      resultJson: {
        risks: [
          {
            level: "major",
            title: "接口仍使用 mockData",
            description: "生成代码没有调用真实接口，导致用例核心需求未实现。",
            evidence: "entry/src/main/ets/pages/Index.ets: const mockData = []",
          },
        ],
      },
    },
    { store },
  );

  assert.equal(output.status, "completed");
  assert.equal(output.summary.riskCount, 1);
  assert.equal(output.summary.datasetItemCount, 1);

  const datasetLines = (
    await fs.readFile(path.join(root, "datasets", "negative_diagnostics.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  const sample = JSON.parse(datasetLines[0] ?? "{}");
  assert.equal(sample.type, "negative_diagnostic");
  assert.equal(sample.reviewId, "risk_20260428_88");
  assert.equal(sample.evidenceId, "risk_20260428_88-risk-1");
  assert.equal(sample.category, "api_integration");
  assert.match(String(sample.codeGenerationLesson), /风险项指出/);

  const classified = JSON.parse(
    await fs.readFile(
      path.join(root, "classified", "negative", "api_integration", "risk_20260428_88-risk-1.json"),
      "utf-8",
    ),
  );
  assert.equal(classified.polarity, "negative");
  assert.deepEqual(classified.datasetTypes, ["negative_diagnostic"]);
});

test("result risk ingestion skips risks without code evidence", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  const output = await runResultRiskIngestionNode(
    {
      taskId: 89,
      reviewId: "risk_20260428_89",
      receivedAt: "2026-04-28T10:20:30.000Z",
      caseContext: { caseId: "case-89", taskType: "bug_fix" },
      resultJson: {
        risks: [
          {
            level: "minor",
            title: "证据不足风险",
            description: "缺少可定位到代码的证据。",
          },
        ],
      },
    },
    { store },
  );

  assert.equal(output.summary.riskCount, 1);
  assert.equal(output.summary.eligibleRiskCount, 0);
  assert.equal(output.summary.datasetItemCount, 0);
  await assert.rejects(
    fs.readFile(path.join(root, "datasets", "negative_diagnostics.jsonl"), "utf-8"),
    /ENOENT/,
  );
});

test("result risk rebuild ingests historical local case result risks idempotently", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const evidenceRoot = await makeTempDir(t);
  const remoteCaseDir = path.join(localCaseRoot, "20260428T010203_bug_fix_remote154");
  const localCaseDir = path.join(localCaseRoot, "20260428T020304_full_generation_localcase");

  await fs.mkdir(path.join(remoteCaseDir, "inputs"), { recursive: true });
  await fs.mkdir(path.join(remoteCaseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(remoteCaseDir, "inputs", "case-info.json"),
    JSON.stringify({
      remote_task_id: 154,
      remote_test_case_id: 65,
      case_id: "remote-task-154",
      started_at: "2026-04-28T01:02:03.000Z",
      original_prompt_summary: "接入真实接口",
    }),
  );
  await fs.writeFile(
    path.join(remoteCaseDir, "outputs", "result.json"),
    JSON.stringify({
      basic_info: { task_type: "bug_fix" },
      report_meta: { unit_name: "remote-task-154", generated_at: "2026-04-28T01:10:00.000Z" },
      risks: [
        {
          level: "major",
          title: "接口仍使用 mockData",
          description: "生成代码没有调用真实接口。",
          evidence: "entry/src/main/ets/pages/Index.ets: const mockData = []",
        },
        {
          level: "minor",
          title: "缺少证据风险",
          description: "该项缺少代码证据，不应入训练集。",
        },
      ],
    }),
  );

  await fs.mkdir(path.join(localCaseDir, "inputs"), { recursive: true });
  await fs.mkdir(path.join(localCaseDir, "outputs"), { recursive: true });
  await fs.writeFile(
    path.join(localCaseDir, "inputs", "case-info.json"),
    JSON.stringify({
      case_id: "local-case-1",
      started_at: "2026-04-28T02:03:04.000Z",
      original_prompt_summary: "实现状态刷新",
    }),
  );
  await fs.writeFile(
    path.join(localCaseDir, "outputs", "result.json"),
    JSON.stringify({
      basic_info: { task_type: "continuation" },
      report_meta: { unit_name: "local-case-1", generated_at: "2026-04-28T02:10:00.000Z" },
      risks: [
        {
          level: "major",
          title: "状态未刷新",
          description: "生成代码更新普通字段，无法触发 UI 刷新。",
          evidence: "entry/src/main/ets/pages/Index.ets: this.items = data",
        },
      ],
    }),
  );

  const firstSummary = await rebuildResultRiskEvidenceFromLocalCases({
    localCaseRoot,
    evidenceRoot,
  });
  const secondSummary = await rebuildResultRiskEvidenceFromLocalCases({
    localCaseRoot,
    evidenceRoot,
  });

  assert.deepEqual(firstSummary, {
    scannedResultFiles: 2,
    rebuiltRuns: 2,
    riskCount: 3,
    eligibleRiskCount: 2,
    datasetItemCount: 2,
    skippedFiles: 0,
  });
  assert.equal(secondSummary.datasetItemCount, 0);

  const datasetLines = (
    await fs.readFile(path.join(evidenceRoot, "datasets", "negative_diagnostics.jsonl"), "utf-8")
  )
    .trim()
    .split("\n")
    .map(
      (line) => JSON.parse(line) as { reviewId?: string; evidenceId?: string; category?: string },
    );

  assert.equal(datasetLines.length, 2);
  assert.deepEqual(
    datasetLines.map((item) => item.reviewId),
    ["risk_20260428_154", datasetLines[1]?.reviewId],
  );
  assert.match(String(datasetLines[1]?.reviewId), /^risk_20260428_\d+$/);
  assert.deepEqual(
    datasetLines.map((item) => item.category),
    ["api_integration", "arkui_state_management"],
  );
});

test("submit human review handler writes raw and returns before background ingestion finishes", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  let resolveBackground: (() => void) | undefined;
  let backgroundStarted = false;
  const handler = createSubmitHumanReviewHandler({
    registry,
    store,
    runIngestion: async () => {
      backgroundStarted = true;
      await new Promise<void>((resolve) => {
        resolveBackground = resolve;
      });
    },
  });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, "remote-token", {
      overallDecision: "adjust_required",
      itemReviews: [review({ sourceItem: "接口接入复核", tags: ["api_integration"] })],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.taskId, 88);
  assert.equal(state.body?.classificationStatus, "queued");
  assert.equal(backgroundStarted, true);
  assert.equal(typeof state.body?.reviewId, "string");
  assert.equal((await store.readStatus(String(state.body?.reviewId)))?.status, "queued");
  const rawPath = String(state.body?.rawPath);
  assert.equal(JSON.parse(await fs.readFile(rawPath, "utf-8")).taskId, 88);
  resolveBackground?.();
});

test("submit human review handler does not require token authentication", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({
    registry,
    store,
    runIngestion: async () => undefined,
  });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, undefined, {
      overallDecision: "accepted",
      itemReviews: [review({ sourceItem: "接口接入复核", tags: ["api_integration"] })],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.taskId, 88);
});

test("submit human review handler rejects missing, running, and invalid requests", async (t) => {
  const { registry } = await writeCompletedTask(t, { status: "running" });
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });

  const invalid = createResponse();
  await handler(
    createReviewRequest(88, undefined, { itemReviews: [] }) as never,
    invalid.response as never,
  );
  assert.equal(invalid.state.statusCode, 400);

  const running = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      overallDecision: "accepted",
      itemReviews: [review({})],
    }) as never,
    running.response as never,
  );
  assert.equal(running.state.statusCode, 409);

  const missing = createResponse();
  await handler(
    createReviewRequest(999, undefined, {
      overallDecision: "accepted",
      itemReviews: [review({})],
    }) as never,
    missing.response as never,
  );
  assert.equal(missing.state.statusCode, 404);
});

test("human review status handler returns stored status", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  await store.writeStatus({
    schemaVersion: 1,
    reviewId: "hr_status",
    taskId: 88,
    status: "completed",
    updatedAt: "2026-04-28T10:20:31.000Z",
    classificationSummary: {
      rawItemCount: 1,
      eligibleItemCount: 1,
      filteredItemCount: 0,
      datasetItemCount: 1,
      positive: 0,
      negative: 1,
      neutral: 0,
    },
  });
  const handler = createGetHumanReviewStatusHandler(store);
  const { response, state } = createResponse();

  await handler(createStatusRequest("hr_status") as never, response as never);

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.reviewId, "hr_status");
  assert.equal(state.body?.status, "completed");
});

test("human review config defaults evidence root outside project directory", () => {
  const previous = process.env.HUMAN_REVIEW_EVIDENCE_ROOT;
  try {
    delete process.env.HUMAN_REVIEW_EVIDENCE_ROOT;
    const evidenceRoot = getConfig().humanReviewEvidenceRoot;
    assert.equal(
      evidenceRoot,
      path.resolve(os.homedir(), ".hmos-score-agent", "human-review-evidences"),
    );
    assert.equal(path.relative(process.cwd(), evidenceRoot).startsWith(".."), true);
  } finally {
    if (previous === undefined) {
      delete process.env.HUMAN_REVIEW_EVIDENCE_ROOT;
    } else {
      process.env.HUMAN_REVIEW_EVIDENCE_ROOT = previous;
    }
  }
});

test("human review config reads persistent evidence root from environment", () => {
  const previous = process.env.HUMAN_REVIEW_EVIDENCE_ROOT;
  process.env.HUMAN_REVIEW_EVIDENCE_ROOT = "/data/hmos-score-agent/human-review-evidences";
  try {
    assert.equal(
      getConfig().humanReviewEvidenceRoot,
      path.resolve("/data/hmos-score-agent/human-review-evidences"),
    );
  } finally {
    if (previous === undefined) {
      delete process.env.HUMAN_REVIEW_EVIDENCE_ROOT;
    } else {
      process.env.HUMAN_REVIEW_EVIDENCE_ROOT = previous;
    }
  }
});

test("aliyun deployment script writes persistent human review environment", async () => {
  const script = await fs.readFile("scripts/aliyun-single-instance-deploy.sh", "utf-8");

  assert.match(
    script,
    /LOCAL_CASE_ROOT="\$\{LOCAL_CASE_ROOT:-\/data\/hmos-score-agent\/local-cases\}"/,
  );
  assert.match(
    script,
    /HUMAN_REVIEW_EVIDENCE_ROOT="\$\{HUMAN_REVIEW_EVIDENCE_ROOT:-\/data\/hmos-score-agent\/human-review-evidences\}"/,
  );
  assert.match(script, /HUMAN_REVIEW_EVIDENCE_ROOT=\$\{HUMAN_REVIEW_EVIDENCE_ROOT\}/);
  assert.match(script, /mkdir -p.*\$\{LOCAL_CASE_ROOT\}/);
  assert.match(script, /mkdir -p.*\$\{HUMAN_REVIEW_EVIDENCE_ROOT\}/);
  assert.match(script, /chown.*\$\{HUMAN_REVIEW_EVIDENCE_ROOT\}/);
});

test("api definitions document human review submission and status endpoints", () => {
  assert.equal(API_PATHS.humanReview, "/score/remote-tasks/:taskId/human-review");
  assert.equal(API_PATHS.humanReviewStatus, "/score/human-reviews/:reviewId");
  assert.equal(
    API_DEFINITIONS.some(
      (definition) => definition.method === "POST" && definition.path === API_PATHS.humanReview,
    ),
    true,
  );
  assert.equal(
    API_DEFINITIONS.some(
      (definition) =>
        definition.method === "GET" && definition.path === API_PATHS.humanReviewStatus,
    ),
    true,
  );
});
