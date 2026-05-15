# Cross-Device Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the “一多适配” dashboard menu with three tabs for related cases, rule violations, and risk review rows.

**Architecture:** Add dashboard-only cross-device data readers and aggregators that derive the related task set from `intermediate/constraint-summary.json`. Expose three read-only `/dashboard/cross-device/*` API endpoints, then add a Vue page using Element Plus tabs, tables, filters, pagination, and a details drawer.

**Tech Stack:** TypeScript, Express, Node test runner, Vue 3, Vue Router, Element Plus, Vite.

---

## File Structure

- Create `src/dashboard/crossDeviceTypes.ts`: dashboard-only TypeScript types for cross-device related tasks, case list rows, rule violation rows, and query shapes.
- Create `src/dashboard/crossDeviceDataStore.ts`: file readers for `constraint-summary.json`, `result.json`, official linter results, and risk review dataset filtering.
- Create `src/dashboard/crossDeviceAggregates.ts`: pure filtering, sorting, pagination preparation, and rule violation aggregation helpers.
- Modify `src/dashboard/dashboardHandlers.ts`: add request parsing and mount three `/dashboard/cross-device/*` routes.
- Modify `src/api/apiDefinitions.ts`: add constants for the three dashboard endpoints.
- Modify `tests/dashboard-api.test.ts`: add fixture data and API assertions for one-to-many cases, rule violations, and risk reviews.
- Modify `web/src/api/dashboard.ts`: add response types and fetchers.
- Create `web/src/pages/CrossDeviceAnalysis.vue`: tabbed UI with case list, rule violations, risk review table, and details drawer.
- Modify `web/src/router/index.ts`: add `/cross-device` route.
- Modify `web/src/App.vue`: add menu item, icon import, title, and subtitle.

## Task 1: Backend API Tests

**Files:**
- Modify: `tests/dashboard-api.test.ts`

- [ ] **Step 1: Add fixture data**

Extend `createFixture()` with at least three completed tasks:

```ts
await writeJson(path.join(crossDeviceCaseDir, "intermediate", "constraint-summary.json"), {
  explicitConstraints: ["目标: 手机和平板一多适配"],
  contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
  implicitConstraints: ["修改范围: 涉及页面布局"],
  classificationHints: ["full_generation", "multi_device_adaptation"],
  crossDeviceAdaptation: {
    applicability: "involved",
    confidence: "high",
    reasons: ["需求明确要求手机和平板布局适配"],
  },
});

await writeJson(path.join(crossDeviceCaseDir, "outputs", "result.json"), {
  basic_info: { case_name: "手机平板一多适配用例", task_type: "full_generation" },
  overall_conclusion: { total_score: 72, hard_gate_triggered: false },
  risks: [{ id: 1, level: "high", title: "布局风险" }],
  official_linter_summary: {
    configuredRuleSets: ["plugin:@cross-device-app-dev/recommended"],
    effectiveFindingCount: 2,
    runStatus: "success",
    durationMs: 12,
  },
  official_linter_results: [
    {
      rule_id: "@cross-device-app-dev/font-size",
      rule_result_id: "OFFICIAL-LINTER:@cross-device-app-dev/font-size",
      source_rule_set: "plugin:@cross-device-app-dev/recommended",
      severity: "warn",
      result: "不满足",
      finding_count: 2,
      findings: [],
      conclusion: "字号未适配多设备。",
      score_delta: -1.2,
      affected_items: [],
    },
  ],
  rule_audit_results: [
    {
      rule_id: "ARKTS-MUST-001",
      rule_summary: "必须遵循 ArkTS 语言约束",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "存在 ArkTS 规则违背。",
    },
  ],
});
```

Also add a non-related task with `crossDeviceAdaptation.applicability: "not_involved"` and a task missing `constraint-summary.json`; both must be excluded from cross-device APIs.

- [ ] **Step 2: Add case endpoint test**

Add a test named:

```ts
test("dashboard cross-device cases list only involved tasks and support keyword filters", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(app, "/dashboard/cross-device/cases?keyword=%E4%B8%80%E5%A4%9A");
  assert.equal(response.success, true);
  assert.equal(response.total, 1);
  const items = response.items as Array<Record<string, unknown>>;
  assert.equal(items[0]?.name, "手机平板一多适配用例");
  assert.equal(items[0]?.crossDeviceRuleSetApplied, true);
  assert.equal(items[0]?.crossDeviceFindingCount, 2);
});
```

- [ ] **Step 3: Add rule violation endpoint test**

Add a test named:

```ts
test("dashboard cross-device rule violations aggregate related official rules", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(app, "/dashboard/cross-device/rule-violations");
  assert.equal(response.success, true);
  const items = response.items as Array<Record<string, unknown>>;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.ruleId, "@cross-device-app-dev/font-size");
  assert.equal(items[0]?.violationCount, 2);

  const withOtherRules = await getJson(
    app,
    "/dashboard/cross-device/rule-violations?includeOtherRules=true",
  );
  const allItems = withOtherRules.items as Array<Record<string, unknown>>;
  assert.ok(allItems.some((item) => item.ruleId === "ARKTS-MUST-001"));
});
```

