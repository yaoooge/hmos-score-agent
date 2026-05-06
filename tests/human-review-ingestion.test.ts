import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSubmitHumanReviewHandler } from "../src/api/humanReviewHandler.js";
import { API_DEFINITIONS, API_PATHS } from "../src/api/apiDefinitions.js";
import { createRemoteTaskRegistry } from "../src/api/remoteTaskRegistry.js";
import { getConfig } from "../src/config.js";
import { createHumanReviewEvidenceStore } from "../src/humanReview/humanReviewEvidenceStore.js";

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

async function writeCompletedTask(
  t: test.TestContext,
  options: { status?: "completed" | "running"; omitResultIds?: boolean } = {},
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
          ...(options.omitResultIds ? {} : { id: 1 }),
          level: "medium",
          title: "接口风险",
          description: "接口失败时缺少明确错误提示。",
          evidence: "entry/src/main/ets/pages/Index.ets: console.error(error)",
        },
        {
          ...(options.omitResultIds ? {} : { id: 2 }),
          level: "high",
          title: "主流程阻断",
          description: "核心列表无法加载。",
          evidence: "entry/src/main/ets/pages/Index.ets: return []",
        },
      ],
      human_review_items: [
        {
          ...(options.omitResultIds ? {} : { id: 1 }),
          item: "接口接入复核",
          current_assessment: "需要确认是否使用真实接口。",
          uncertainty_reason: "规则提示接口接入风险。",
          suggested_focus: "检查是否仍依赖 mockData。",
        },
      ],
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

test("human review evidence store writes datasets without extra sample ids", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await store.appendDatasetSample("item_review_calibration", {
    type: "item_review_calibration",
    taskId: 88,
    testCaseId: 188,
    itemId: 1,
    humanReview: { correctedAssessment: "不要用 mockData 替代真实接口。" },
  });

  const datasetLines = (
    await fs.readFile(path.join(root, "datasets", "item_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  const sample = JSON.parse(datasetLines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(datasetLines.length, 1);
  assert.equal(sample.taskId, 88);
  assert.equal(sample.itemId, 1);
  assert.equal(Object.hasOwn(sample, "reviewId"), false);
  assert.equal(Object.hasOwn(sample, "evidenceId"), false);
});

test("human review evidence store serializes concurrent dataset appends", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await Promise.all(
    Array.from({ length: 5 }, async (_, index) =>
      store.appendDatasetSample("item_review_calibration", {
        type: "item_review_calibration",
        taskId: 88,
        itemId: index + 1,
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
  assert.equal(Object.hasOwn(state.body ?? {}, "reviewId"), false);
  assert.deepEqual(state.body?.summary, {
    itemReviewCount: 0,
    riskReviewCount: 0,
    riskAgreementCount: 0,
    riskDisagreementCount: 0,
    datasetItemCount: 0,
  });
  await assert.rejects(
    fs.readFile(path.join(root, "datasets", "risk_review_calibrations.jsonl"), "utf-8"),
    /ENOENT/,
  );
});

test("submit human review handler writes manual risk review calibration samples by risk id", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, undefined, {
      riskReviews: [
        {
          riskId: 1,
          agreeWithResultLevel: false,
          resultLevel: "medium",
          correctedLevel: "low",
          reason: "该风险只影响异常态提示，不影响主流程功能。",
          comment: "边界体验问题。",
        },
        {
          riskId: 2,
          agreeWithResultLevel: true,
          resultLevel: "high",
        },
      ],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.status, "completed");
  assert.equal(Object.hasOwn(state.body ?? {}, "reviewId"), false);
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
  assert.equal(samples[0]?.taskId, 88);
  assert.equal(samples[0]?.testCaseId, 188);
  assert.equal(samples[0]?.riskId, 1);
  assert.equal(Object.hasOwn(samples[0] ?? {}, "reviewId"), false);
  assert.equal(Object.hasOwn(samples[0] ?? {}, "evidenceId"), false);
  assert.deepEqual(samples[0]?.resultRisk, {
    id: 1,
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

test("submit human review handler writes simplified item review calibration samples by item id", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, "remote-token", {
      itemReviews: [
        {
          itemId: 1,
          agreeWithResultAssessment: false,
          resultAssessment: "需要确认是否使用真实接口。",
          correctedAssessment: "确认使用 mockData 替代真实接口。",
          reason: "代码中存在 const mockData = []。",
          comment: "接口接入问题成立。",
        },
      ],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.equal(state.body?.success, true);
  assert.equal(state.body?.taskId, 88);
  assert.equal(state.body?.status, "completed");
  assert.equal(Object.hasOwn(state.body ?? {}, "reviewId"), false);
  assert.deepEqual(state.body?.summary, {
    itemReviewCount: 1,
    riskReviewCount: 0,
    riskAgreementCount: 0,
    riskDisagreementCount: 0,
    datasetItemCount: 1,
  });

  const samples = (
    await fs.readFile(path.join(root, "datasets", "item_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.type, "item_review_calibration");
  assert.equal(samples[0]?.taskId, 88);
  assert.equal(samples[0]?.testCaseId, 188);
  assert.equal(samples[0]?.itemId, 1);
  assert.equal(Object.hasOwn(samples[0] ?? {}, "reviewId"), false);
  assert.equal(Object.hasOwn(samples[0] ?? {}, "evidenceId"), false);
  assert.deepEqual(samples[0]?.resultReviewItem, {
    id: 1,
    item: "接口接入复核",
    current_assessment: "需要确认是否使用真实接口。",
    uncertainty_reason: "规则提示接口接入风险。",
    suggested_focus: "检查是否仍依赖 mockData。",
  });
  assert.deepEqual(samples[0]?.humanReview, {
    agreeWithResultAssessment: false,
    correctedAssessment: "确认使用 mockData 替代真实接口。",
    reason: "代码中存在 const mockData = []。",
    comment: "接口接入问题成立。",
  });
  await assert.rejects(fs.stat(path.join(root, "raw")), /ENOENT/);
});

test("submit human review handler maps legacy result review ids from array position", async (t) => {
  const { registry } = await writeCompletedTask(t, { omitResultIds: true });
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });
  const { response, state } = createResponse();

  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [
        {
          itemId: 1,
          agreeWithResultAssessment: true,
          resultAssessment: "需要确认是否使用真实接口。",
        },
      ],
      riskReviews: [
        {
          riskId: 1,
          agreeWithResultLevel: true,
          resultLevel: "medium",
        },
      ],
    }) as never,
    response as never,
  );

  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.body?.summary, {
    itemReviewCount: 1,
    riskReviewCount: 1,
    riskAgreementCount: 1,
    riskDisagreementCount: 0,
    datasetItemCount: 2,
  });

  const itemSamples = (
    await fs.readFile(path.join(root, "datasets", "item_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const riskSamples = (
    await fs.readFile(path.join(root, "datasets", "risk_review_calibrations.jsonl"), "utf-8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.equal(itemSamples[0]?.itemId, 1);
  assert.deepEqual(itemSamples[0]?.resultReviewItem, {
    id: 1,
    item: "接口接入复核",
    current_assessment: "需要确认是否使用真实接口。",
    uncertainty_reason: "规则提示接口接入风险。",
    suggested_focus: "检查是否仍依赖 mockData。",
  });
  assert.equal(riskSamples[0]?.riskId, 1);
  assert.deepEqual(riskSamples[0]?.resultRisk, {
    id: 1,
    level: "medium",
    title: "接口风险",
    description: "接口失败时缺少明确错误提示。",
    evidence: "entry/src/main/ets/pages/Index.ets: console.error(error)",
  });
});

test("submit human review handler rejects duplicate ids and stale result values", async (t) => {
  const { registry } = await writeCompletedTask(t);
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });

  const duplicateItem = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [
        { itemId: 1, agreeWithResultAssessment: true, resultAssessment: "需要确认是否使用真实接口。" },
        { itemId: 1, agreeWithResultAssessment: true, resultAssessment: "需要确认是否使用真实接口。" },
      ],
    }) as never,
    duplicateItem.response as never,
  );
  assert.equal(duplicateItem.state.statusCode, 400);

  const duplicateRisk = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      riskReviews: [
        { riskId: 1, agreeWithResultLevel: true, resultLevel: "medium" },
        { riskId: 1, agreeWithResultLevel: true, resultLevel: "medium" },
      ],
    }) as never,
    duplicateRisk.response as never,
  );
  assert.equal(duplicateRisk.state.statusCode, 400);

  const staleItem = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [{ itemId: 1, agreeWithResultAssessment: true, resultAssessment: "过期判断" }],
    }) as never,
    staleItem.response as never,
  );
  assert.equal(staleItem.state.statusCode, 409);

  const staleRisk = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      riskReviews: [{ riskId: 1, agreeWithResultLevel: true, resultLevel: "high" }],
    }) as never,
    staleRisk.response as never,
  );
  assert.equal(staleRisk.state.statusCode, 409);
});

