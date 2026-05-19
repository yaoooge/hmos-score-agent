# Result Analysis Manual Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted manual analysis status controls to the result analysis human rating gap and risk item tables, with risk item analysis limited to human-disagreed rows.

**Architecture:** Extend the existing file-backed dashboard datasets with inline `manualAnalysisStatus` and `manualAnalyzedAt` fields. Add backend normalization, filtering, and batch rewrite endpoints, then wire the Vue page to select rows, filter by status, and call the new batch APIs. Keep risk review agreement filtering explicit: the page requests `agreement=disagreed`.

**Tech Stack:** TypeScript, Express, Node `node:test`, Vue 3, Element Plus, JSONL file-backed stores.

---

## File Map

- `tests/dashboard-api.test.ts`: backend API regression tests for default status, filtering, batch updates, invalid payloads, and risk skipped rows.
- `src/dashboard/dashboardTypes.ts`: shared manual status type and extended dashboard item types.
- `src/dashboard/dashboardDataStore.ts`: JSONL normalization and batch rewrite helpers.
- `src/dashboard/dashboardAggregates.ts`: status filtering for both analysis datasets.
- `src/dashboard/dashboardHandlers.ts`: request validation and new PATCH routes.
- `web/src/api/dashboard.ts`: frontend response fields and PATCH client functions.
- `web/src/pages/ResultAnalysis.vue`: selection, status filters, status columns, batch actions, and disagreed-only risk loading.
- `src/api/apiDefinitions.ts`: dashboard path constants for new PATCH routes.

## Task 1: Backend Tests

**Files:**
- Modify: `tests/dashboard-api.test.ts`

- [ ] **Step 1: Write failing tests for manual analysis status**

Add tests after the existing dashboard analysis tests:

