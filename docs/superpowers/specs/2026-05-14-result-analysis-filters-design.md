# Result Analysis Filters and Task Type Highlights Design

## Context

The dashboard frontend under `web/` already exposes a task dashboard and result analysis page. The task dashboard shows task type counts with plain metric cards. The result analysis page loads human rating gaps and risk review calibrations from backend APIs, but it does not yet expose search or filter controls for those analysis tables.

Existing backend routes already support pagination for:

- `GET /dashboard/analysis/human-rating-gaps`
- `GET /dashboard/analysis/risk-review-calibrations`

Human rating gaps currently support date, manual rating, and conclusion filters internally. Risk review calibrations currently expose paginated data without search or agreement filters.

## Goals

- Show task type count numbers in distinct highlight colors in the task dashboard.
- Remove duplicate refresh buttons from the task dashboard and case reports pages.
- Move the date range picker for the task dashboard and case reports pages to the right side of the page title bar.
- Let users search human rating gap rows by task name and task id.
- Let users filter human rating gap rows by conclusion.
- Let users search risk review calibration rows by task id and task name.
- Let users filter risk review calibration rows by whether the human reviewer agreed with the automated risk result.
- Keep filtering backed by the API so results apply to the full dataset, not only the rows currently loaded by the browser.

## Non-Goals

- No redesign of the dashboard navigation or page layout.
- No change to unrelated negative result analysis tables.
- No change to task ingestion, score calculation, or review evidence file formats.

## User Experience

### Task Dashboard

The task dashboard should use the shared page title bar for global controls. The date range picker moves from the page content toolbar to the title bar's right side, next to the existing refresh button. The page-level refresh button is removed so the page has one refresh entry point.

The task type metric cards continue to appear in the existing metric grid. Each type count uses a stable accent color derived from the task type name. The color should remain stable even if the task type order changes between API responses.

The base card styling remains restrained and consistent with the existing Element Plus dashboard. Only the number/accent treatment changes.

### Case Reports

The case reports page follows the same title bar control pattern as the task dashboard. Its date range picker moves to the right side of the page title bar, and the page-level refresh button is removed. The task type select remains in the page content area because it is specific to the report charts rather than a global page time range control.

The title bar refresh button continues to dispatch the existing `dashboard:refresh` event. The active page remains responsible for reloading its own data when that event fires.

### Human Rating Gap Analysis

Above the table, add a compact toolbar with:

- Search input placeholder: `名称 / ID`
- Conclusion select placeholder: `结论`

The search input matches:

- `taskId`
- `testCaseId`
- `caseName`

The conclusion select sends the selected `primaryConclusion` value to the API. Clearing either control resets that condition. Changing filters resets the page to `1`.

### Risk Item Analysis

Above the table, add a compact toolbar with:

- Search input placeholder: `名称 / taskId`
- Agreement select placeholder: `人工同意`

The search input matches:

- `taskId`
- `testCaseId`
- `caseName`

Agreement values:

- Empty: all rows
- `agreed`: rows where `humanReview.agreeWithResultLevel` or `humanReview.agree` is `true`
- `disagreed`: rows where `humanReview.agreeWithResultLevel` or `humanReview.agree` is `false`

Changing filters resets the page to `1`.

## API Changes

### `GET /dashboard/analysis/human-rating-gaps`

Add query parameter:

- `keyword`: optional string. Matches `taskId`, `testCaseId`, and `caseName` case-insensitively.

Continue supporting:

- `primaryConclusion`
- `manualRating`
- `from`
- `to`
- `page`
- `pageSize`

### `GET /dashboard/analysis/risk-review-calibrations`

Add query parameters:

- `keyword`: optional string. Matches `taskId`, `testCaseId`, and `caseName` case-insensitively.
- `agreement`: optional string. Allowed values are `agreed` and `disagreed`.

Invalid `agreement` values return `400` with a clear message.

## Implementation Notes

- Extend `filterHumanRatingGaps` to accept `keyword`.
- Add a dedicated `filterRiskReviewCalibrations` helper in `dashboardAggregates.ts` to keep route handlers small and testable.
- Extend `MetricCard` with an optional `accent` prop and apply the accent through a CSS custom property.
- In `TaskDashboard.vue`, derive each task type card accent from a stable palette using a deterministic hash of the task type string.
- Add a small route-aware title bar control surface in `App.vue` for task/report date range controls, or an equivalent local pattern that visually places those controls in the title bar without duplicating refresh behavior.
- Keep `dashboard:refresh` as the shared refresh mechanism so removing page-level refresh buttons does not change data reload semantics.
- In `ResultAnalysis.vue`, keep separate reactive filter/page state for human rating gaps and risk review calibrations.
- Fetch only the active table's API data when filters change where practical, while initial page load can still load all three analysis sections.

## Testing

- Add backend tests for human rating gap keyword filtering and conclusion filtering.
- Add backend tests for risk review keyword filtering, agreement filtering, and invalid agreement validation.
- Run the dashboard API tests.
- Run the web build to verify Vue/TypeScript integration.

## Acceptance Criteria

- Task type metric numbers show visually distinct highlight colors.
- Task dashboard and case reports no longer show duplicate refresh buttons.
- Task dashboard and case reports show their date range picker on the right side of the title bar.
- The remaining title bar refresh button reloads the active page data.
- Human rating gaps can be searched by name, task id, and test case id.
- Human rating gaps can be filtered by conclusion.
- Risk review rows can be searched by name, task id, and test case id.
- Risk review rows can be filtered by human agreement/disagreement.
- API filtering affects the full dataset and returns correct pagination totals.
- Existing dashboard behavior remains intact.
