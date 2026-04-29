# Human Review Risk Review Simplified Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first-version `/score/remote-tasks/:taskId/human-review` protocol for item and risk reviews, with risk review calibration JSONL output and no automatic result-risk ingestion.

**Architecture:** Keep the implementation small and API-centered. The submit handler reads the completed task result, validates the first-version payload, writes the raw review record, appends risk review calibration samples for manually submitted `riskReviews`, writes a completed status, and returns a synchronous summary. Existing `HumanReviewIngestionNode` remains available for `itemReviews`, but result risks are never automatically ingested when a remote task completes.

**Tech Stack:** TypeScript, Express handler functions, filesystem-backed `HumanReviewEvidenceStore`, Node test runner with `node --import tsx --test`.

---

## File Structure

- Modify `src/humanReview/humanReviewTypes.ts`
  - Add `HumanRiskLevel = "high" | "medium" | "low" | "none"`.
  - Add `HumanRiskReview` with `riskIndex`, `agreeWithResultLevel`, `resultLevel`, optional `correctedLevel`, `reason`, and `comment`.
  - Update `HumanReviewSubmissionPayload` so `overallDecision` is absent and `itemReviews` / `riskReviews` are optional.
  - Add `risk_review_calibration` to `HumanReviewDatasetType`.
- Modify `src/humanReview/humanReviewEvidenceStore.ts`
  - Add `risk_review_calibration: "risk_review_calibrations.jsonl"` to dataset filenames.
- Modify `src/api/humanReviewHandler.ts`
  - Remove overall decision validation.
  - Allow missing or empty `itemReviews` and `riskReviews`.
  - Validate `riskReviews` against `resultJson.risks` after reading the result file.
  - Append one calibration JSONL sample per submitted risk review.
  - Write status `completed` synchronously and return a summary.
- Modify `src/api/apiDefinitions.ts`
  - Document the first-version payload with optional `itemReviews` / `riskReviews` and no overall decision.
  - Document `high | medium | low | none` risk levels.
- Modify `src/api/app.ts`
  - Remove imports and callback wiring for automatic result risk ingestion.
- Delete `src/humanReview/resultRiskIngestionNode.ts`, `src/humanReview/resultRiskRebuild.ts`, and `src/tools/rebuildResultRiskEvidence.ts`.
- Modify `tests/human-review-ingestion.test.ts`
  - Add first-version handler tests.
  - Remove result risk ingestion / rebuild tests and imports.
  - Update existing submit handler tests to the synchronous completed behavior.

---

### Task 1: Add First-Version Submit Handler Tests

**Files:**
- Modify: `tests/human-review-ingestion.test.ts`
- Test: `tests/human-review-ingestion.test.ts`

- [ ] **Step 1: Write failing tests for empty payload and manual risk review dataset**

Add or update the completed-task fixture so `result.json.risks` contains first-version levels:

```ts
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
```

Add these tests near the submit handler tests:

```ts
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

  const samples = (await fs.readFile(path.join(root, "datasets", "risk_review_calibrations.jsonl"), "utf-8"))
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
  assert.equal((samples[1]?.humanReview as { agreeWithResultLevel?: unknown }).agreeWithResultLevel, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/human-review-ingestion.test.ts`

Expected: FAIL because current handler requires `overallDecision` / non-empty `itemReviews` and does not write `risk_review_calibrations.jsonl`.

---

### Task 2: Implement First-Version Payload Types and Store Dataset

**Files:**
- Modify: `src/humanReview/humanReviewTypes.ts`
- Modify: `src/humanReview/humanReviewEvidenceStore.ts`
- Test: `tests/human-review-ingestion.test.ts`

- [ ] **Step 1: Update types**

In `src/humanReview/humanReviewTypes.ts`, add:

```ts
export type HumanRiskLevel = "high" | "medium" | "low" | "none";

export type HumanRiskReview = {
  riskIndex: number;
  agreeWithResultLevel: boolean;
  resultLevel: HumanRiskLevel;
  correctedLevel?: HumanRiskLevel;
  reason?: string;
  comment?: string;
};
```

Change `HumanReviewSubmissionPayload` to:

```ts
export type HumanReviewSubmissionPayload = {
  reviewer?: {
    id?: string;
    role?: string;
  };
  itemReviews?: HumanReviewItemReview[];
  riskReviews?: HumanRiskReview[];
};
```

Add dataset type:

```ts
export type HumanReviewDatasetType =
  | "item_review_calibration"
  | "risk_review_calibration";
```

- [ ] **Step 2: Add dataset file mapping**

In `src/humanReview/humanReviewEvidenceStore.ts`, update `DATASET_FILE_NAMES`:

```ts
const DATASET_FILE_NAMES: Record<HumanReviewDatasetType, string> = {
  item_review_calibration: "item_review_calibrations.jsonl",
  risk_review_calibration: "risk_review_calibrations.jsonl",
};
```

