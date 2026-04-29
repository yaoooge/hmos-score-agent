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
      risks: [
        {
          level: "medium",
          title: "接口风险",
          description: "接口失败时缺少明确错误提示。",
          evidence: "entry/src/main/ets/pages/Index.ets: console.error(error)",
        },
        {
          level: "high",
          title: "主流程阻断",
          description: "核心列表无法加载。",
          evidence: "entry/src/main/ets/pages/Index.ets: return []",
        },
      ],
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

test("human review evidence store writes status and datasets", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await store.writeStatus({
    schemaVersion: 1,
    reviewId: "hr_test_1",
    taskId: 88,
    status: "completed",
    updatedAt: "2026-04-28T10:20:31.000Z",
  });
  assert.equal((await store.readStatus("hr_test_1"))?.status, "completed");

  await store.appendDatasetSample("item_review_calibration", {
    type: "item_review_calibration",
    reviewId: "hr_test_1",
    evidenceId: "hr_test_1-item-1",
    humanReview: { correctedAssessment: "不要用 mockData 替代真实接口。" },
  });

  const datasetLines = (
    await fs.readFile(path.join(root, "datasets", "item_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  assert.equal(datasetLines.length, 1);
  assert.equal(JSON.parse(datasetLines[0] ?? "{}").evidenceId, "hr_test_1-item-1");
});

test("human review evidence store serializes concurrent dataset appends", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await Promise.all(
    Array.from({ length: 5 }, async (_, index) =>
      store.appendDatasetSample("item_review_calibration", {
        type: "item_review_calibration",
        reviewId: "hr_parallel",
        evidenceId: `evidence-${String(index)}`,
      }),
    ),
  );

  const lines = (
    await fs.readFile(path.join(root, "datasets", "item_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  assert.equal(lines.length, 5);
});

test("submit human review handler accepts empty first-version payload", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(createReviewRequest(88, undefined, {}) as never, response as never);

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.status, "completed");
  assert.deepEqual(state.body?.summary, {
    itemReviewCount: 0,
    riskReviewCount: 0,
    riskAgreementCount: 0,
    riskDisagreementCount: 0,
    datasetItemCount: 0,
  });
  assert.equal((await store.readStatus(String(state.body?.reviewId)))?.status, "completed");
  await assert.rejects(
    fs.readFile(path.join(root, "datasets", "risk_review_calibrations.jsonl"), "utf-8"),
    /ENOENT/,
  );
});

test("submit human review handler writes manual risk review calibration samples", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, undefined, {
      riskReviews: [
        {
          riskIndex: 0,
          agreeWithResultLevel: false,
          resultLevel: "medium",
          correctedLevel: "low",
          reason: "该风险只影响异常态提示，不影响主流程功能。",
          comment: "边界体验问题。",
        },
        {
          riskIndex: 1,
          agreeWithResultLevel: true,
          resultLevel: "high",
        },
      ],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.status, "completed");
  assert.deepEqual(state.body?.summary, {
    itemReviewCount: 0,
    riskReviewCount: 2,
    riskAgreementCount: 1,
    riskDisagreementCount: 1,
    datasetItemCount: 2,
  });

  const samples = (
    await fs.readFile(path.join(root, "datasets", "risk_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(samples.length, 2);
  assert.equal(samples[0]?.type, "risk_review_calibration");
  assert.equal(samples[0]?.riskIndex, 0);
  assert.deepEqual(samples[0]?.resultRisk, {
    level: "medium",
    title: "接口风险",
    description: "接口失败时缺少明确错误提示。",
    evidence: "entry/src/main/ets/pages/Index.ets: console.error(error)",
  });
  assert.deepEqual(samples[0]?.humanReview, {
    agreeWithResultLevel: false,
    correctedLevel: "low",
    reason: "该风险只影响异常态提示，不影响主流程功能。",
    comment: "边界体验问题。",
  });
  assert.equal(
    (samples[1]?.humanReview as { agreeWithResultLevel?: unknown }).agreeWithResultLevel,
    true,
  );
});

test("submit human review handler writes item review calibration samples without raw payload", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, "remote-token", {
      itemReviews: [review({ sourceItem: "接口接入复核", tags: ["api_integration"] })],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.taskId, 88);
  assert.equal(state.body?.status, "completed");
  assert.equal(typeof state.body?.reviewId, "string");
  assert.deepEqual(state.body?.summary, {
    itemReviewCount: 1,
    riskReviewCount: 0,
    riskAgreementCount: 0,
    riskDisagreementCount: 0,
    datasetItemCount: 1,
  });
  assert.equal((await store.readStatus(String(state.body?.reviewId)))?.status, "completed");

  const samples = (
    await fs.readFile(path.join(root, "datasets", "item_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.type, "item_review_calibration");
  assert.equal(samples[0]?.itemIndex, 0);
  assert.deepEqual(samples[0]?.resultReviewItem, { item: "接口接入复核" });
  assert.deepEqual(samples[0]?.humanReview, {
    sourceItem: "接口接入复核",
    humanVerdict: "confirmed_issue",
    correctedAssessment: "生成代码使用本地 mockData 替代真实接口请求。",
    evidence: {
      files: ["entry/src/main/ets/pages/Index.ets"],
      snippets: ["const mockData = []"],
      comment: "prompt 要求接入真实接口。",
    },
    tags: ["api_integration"],
  });
  await assert.rejects(fs.stat(path.join(root, "raw")), /ENOENT/);
});

test("submit human review handler creates distinct review ids for repeated task submissions", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });

  const first = createResponse();
  await handler(createReviewRequest(88, undefined, {}) as never, first.response as never);

  const second = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [review({ sourceItem: "接口接入复核", tags: ["api_integration"] })],
    }) as never,
    second.response as never,
  );

  assert.equal(first.state.statusCode, 200);
  assert.equal(second.state.statusCode, 200);
  assert.notEqual(first.state.body?.reviewId, second.state.body?.reviewId);
  assert.equal((await store.readStatus(String(first.state.body?.reviewId)))?.status, "completed");
  assert.equal((await store.readStatus(String(second.state.body?.reviewId)))?.status, "completed");
});