```ts
test("dashboard human rating gaps expose default manual analysis status and filter by status", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const all = await getJson(app, "/dashboard/analysis/human-rating-gaps");
  assert.equal((all.items as Array<Record<string, unknown>>)[0]?.manualAnalysisStatus, "pending");
  assert.equal((all.items as Array<Record<string, unknown>>)[1]?.manualAnalysisStatus, "pending");

  const analyzedBefore = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=analyzed",
  );
  assert.equal(analyzedBefore.total, 0);

  const invalid = await invokeExpressGet(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=unknown",
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /manualAnalysisStatus must be one of pending, analyzed/);
});

test("dashboard human rating gaps batch update persists manual analysis status", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const update = await invokeExpressPatch(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [88], status: "analyzed" },
  );
  assert.equal(update.statusCode, 200);
  const updateBody = JSON.parse(update.body) as Record<string, unknown>;
  assert.equal(updateBody.updated, 1);
  assert.deepEqual(updateBody.missing, []);

  const analyzed = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=analyzed",
  );
  assert.equal(analyzed.total, 1);
  const item = (analyzed.items as Array<Record<string, unknown>>)[0];
  assert.equal(item?.taskId, 88);
  assert.equal(item?.manualAnalysisStatus, "analyzed");
  assert.equal(typeof item?.manualAnalyzedAt, "string");

  const reset = await invokeExpressPatch(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [88, 999], status: "pending" },
  );
  assert.equal(reset.statusCode, 200);
  const resetBody = JSON.parse(reset.body) as Record<string, unknown>;
  assert.equal(resetBody.updated, 1);
  assert.deepEqual(resetBody.missing, [{ taskId: 999 }]);

  const pending = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?manualAnalysisStatus=pending",
  );
  const resetItem = (pending.items as Array<Record<string, unknown>>).find(
    (row) => row.taskId === 88,
  );
  assert.equal(resetItem?.manualAnalysisStatus, "pending");
  assert.equal(Object.hasOwn(resetItem ?? {}, "manualAnalyzedAt"), false);
});

test("dashboard risk review manual status updates only disagreed rows", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const disagreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed",
  );
  assert.equal(disagreed.total, 1);
  assert.equal((disagreed.items as Array<Record<string, unknown>>)[0]?.manualAnalysisStatus, "pending");

  const update = await invokeExpressPatch(
    app,
    "/dashboard/analysis/risk-review-calibrations/manual-analysis-status",
    {
      items: [
        { taskId: 88, riskId: 1 },
        { taskId: 89, riskId: 2 },
        { taskId: 999, riskId: 1 },
      ],
      status: "analyzed",
    },
  );
  assert.equal(update.statusCode, 200);
  const updateBody = JSON.parse(update.body) as Record<string, unknown>;
  assert.equal(updateBody.updated, 1);
  assert.deepEqual(updateBody.missing, [{ taskId: 999, riskId: 1 }]);
  assert.deepEqual(updateBody.skipped, [{ taskId: 89, riskId: 2, reason: "not_disagreed" }]);

  const analyzed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed&manualAnalysisStatus=analyzed",
  );
  assert.equal(analyzed.total, 1);
  const analyzedItem = (analyzed.items as Array<Record<string, unknown>>)[0];
  assert.equal(analyzedItem?.taskId, 88);
  assert.equal(analyzedItem?.manualAnalysisStatus, "analyzed");
  assert.equal(typeof analyzedItem?.manualAnalyzedAt, "string");

  const agreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=agreed",
  );
  const agreedItem = (agreed.items as Array<Record<string, unknown>>)[0];
  assert.equal(agreedItem?.manualAnalysisStatus, "pending");
});

test("dashboard manual status batch endpoints validate payloads", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const emptyGap = await invokeExpressPatch(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [], status: "analyzed" },
  );
  assert.equal(emptyGap.statusCode, 400);
  assert.match(emptyGap.body, /taskIds must be a non-empty array of positive integers/);

  const invalidGapStatus = await invokeExpressPatch(
    app,
    "/dashboard/analysis/human-rating-gaps/manual-analysis-status",
    { taskIds: [88], status: "done" },
  );
  assert.equal(invalidGapStatus.statusCode, 400);
  assert.match(invalidGapStatus.body, /status must be one of pending, analyzed/);

  const emptyRisk = await invokeExpressPatch(
    app,
    "/dashboard/analysis/risk-review-calibrations/manual-analysis-status",
    { items: [], status: "pending" },
  );
  assert.equal(emptyRisk.statusCode, 400);
  assert.match(emptyRisk.body, /items must be a non-empty array/);
});
```

Also add the helper near `invokeExpressGet`:

```ts
async function invokeExpressPatch(
  app: Express,
  url: string,
  body: unknown,
): Promise<{ statusCode: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const req = new Request(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const chunks: Buffer[] = [];
    const res = new Response({
      write(chunk: Buffer | string) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      end(chunk?: Buffer | string) {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks).toString("utf-8") });
        return res;
      },
    });
    app.handle(req, res, reject);
  });
}
```

- [ ] **Step 2: Run tests to verify red**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: FAIL because `manualAnalysisStatus` filtering and PATCH endpoints are not implemented.

## Task 2: Backend Implementation

**Files:**
- Modify: `src/dashboard/dashboardTypes.ts`
- Modify: `src/dashboard/dashboardDataStore.ts`
- Modify: `src/dashboard/dashboardAggregates.ts`
- Modify: `src/dashboard/dashboardHandlers.ts`
- Modify: `src/api/apiDefinitions.ts`
- Test: `tests/dashboard-api.test.ts`

- [ ] **Step 1: Add types and dataset update helpers**

Implement:

```ts
export type ManualAnalysisStatus = "pending" | "analyzed";
```

Add optional `manualAnalysisStatus?: ManualAnalysisStatus` and `manualAnalyzedAt?: string` to both dashboard item types.

In `dashboardDataStore.ts`, add a normalizer:

```ts
function normalizeManualAnalysisStatus(value: unknown): ManualAnalysisStatus {
  return value === "analyzed" ? "analyzed" : "pending";
}
```

Return normalized fields from both JSONL readers.

Add two exported update functions:

```ts
export async function updateHumanRatingGapManualAnalysisStatus(
  root: string,
  taskIds: number[],
  status: ManualAnalysisStatus,
  nowIso = new Date().toISOString(),
): Promise<{ updated: number; missing: Array<{ taskId: number }> }>;

export async function updateRiskReviewManualAnalysisStatus(
  root: string,
  items: Array<{ taskId: number; riskId: number }>,
  status: ManualAnalysisStatus,
  nowIso = new Date().toISOString(),
): Promise<{
  updated: number;
  missing: Array<{ taskId: number; riskId: number }>;
  skipped: Array<{ taskId: number; riskId: number; reason: "not_disagreed" }>;
}>;
```

Both functions read the target JSONL file, preserve invalid JSON lines unchanged, rewrite matching records, set `manualAnalyzedAt` only for `analyzed`, and remove it for `pending`.

- [ ] **Step 2: Add filters and handlers**

In `dashboardAggregates.ts`, extend both filter query types with `manualAnalysisStatus?: ManualAnalysisStatus` and filter normalized row values.

In `dashboardHandlers.ts`:

- Add `MANUAL_ANALYSIS_STATUSES = new Set(["pending", "analyzed"])`.
- Validate `manualAnalysisStatus` on both list routes.
- Pass it into filter helpers.
- Add PATCH handlers for both new endpoints.
- Validate request bodies without Zod, matching local handler style.

In `apiDefinitions.ts`, add path constants for:

```ts
dashboardAnalysisHumanRatingGapManualStatus: "/dashboard/analysis/human-rating-gaps/manual-analysis-status"
dashboardAnalysisRiskReviewManualStatus: "/dashboard/analysis/risk-review-calibrations/manual-analysis-status"
```

- [ ] **Step 3: Run backend tests to verify green**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit backend**

Run:

```bash
git add tests/dashboard-api.test.ts src/dashboard/dashboardTypes.ts src/dashboard/dashboardDataStore.ts src/dashboard/dashboardAggregates.ts src/dashboard/dashboardHandlers.ts src/api/apiDefinitions.ts
git commit -m "feat: persist manual analysis status"
```

## Task 3: Frontend Tests Via Type Build

**Files:**
- Modify: `web/src/api/dashboard.ts`
- Modify: `web/src/pages/ResultAnalysis.vue`

- [ ] **Step 1: Implement frontend API and UI**

In `web/src/api/dashboard.ts`:

- Add `ManualAnalysisStatus` type.
- Add status fields to `HumanRatingGap` and `RiskReviewCalibration`.
- Add `patchJson`.
- Add `updateHumanRatingGapManualAnalysisStatus`.
- Add `updateRiskReviewManualAnalysisStatus`.

In `ResultAnalysis.vue`:

- Add status filters to gap and risk toolbars.
- Add selection columns.
- Add status columns.
- Add batch buttons.
- Remove risk agreement selector.
- Always pass `agreement: "disagreed"` in `loadRiskReviews`.
- Pass `manualAnalysisStatus` for both lists when selected.
- Disable batch buttons when no rows are selected.
- Reload current table after successful batch update.

- [ ] **Step 2: Run web build**

Run: `npm run build:dashboard`

Expected: PASS.

- [ ] **Step 3: Run focused backend tests again**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit frontend**

Run:

```bash
git add web/src/api/dashboard.ts web/src/pages/ResultAnalysis.vue
git commit -m "feat: add result analysis status controls"
```

## Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run TypeScript backend build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 2: Run dashboard build**

Run: `npm run build:dashboard`

Expected: PASS.

- [ ] **Step 3: Run focused dashboard API tests**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: PASS.

- [ ] **Step 4: Check worktree status**

Run: `git status --short`

Expected: clean.