- [ ] **Step 3: Run tests to verify remaining failures**

Run: `node --import tsx --test tests/human-review-ingestion.test.ts`

Expected: FAIL because handler validation and dataset writing are not implemented yet.

---

### Task 3: Implement Synchronous Human Review Handler Behavior

**Files:**
- Modify: `src/api/humanReviewHandler.ts`
- Test: `tests/human-review-ingestion.test.ts`

- [ ] **Step 1: Replace payload validation**

In `src/api/humanReviewHandler.ts`:

- Remove `OVERALL_DECISIONS`.
- Keep `HUMAN_VERDICTS` for provided `itemReviews`.
- Add `RISK_LEVELS`:

```ts
const RISK_LEVELS = new Set(["high", "medium", "low", "none"]);
```

Change `parseSubmissionPayload` so it:

- Accepts any object body.
- Normalizes missing `itemReviews` to `[]`.
- Normalizes missing `riskReviews` to `[]`.
- Validates provided arrays only when present.
- Validates `itemReviews` entries with existing `humanVerdict` and `correctedAssessment` checks.
- Validates `riskReviews` entries for `riskIndex`, `agreeWithResultLevel`, `resultLevel`, and conditional `correctedLevel` / `reason`.

Use this return shape:

```ts
return {
  reviewer: candidate.reviewer,
  itemReviews,
  riskReviews,
};
```

- [ ] **Step 2: Validate risk reviews after loading result JSON**

Add helper functions:

```ts
type NormalizedResultRisk = {
  level: string;
  title: string;
  description: string;
  evidence: string;
};

function readResultRisks(resultJson: Record<string, unknown>): NormalizedResultRisk[] {
  if (!Array.isArray(resultJson.risks)) {
    return [];
  }
  return resultJson.risks.map((item) => {
    const risk = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    return {
      level: readString(risk.level) ?? "",
      title: readString(risk.title) ?? "",
      description: readString(risk.description) ?? "",
      evidence: readString(risk.evidence) ?? "",
    };
  });
}
```

After `resultJson` is read, validate each risk review:

- `riskIndex` must point to an existing risk.
- `resultLevel` must equal that risk's `level`.
- Invalid index returns `400`.
- Mismatched level returns `409`.

- [ ] **Step 3: Append risk review calibration samples**

Add a helper in `src/api/humanReviewHandler.ts`:

```ts
async function appendRiskReviewCalibrationSamples(input: {
  store: HumanReviewEvidenceStore;
  reviewId: string;
  taskId: number;
  testCaseId?: number;
  resultJson: Record<string, unknown>;
  payload: HumanReviewSubmissionPayload;
}): Promise<number> {
  const risks = readResultRisks(input.resultJson);
  let count = 0;
  for (const review of input.payload.riskReviews ?? []) {
    const risk = risks[review.riskIndex];
    if (!risk) {
      continue;
    }
    await input.store.appendDatasetSample("risk_review_calibration", {
      type: "risk_review_calibration",
      reviewId: input.reviewId,
      evidenceId: `${input.reviewId}-risk-${String(review.riskIndex + 1)}`,
      taskId: input.taskId,
      testCaseId: input.testCaseId,
      riskIndex: review.riskIndex,
      taskSummary: [readCaseId(input.resultJson), readTaskType(input.resultJson)]
        .filter((item): item is string => typeof item === "string" && item.length > 0)
        .join(" | "),
      resultRisk: risk,
      humanReview: {
        agreeWithResultLevel: review.agreeWithResultLevel,
        correctedLevel: review.correctedLevel,
        reason: review.reason,
        comment: review.comment,
      },
    });
    count += 1;
  }
  return count;
}
```

- [ ] **Step 4: Update response and status**

Implement synchronous behavior in `createSubmitHumanReviewHandler`:

- Write status `completed` after item/risk dataset append; do not write a full raw payload record.
- Return `status: "completed"`, `summary`, and no `classificationStatus`.

Summary:

```ts
const riskReviews = payload.riskReviews ?? [];
const riskAgreementCount = riskReviews.filter((item) => item.agreeWithResultLevel).length;
const riskDisagreementCount = riskReviews.length - riskAgreementCount;
const datasetItemCount = await appendRiskReviewCalibrationSamples(...);
```

Status `summary`:

```ts
summary: {
  rawItemCount: (payload.itemReviews ?? []).length + riskReviews.length,
  eligibleItemCount: (payload.itemReviews ?? []).length + riskReviews.length,
  filteredItemCount: 0,
  datasetItemCount,
  positive: 0,
  negative: 0,
  neutral: (payload.itemReviews ?? []).length + riskReviews.length,
}
```

- [ ] **Step 5: Run tests to verify new behavior passes**

Run: `node --import tsx --test tests/human-review-ingestion.test.ts`