test("submit human review handler rejects running, missing, and invalid review requests", async (t) => {
  const { registry } = await writeCompletedTask(t, { status: "running" });
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);
  const handler = createSubmitHumanReviewHandler({ registry, store });

  const invalidRisk = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      riskReviews: [{ riskId: 1, agreeWithResultLevel: false, resultLevel: "medium" }],
    }) as never,
    invalidRisk.response as never,
  );
  assert.equal(invalidRisk.state.statusCode, 400);

  const invalidItem = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [
        {
          itemId: 1,
          agreeWithResultAssessment: false,
          resultAssessment: "需要确认是否使用真实接口。",
        },
      ],
    }) as never,
    invalidItem.response as never,
  );
  assert.equal(invalidItem.state.statusCode, 400);

  const running = createResponse();
  await handler(
    createReviewRequest(88, undefined, {
      itemReviews: [{ itemId: 1, agreeWithResultAssessment: true, resultAssessment: "需要确认是否使用真实接口。" }],
    }) as never,
    running.response as never,
  );
  assert.equal(running.state.statusCode, 409);

  const missing = createResponse();
  await handler(
    createReviewRequest(999, undefined, {
      itemReviews: [{ itemId: 1, agreeWithResultAssessment: true, resultAssessment: "需要确认是否使用真实接口。" }],
    }) as never,
    missing.response as never,
  );
  assert.equal(missing.state.statusCode, 404);
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

test("api definitions document human review submission endpoint", () => {
  assert.equal(API_PATHS.humanReview, "/score/remote-tasks/:taskId/human-review");
  assert.equal(
    API_DEFINITIONS.some(
      (definition) => definition.method === "POST" && definition.path === API_PATHS.humanReview,
    ),
    true,
  );
  assert.equal(
    API_DEFINITIONS.some(
      (definition) => definition.path === "/score/human-reviews/:reviewId",
    ),
    false,
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
  assert.equal(
    Object.hasOwn(humanReviewDefinition.responses[0]?.body.properties ?? {}, "reviewId"),
    false,
  );
});
