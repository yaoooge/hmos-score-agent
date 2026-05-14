# Result Analysis Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API-backed result-analysis filters, colored task-type metrics, and a single title-bar refresh/date control pattern for dashboard task and report pages.

**Architecture:** Backend filtering lives in `dashboardAggregates.ts` with route validation in `dashboardHandlers.ts`. Vue pages keep page-local data loading but receive shared title-bar date state through route metadata callbacks owned by `App.vue`. Metric highlighting is a small prop extension to the existing `MetricCard` component.

**Tech Stack:** TypeScript, Node test runner, Express, Vue 3 Composition API, Element Plus, Vite.

---

## File Structure

- Modify `src/dashboard/dashboardAggregates.ts`: add keyword support for human rating gaps and add risk review calibration filtering.
- Modify `src/dashboard/dashboardHandlers.ts`: parse and validate new API query parameters and apply filters before pagination.
- Modify `tests/dashboard-api.test.ts`: add failing API tests for keyword/conclusion/agreement filters.
- Modify `web/src/components/MetricCard.vue`: add optional accent color support.
- Modify `web/src/App.vue`: add route-aware title-bar controls and keep one refresh button.
- Modify `web/src/pages/TaskDashboard.vue`: remove page refresh/date controls, register title-bar date control, pass accent colors to task type cards.
- Modify `web/src/pages/CaseReports.vue`: remove page refresh/date controls and register title-bar date control.
- Modify `web/src/pages/ResultAnalysis.vue`: add API-backed search/filter controls and pagination state for the gap and risk tables.
- Modify `web/src/styles/base.css`: add compact title-bar action styles if needed.

## Task 1: Backend Analysis Filters

**Files:**
- Modify: `tests/dashboard-api.test.ts`
- Modify: `src/dashboard/dashboardAggregates.ts`
- Modify: `src/dashboard/dashboardHandlers.ts`

- [ ] **Step 1: Write failing API tests**

Add these assertions to the dashboard analysis test area in `tests/dashboard-api.test.ts`:

```ts
test("dashboard human rating gaps support keyword and conclusion filters", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const byName = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?keyword=%E4%BD%8E%E5%88%86",
  );
  assert.equal(byName.total, 1);
  assert.equal((byName.items as Array<Record<string, unknown>>)[0]?.taskId, 89);

  const byTaskId = await getJson(app, "/dashboard/analysis/human-rating-gaps?keyword=88");
  assert.equal(byTaskId.total, 1);
  assert.equal((byTaskId.items as Array<Record<string, unknown>>)[0]?.caseName, "电视台云服务新增全屏播放");

  const byConclusion = await getJson(
    app,
    "/dashboard/analysis/human-rating-gaps?primaryConclusion=aligned",
  );
  assert.equal(byConclusion.total, 1);
  assert.equal((byConclusion.items as Array<Record<string, unknown>>)[0]?.taskId, 89);
});

test("dashboard risk review calibrations support keyword and agreement filters", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const byName = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?keyword=%E7%94%B5%E8%A7%86%E5%8F%B0",
  );
  assert.equal(byName.total, 1);
  assert.equal((byName.items as Array<Record<string, unknown>>)[0]?.taskId, 88);

  const disagreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=disagreed",
  );
  assert.equal(disagreed.total, 1);

  const agreed = await getJson(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=agreed",
  );
  assert.equal(agreed.total, 0);

  const invalid = await invokeExpressGet(
    app,
    "/dashboard/analysis/risk-review-calibrations?agreement=unknown",
  );
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /agreement must be one of agreed, disagreed/);
});
```

- [ ] **Step 2: Verify backend tests fail**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: FAIL because the new `keyword` and `agreement` query parameters are not implemented yet.

- [ ] **Step 3: Implement backend filtering**

In `src/dashboard/dashboardAggregates.ts`, extend `filterHumanRatingGaps` to accept `keyword`, add a helper that matches `taskId`, `testCaseId`, and `caseName`, and add:

```ts
export function filterRiskReviewCalibrations(
  items: RiskReviewCalibrationDashboardItem[],
  query: { keyword?: string; agreement?: "agreed" | "disagreed" },
) {
  const keyword = query.keyword?.trim().toLowerCase();
  return items
    .filter((item) => matchesDashboardAnalysisKeyword(item, keyword))
    .filter((item) => {
      if (!query.agreement) {
        return true;
      }
      const agreed = readHumanReviewAgreement(item.humanReview);
      return query.agreement === "agreed" ? agreed === true : agreed === false;
    });
}
```

In `src/dashboard/dashboardHandlers.ts`, import the new filter, pass `keyword` into human rating gap filtering, validate `agreement`, and filter risk review rows before pagination.

- [ ] **Step 4: Verify backend tests pass**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: PASS with 9 dashboard API tests.

- [ ] **Step 5: Commit backend filters**

Run:

```bash
git add src/dashboard/dashboardAggregates.ts src/dashboard/dashboardHandlers.ts tests/dashboard-api.test.ts
git commit -m "feat: filter dashboard analysis APIs"
```

## Task 2: Dashboard Header Controls and Metric Highlights

**Files:**
- Modify: `web/src/components/MetricCard.vue`
- Modify: `web/src/App.vue`
- Modify: `web/src/pages/TaskDashboard.vue`
- Modify: `web/src/pages/CaseReports.vue`
- Modify: `web/src/styles/base.css`

- [ ] **Step 1: Implement shared title-bar date controls**

In `web/src/App.vue`, add provide/inject state for title-bar controls:

```ts
export type DashboardTitleControls = {
  dateRange?: {
    value: [Date, Date] | null;
    onChange: (value: [Date, Date] | null) => void;
  };
};
```

Render the date picker in the right side of `.topbar` before the existing refresh button when a page registers `dateRange`.

- [ ] **Step 2: Move task dashboard date controls**

In `web/src/pages/TaskDashboard.vue`, remove the top page toolbar containing the date picker and refresh button. Register a title-bar date range control on mount and clear it on unmount. Keep the existing `dashboard:refresh` listener so the remaining title-bar refresh button still reloads data.

- [ ] **Step 3: Move case report date controls**

In `web/src/pages/CaseReports.vue`, remove the date picker and refresh button from the page toolbar. Keep the task type select in the page content toolbar. Register and clear the title-bar date range control the same way as the task dashboard.

- [ ] **Step 4: Add metric accent support**

In `web/src/components/MetricCard.vue`, add:

```ts
const props = defineProps<{
  label: string;
  value: string | number;
  accent?: string;
}>();
```

Bind the accent as `--metric-accent` on the card and use it for `.metric-value`.

In `TaskDashboard.vue`, map task type strings to a stable palette index and pass `:accent="item.accent"` to task type metric cards.

- [ ] **Step 5: Verify dashboard type-check/build once dependencies are available**

Run: `npm run build:dashboard`

Expected: PASS. If `web/node_modules` is missing in the worktree, use the existing main checkout dependency tree temporarily for local verification, then remove any untracked symlink before committing.

- [ ] **Step 6: Commit header controls and metric highlights**

Run:

```bash
git add web/src/components/MetricCard.vue web/src/App.vue web/src/pages/TaskDashboard.vue web/src/pages/CaseReports.vue web/src/styles/base.css
git commit -m "feat: refine dashboard header controls"
```

## Task 3: Result Analysis Frontend Filters

**Files:**
- Modify: `web/src/pages/ResultAnalysis.vue`
- Modify: `web/src/api/dashboard.ts` if stricter parameter types are needed.

- [ ] **Step 1: Add filter state and fetch functions**

In `ResultAnalysis.vue`, replace one shared `loading` flag for analysis tables with state that supports:

```ts
const gapFilters = reactive({ keyword: "", primaryConclusion: "" });
const gapPage = ref(1);
const gapPageSize = ref(20);
const gapTotal = ref(0);

const riskFilters = reactive({ keyword: "", agreement: "" as "" | "agreed" | "disagreed" });
const riskPage = ref(1);
const riskPageSize = ref(20);
const riskTotal = ref(0);
```

Add `loadGaps`, `loadRiskReviews`, and `loadNegativeResults` functions that call the matching API with the current filters and pagination.

- [ ] **Step 2: Add human rating gap controls and pagination**

Above the gap table, add a toolbar with an Element Plus input for `名称 / ID` and a clearable conclusion select. Add pagination below the table using `gapTotal`, `gapPage`, and `gapPageSize`.

- [ ] **Step 3: Add risk review controls and pagination**

Above the risk table, add a toolbar with an Element Plus input for `名称 / taskId` and a clearable agreement select with `同意` and `不同意`. Add pagination below the table using `riskTotal`, `riskPage`, and `riskPageSize`.

- [ ] **Step 4: Wire watchers**

Watch gap filters to reset `gapPage` to `1` and call `loadGaps`. Watch risk filters to reset `riskPage` to `1` and call `loadRiskReviews`. Watch page/pageSize refs to reload their table without resetting the page.

- [ ] **Step 5: Verify dashboard build**

Run: `npm run build:dashboard`

Expected: PASS.

- [ ] **Step 6: Commit result analysis frontend filters**

Run:

```bash
git add web/src/pages/ResultAnalysis.vue web/src/api/dashboard.ts
git commit -m "feat: add result analysis filters"
```

## Task 4: Final Verification

**Files:**
- No new source files.

- [ ] **Step 1: Run focused backend tests**

Run: `node --import tsx --test tests/dashboard-api.test.ts`

Expected: PASS.

- [ ] **Step 2: Run dashboard build**

Run: `npm run build:dashboard`

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run: `git status --short`

Expected: clean or only intentionally untracked local verification artifacts that are removed before final response.