- [ ] **Step 4: Add risk review endpoint test**

Add a test named:

```ts
test("dashboard cross-device risk reviews filter to involved tasks", async (t) => {
  const fixture = await createFixture(t);
  const app = createDashboardTestApp(fixture);

  const response = await getJson(
    app,
    "/dashboard/cross-device/risk-review-calibrations?riskLevel=high",
  );
  assert.equal(response.success, true);
  assert.equal(response.total, 1);
  const items = response.items as Array<Record<string, unknown>>;
  assert.equal(items[0]?.caseName, "手机平板一多适配用例");
});
```

- [ ] **Step 5: Run tests and verify RED**

Run:

```bash
node --import tsx --test tests/dashboard-api.test.ts
```

Expected: FAIL because `/dashboard/cross-device/*` routes do not exist.

## Task 2: Backend Implementation

**Files:**
- Create: `src/dashboard/crossDeviceTypes.ts`
- Create: `src/dashboard/crossDeviceDataStore.ts`
- Create: `src/dashboard/crossDeviceAggregates.ts`
- Modify: `src/dashboard/dashboardHandlers.ts`
- Modify: `src/api/apiDefinitions.ts`

- [ ] **Step 1: Add cross-device types**

Create focused types for related tasks and response rows. Keep runtime parsing in data store helpers rather than trusting JSON shape.

- [ ] **Step 2: Implement data readers**

Implement helpers that:

- read `outputs/result.json` with per-task `ENOENT` tolerance
- read `intermediate/constraint-summary.json`
- include only `crossDeviceAdaptation.applicability === "involved"`
- extract official linter status, configured rule set flag, finding count, top rules, risks, and reasons
- read `risk_review_calibrations.jsonl` and filter by related `taskId`

- [ ] **Step 3: Implement aggregators**

Implement:

- case keyword/date/type/score filtering and sorting
- official cross-device rule aggregation from `official_linter_results`
- optional non-cross-device rule aggregation from `rule_audit_results`
- risk review keyword/agreement/risk level filtering

- [ ] **Step 4: Wire routes**

Add route handlers in `createDashboardRouter()`:

- `/dashboard/cross-device/cases`
- `/dashboard/cross-device/rule-violations`
- `/dashboard/cross-device/risk-review-calibrations`

Reuse existing `readPositiveInteger`, `readString`, `readNumber`, `paginate`, and `sendError` patterns.

- [ ] **Step 5: Add API path constants**

Add:

```ts
dashboardCrossDeviceCases: "/dashboard/cross-device/cases",
dashboardCrossDeviceRuleViolations: "/dashboard/cross-device/rule-violations",
dashboardCrossDeviceRiskReviewCalibrations: "/dashboard/cross-device/risk-review-calibrations",
```

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
node --import tsx --test tests/dashboard-api.test.ts
```

Expected: PASS.

## Task 3: Frontend API and Page

**Files:**
- Modify: `web/src/api/dashboard.ts`
- Create: `web/src/pages/CrossDeviceAnalysis.vue`
- Modify: `web/src/router/index.ts`
- Modify: `web/src/App.vue`

- [ ] **Step 1: Add API types and fetchers**

Add TypeScript response types matching the backend response shapes and fetchers:

```ts
export function fetchCrossDeviceCases(params?: Record<string, string | number | undefined>) {
  return getJson<CrossDeviceCaseListResponse>("/dashboard/cross-device/cases", params);
}
```

Add equivalent fetchers for rule violations and risk review calibrations.

- [ ] **Step 2: Build `CrossDeviceAnalysis.vue`**

Use Element Plus tabs. Implement:

- case tab with keyword input, table, pagination, case name link, and details drawer
- rule tab with keyword input, include-other-rules checkbox, table, and pagination
- risk tab with keyword input, agreement select, risk level select, table, and pagination
- shared title-bar date range through `setDashboardTitleControls`
- `dashboard:refresh` listener

- [ ] **Step 3: Add router and menu**

Add the route:

```ts
{ path: "/cross-device", component: CrossDeviceAnalysis }
```

Add a sidebar menu item and title/subtitle branches for `/cross-device`.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

## Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
node --import tsx --test tests/dashboard-api.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only planned implementation files are modified or added.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add src/dashboard/crossDeviceTypes.ts src/dashboard/crossDeviceDataStore.ts src/dashboard/crossDeviceAggregates.ts src/dashboard/dashboardHandlers.ts src/api/apiDefinitions.ts tests/dashboard-api.test.ts web/src/api/dashboard.ts web/src/pages/CrossDeviceAnalysis.vue web/src/router/index.ts web/src/App.vue docs/superpowers/plans/2026-05-15-cross-device-dashboard-implementation.md
git commit -m "feat: add cross-device dashboard"
```

Expected: commit succeeds.

## Self-Review

- Spec coverage: the plan covers all three tabs, all three API endpoints, the drawer, navigation, and filtering.
- Placeholder scan: no placeholder tasks are left; every task has explicit files and verification commands.
- Type consistency: endpoint names, response row names, and frontend fetcher names are consistent across backend and frontend tasks.
