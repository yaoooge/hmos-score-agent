import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { API_DEFINITIONS, API_PATHS } from "../src/interfaces/http/apiDefinitions.js";
import { createRemoteTaskRegistry } from "../src/api/remoteTaskRegistry.js";
import { createSubmitManualRatingHandler } from "../src/api/manualRatingHandler.js";
import { createHumanReviewEvidenceStore } from "../src/datasets/humanReview/humanReviewEvidenceStore.js";
import {
  writeHumanRatingAnalysis,
  writeHumanRatingRecord,
  writeHumanRatingSkipped,
} from "../src/datasets/humanRating/humanRatingArtifactStore.js";
import type { HumanRatingGapAnalysis } from "../src/datasets/humanRating/humanRatingTypes.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "human-rating-"));
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

function createManualRatingRequest(taskId: number, body: Record<string, unknown>) {
  return {
    params: { taskId: String(taskId) },
    body,
  };
}

function analysisFixture(): HumanRatingGapAnalysis {
  return {
    primaryConclusion: "scoring_system_needs_improvement",
    confidence: "medium",
    reasonSummary: "自动评分漏判编译失败。",
    humanRatingReview: { needsImprovement: false, reason: "人工依据充分。" },
    scoringSystemReview: { needsImprovement: true, reason: "缺少构建失败 hard gate。" },
    evidence: ["outputs/result.json: overall_conclusion.total_score=92"],
    recommendedActions: ["补充构建失败 hard gate。"],
  };
}

function analysisFixtureWithReason(reasonSummary: string): HumanRatingGapAnalysis {
  return {
    ...analysisFixture(),
    reasonSummary,
  };
}

async function writeCompletedTask(
  t: test.TestContext,
  options: { taskId?: number; status?: "completed" | "running"; autoScore?: number; omitScore?: boolean } = {},
) {
  const localCaseRoot = await makeTempDir(t);
  const caseDir = path.join(localCaseRoot, "remote-case");
  await fs.mkdir(path.join(caseDir, "outputs"), { recursive: true });
  const resultJson = {
    basic_info: { case_name: "电视台云服务新增全屏播放" },
    overall_conclusion: options.omitScore ? {} : { total_score: options.autoScore ?? 92 },
    risks: [],
  };
  await fs.writeFile(
    path.join(caseDir, "outputs", "result.json"),
    `${JSON.stringify(resultJson, null, 2)}\n`,
    "utf-8",
  );
  const registry = createRemoteTaskRegistry(localCaseRoot);
  await registry.upsert({
    taskId: options.taskId ?? 88,
    status: options.status ?? "completed",
    caseDir,
    token: "remote-token",
    testCaseId: 188,
  });
  return { localCaseRoot, caseDir, registry };
}