Expected: first-version submit tests PASS.

---

### Task 4: Remove Automatic Result Risk Ingestion Code

**Files:**
- Modify: `src/api/app.ts`
- Delete: `src/humanReview/resultRiskIngestionNode.ts`
- Delete: `src/humanReview/resultRiskRebuild.ts`
- Delete: `src/tools/rebuildResultRiskEvidence.ts`
- Modify: `tests/human-review-ingestion.test.ts`
- Test: `tests/human-review-ingestion.test.ts`

- [ ] **Step 1: Remove automatic ingestion imports and callback**

In `src/api/app.ts`, delete:

```ts
import {
  buildResultRiskReviewId,
  runResultRiskIngestionNode,
} from "../humanReview/resultRiskIngestionNode.js";
```

Inside `executeRemoteTask`, remove the `onCompletedCallbackUploaded` property passed to `deps.executeAcceptedRemoteEvaluationTask`. Keep `onCompleted` for rule violation stats unchanged.

- [ ] **Step 2: Delete result risk ingestion files**

Remove these files:

```text
src/humanReview/resultRiskIngestionNode.ts
src/humanReview/resultRiskRebuild.ts
src/tools/rebuildResultRiskEvidence.ts
```

- [ ] **Step 3: Update tests**

In `tests/human-review-ingestion.test.ts`:

- Remove imports for `runResultRiskIngestionNode` and `rebuildResultRiskEvidenceFromLocalCases`.
- Remove tests named:
  - `result risk ingestion appends agent-discovered risks as negative diagnostics`
  - `result risk ingestion skips risks without code evidence`
  - `result risk rebuild ingests historical local case result risks idempotently`
- Update submit handler tests to assert `status: "completed"` and direct dataset generation.
- Remove tests for unused item review ingestion helpers because item review data is generated directly by the submit API.

- [ ] **Step 4: Add regression check for no automatic result risk dataset**

If there is an existing app-level remote execution callback test, update it to assert that completing a remote task with non-empty `resultJson.risks` does not write `risk_review_calibrations.jsonl`. If no focused app-level test exists, rely on import deletion plus TypeScript build to prevent callback wiring from compiling.

- [ ] **Step 5: Run targeted tests**

Run: `node --import tsx --test tests/human-review-ingestion.test.ts`

Expected: PASS.

---

### Task 5: Update API Documentation and Spec Details

**Files:**
- Modify: `src/api/apiDefinitions.ts`
- Modify: `docs/superpowers/specs/2026-04-29-human-review-risk-review-simplified-spec.md`
- Test: `tests/human-review-ingestion.test.ts`

- [ ] **Step 1: Update API definitions**

In the `API_DEFINITIONS` entry for `API_PATHS.humanReview`:

- Remove `overallDecision` from request body properties.
- Keep `itemReviews` as optional.
- Add `riskReviews` as optional.
- Document `riskReviews[].agreeWithResultLevel`, `riskReviews[].resultLevel`, `riskReviews[].correctedLevel`, `riskReviews[].reason`, and `riskReviews[].comment`.
- Update response properties to include `summary` and `status: "completed"`; remove `classificationStatus`.

- [ ] **Step 2: Update API definition test if needed**

Keep the existing endpoint path assertions. If a test asserts request body fields, update it so no `overallDecision` is required and `riskReviews` is documented.

- [ ] **Step 3: Run API-related tests**

Run: `node --import tsx --test tests/human-review-ingestion.test.ts tests/remote-network-execution.test.ts`

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- All modified source, tests, and docs.

- [ ] **Step 1: Run focused human review tests**

Run: `node --import tsx --test tests/human-review-ingestion.test.ts`

Expected: PASS with all human review tests passing.

- [ ] **Step 2: Run TypeScript build**

Run: `npm run build`

Expected: PASS with no missing imports from deleted files.

- [ ] **Step 3: Run full test suite if build passes**

Run: `npm test`

Expected: PASS. If unrelated tests fail, capture the failing test names and error output without changing unrelated code.

- [ ] **Step 4: Review git diff**

Run: `git diff --stat && git diff -- src tests docs/superpowers/specs docs/superpowers/plans`

Expected: Diff only contains the human review first-version protocol, risk review dataset support, automatic result risk ingestion removal, docs, and tests.

---

## Self-Review

- Spec coverage: The plan covers first-version payload shape, optional `itemReviews` and `riskReviews`, `high | medium | low | none` risk levels, disagreement reason requirements, calibration JSONL output, no new node, status simplification, and removal of automatic result risk ingestion code.
- Placeholder scan: No `TBD`, `TODO`, vague “handle edge cases”, or unresolved helper names remain.
- Type consistency: The plan consistently uses `agreeWithResultLevel`, `resultLevel`, `correctedLevel`, `risk_review_calibration`, and `risk_review_calibrations.jsonl`.