test("submit human review handler does not require token authentication", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [review({ sourceItem: "接口接入复核", tags: ["api_integration"] })],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.taskId, 88);
});

test("submit human review handler rejects running, missing, and invalid risk requests", async (t) => {
  const { registry } = await writeCompletedTask(t, { status: "running" });
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });

  const invalid = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      riskReviews: [{ riskIndex: 0, agreeWithResultLevel: false, resultLevel: "medium" }],
    }) as never,
    invalid.response as never,
  );
  assert.equal(invalid.state.statusCode, 400);

  const running = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [review({})],
    }) as never,
    running.response as never,
  );
  assert.equal(running.state.statusCode, 409);

  const missing = createResponse();
  await handler(
    createReviewRequest(999, undefined, {
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
    summary: {
      itemReviewCount: 1,
      riskReviewCount: 0,
      riskAgreementCount: 0,
      riskDisagreementCount: 0,
      datasetItemCount: 1,
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
  const humanReviewDefinition = API_DEFINITIONS.find(
    (definition) => definition.method === "POST" && definition.path === API_PATHS.humanReview,
  );
  assert.ok(humanReviewDefinition);
  assert.equal(
    Object.hasOwn(humanReviewDefinition.request?.body?.properties ?? {}, "itemReviews"),
    true,
  );
  assert.equal(
    Object.hasOwn(humanReviewDefinition.request?.body?.properties ?? {}, "riskReviews"),
    true,
  );
  assert.equal(
    Object.hasOwn(humanReviewDefinition.responses[0]?.body.properties ?? {}, "summary"),
    true,
  );
});