test("human rating artifact store writes only case-local json artifacts", async (t) => {
  const caseDir = await makeTempDir(t);
  const record = {
    taskId: 88,
    testCaseId: 188,
    reviewedAt: "2026-05-09T02:30:00.000Z",
    reviewer: "alice",
    manualRating: "L1" as const,
    basis: "无法编译运行。",
    autoScore: 92,
    autoRating: "L5" as const,
    gapQualified: true,
    gapRule: "manual=L1 autoScore>=70",
  };

  await fs.mkdir(path.join(caseDir, "human-rating"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "human-rating", "manual-rating-history.jsonl"),
    `${JSON.stringify(record)}\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "human-rating", "analysis-history.jsonl"),
    `${JSON.stringify(record)}\n`,
    "utf-8",
  );
  await writeHumanRatingRecord(caseDir, record);
  await writeHumanRatingSkipped(
    caseDir,
    { ...record, gapQualified: false, gapRule: undefined },
    "未达到差异分析阈值。",
  );
  await fs.access(path.join(caseDir, "human-rating", "analysis-skipped.json"));
  await writeHumanRatingAnalysis(caseDir, {
    ...record,
    analysis: {
      primaryConclusion: "scoring_system_needs_improvement",
      confidence: "medium",
      reasonSummary: "自动评分漏判编译失败。",
      humanRatingReview: { needsImprovement: false, reason: "人工依据充分。" },
      scoringSystemReview: { needsImprovement: true, reason: "缺少 hard gate。" },
      evidence: ["outputs/result.json"],
      recommendedActions: ["补充 hard gate。"],
    },
  });

  const latest = JSON.parse(
    await fs.readFile(path.join(caseDir, "human-rating", "manual-rating.json"), "utf-8"),
  ) as Record<string, unknown>;
  await fs.access(path.join(caseDir, "human-rating", "analysis.json"));

  assert.equal(latest.taskId, 88);
  await assert.rejects(
    () => fs.access(path.join(caseDir, "human-rating", "analysis-skipped.json")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "human-rating", "manual-rating-history.jsonl")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "human-rating", "analysis-history.jsonl")),
    /ENOENT/,
  );
});

test("submit manual rating handler analyzes qualified L1 gap and keeps result json unchanged", async (t) => {
  const { caseDir, registry } = await writeCompletedTask(t, { autoScore: 92 });
  const evidenceRoot = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(evidenceRoot);
  const beforeResult = await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8");
  let analyzerCallCount = 0;
  const handler = createSubmitManualRatingHandler({
    registry,
    store,
    analyzeGap: async () => {
      analyzerCallCount += 1;
      return analysisFixture();
    },
  });
  const { response, state } = createResponse();

  await handler(
    createManualRatingRequest(88, {
      reviewer: "alice",
      manualRating: "L1",
      basis: "无法编译运行。",
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal((state.body?.summary as Record<string, unknown>).analysisStatus, "completed");
  assert.equal((state.body?.summary as Record<string, unknown>).gapQualified, true);
  assert.equal(analyzerCallCount, 1);
  assert.equal(await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"), beforeResult);
  await fs.access(path.join(caseDir, "human-rating", "manual-rating.json"));
  await fs.access(path.join(caseDir, "human-rating", "analysis.json"));
  const datasetLines = (
    await fs.readFile(path.join(evidenceRoot, "datasets", "human_rating_gap_analyses.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  const sample = JSON.parse(datasetLines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(datasetLines.length, 1);
  assert.equal(sample.type, "human_rating_gap_analysis");
  assert.equal(sample.taskId, 88);
  assert.equal(sample.manualRating, "L1");
  assert.equal(sample.autoScore, 92);
  assert.equal(sample.primaryConclusion, "scoring_system_needs_improvement");
});

test("submit manual rating handler reruns qualified gap analysis and overwrites old task data", async (t) => {
  const { caseDir, registry } = await writeCompletedTask(t, { autoScore: 92 });
  const evidenceRoot = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(evidenceRoot);
  const analysisReasons = ["第一次分析。", "第二次分析。"];
  let analyzerCallCount = 0;
  const handler = createSubmitManualRatingHandler({
    registry,
    store,
    analyzeGap: async () => {
      const reason = analysisReasons[analyzerCallCount] ?? "额外分析。";
      analyzerCallCount += 1;
      return analysisFixtureWithReason(reason);
    },
  });

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, {
        reviewer: "alice",
        manualRating: "L1",
        basis: "第一次人工依据。",
      }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 200);
  }

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, {
        reviewer: "bob",
        manualRating: "L1",
        basis: "第二次人工依据。",
      }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 200);
    assert.equal((state.body?.summary as Record<string, unknown>).analysisStatus, "completed");
  }

  assert.equal(analyzerCallCount, 2);
  const latestManualRating = JSON.parse(
    await fs.readFile(path.join(caseDir, "human-rating", "manual-rating.json"), "utf-8"),
  ) as Record<string, unknown>;
  const latestAnalysis = JSON.parse(
    await fs.readFile(path.join(caseDir, "human-rating", "analysis.json"), "utf-8"),
  ) as Record<string, unknown>;
  const datasetLines = (
    await fs.readFile(path.join(evidenceRoot, "datasets", "human_rating_gap_analyses.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  const sample = JSON.parse(datasetLines[0] ?? "{}") as Record<string, unknown>;

  assert.equal(latestManualRating.reviewer, "bob");
  assert.equal(latestManualRating.basis, "第二次人工依据。");
  assert.equal((latestAnalysis.analysis as Record<string, unknown>).reasonSummary, "第二次分析。");
  assert.equal(datasetLines.length, 1);
  assert.equal(sample.taskId, 88);
  assert.equal(sample.reviewer, "bob");
  assert.equal(sample.manualBasis, "第二次人工依据。");
  assert.equal(sample.reasonSummary, "第二次分析。");
});

test("submit manual rating handler clears previous analysis when repeated submission is skipped", async (t) => {
  const { caseDir, registry } = await writeCompletedTask(t, { autoScore: 92 });
  const evidenceRoot = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(evidenceRoot);
  const handler = createSubmitManualRatingHandler({
    registry,
    store,
    analyzeGap: async () => analysisFixture(),
  });

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, {
        reviewer: "alice",
        manualRating: "L1",
        basis: "无法编译运行。",
      }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 200);
  }

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, {
        reviewer: "bob",
        manualRating: "L3",
        basis: "人工复核后认为质量可接受。",
      }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 200);
    assert.equal((state.body?.summary as Record<string, unknown>).analysisStatus, "skipped");
  }

  const latestManualRating = JSON.parse(
    await fs.readFile(path.join(caseDir, "human-rating", "manual-rating.json"), "utf-8"),
  ) as Record<string, unknown>;
  await fs.access(path.join(caseDir, "human-rating", "analysis-skipped.json"));
  await assert.rejects(() => fs.access(path.join(caseDir, "human-rating", "analysis.json")), /ENOENT/);
  await assert.rejects(
    () => fs.access(path.join(evidenceRoot, "datasets", "human_rating_gap_analyses.jsonl")),
    /ENOENT/,
  );
  assert.equal(latestManualRating.manualRating, "L3");
  assert.equal(latestManualRating.reviewer, "bob");
});

test("submit manual rating handler skips non-qualified ratings without analyzer or summary dataset", async (t) => {
  for (const [index, item] of [
    { manualRating: "L1", autoScore: 69.99 },
    { manualRating: "L2", autoScore: 79.99 },
    { manualRating: "L3", autoScore: 100 },
  ].entries()) {
    const taskId = 100 + index;
    const { caseDir, registry } = await writeCompletedTask(t, { taskId, autoScore: item.autoScore });
    const evidenceRoot = await makeTempDir(t);
    const store = createHumanReviewEvidenceStore(evidenceRoot);
    const handler = createSubmitManualRatingHandler({
      registry,
      store,
      analyzeGap: async () => {
        throw new Error("analyzer should not be called");
      },
    });
    const { response, state } = createResponse();

    await handler(
      createManualRatingRequest(taskId, {
        manualRating: item.manualRating,
        basis: "人工依据。",
      }) as never,
      response as never,
    );

    assert.equal(state.statusCode, 200);
    assert.equal((state.body?.summary as Record<string, unknown>).analysisStatus, "skipped");
    assert.equal((state.body?.summary as Record<string, unknown>).gapQualified, false);
    await fs.access(path.join(caseDir, "human-rating", "analysis-skipped.json"));
    await assert.rejects(
      () => fs.access(path.join(evidenceRoot, "datasets", "human_rating_gap_analyses.jsonl")),
      /ENOENT/,
    );
  }
});

test("submit manual rating handler rejects invalid requests and missing auto score", async (t) => {
  const { registry } = await writeCompletedTask(t, { omitScore: true });
  const store = createHumanReviewEvidenceStore(await makeTempDir(t));
  const handler = createSubmitManualRatingHandler({ registry, store });

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, { manualRating: "L7", basis: "x" }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 400);
  }

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, { manualRating: "L1", basis: " " }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 400);
  }

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, { manualRating: "L1", basis: "" }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 409);
  }

  {
    const { response, state } = createResponse();
    await handler(
      createManualRatingRequest(88, { manualRating: "L1", basis: "无法编译运行。" }) as never,
      response as never,
    );
    assert.equal(state.statusCode, 409);
  }
});

test("api definitions expose manual rating through human review endpoint", () => {
  assert.equal(
    API_DEFINITIONS.some(
      (item) => item.method === "POST" && item.path === "/score/remote-tasks/:taskId/manual-rating",
    ),
    false,
  );
  const definition = API_DEFINITIONS.find(
    (item) => item.method === "POST" && item.path === API_PATHS.humanReview,
  );
  assert.ok(definition);
  assert.equal(Object.hasOwn(definition.request?.body?.properties ?? {}, "manualLevel"), true);
  assert.equal(Object.hasOwn(definition.request?.body?.properties ?? {}, "overallComment"), true);
  assert.equal(Object.hasOwn(definition.request?.body?.properties ?? {}, "basis"), false);
  assert.equal(Object.hasOwn(definition.responses[0]?.body.properties ?? {}, "summary"), true);
});
