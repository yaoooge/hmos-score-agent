# Result Analysis Manual Analysis Status Design

## Context

The `web/` result analysis page currently has separate tabs for human rating gap analysis, negative result analysis, and risk item analysis.

The two tabs in scope read from existing backend datasets:

- Human rating gap analysis reads `human_rating_gap_analyses.jsonl`.
- Risk item analysis reads `risk_review_calibrations.jsonl`.

These datasets are the current file-backed persistence layer for the dashboard analysis APIs. The project does not have a relational database migration path for these analysis rows.

Users need to mark whether each row has already gone through manual second-pass analysis. The status is manually controlled by dashboard users, not inferred from existing automated analysis artifacts. Risk item analysis should only focus on rows where the human reviewer disagreed with the automated risk result; second-pass analysis is only performed for those disagreed rows.

## Goals

- Add a manual analysis status column to the human rating gap analysis tab.
- Add a manual analysis status column to the risk item analysis tab.
- Let users batch mark selected rows as `已分析` or `待分析`.
- Persist the status through the backend API and the existing file-backed datasets.
- Keep historical rows compatible by treating missing status as `待分析`.
- Scope the risk item analysis tab to human-disagreed risk review rows only.
- Reuse the existing risk review calibration table and dataset rather than introducing a new table.

## Non-Goals

- Do not add a `manualAnalyzedBy` field.
- Do not introduce a relational database, ORM migration, or separate analysis status table.
- Do not change task ingestion, score calculation, or human review submission semantics.
- Do not perform automated second-pass analysis in this change.
- Do not expose agreed risk review rows in the risk item analysis tab.

## Data Model

Add the following optional fields to both analysis item shapes:

```ts
type ManualAnalysisStatus = "pending" | "analyzed";

type ManualAnalysisStatusFields = {
  manualAnalysisStatus?: ManualAnalysisStatus;
  manualAnalyzedAt?: string;
};
```

Dashboard readers normalize missing or invalid `manualAnalysisStatus` to `pending` before returning rows to the frontend. `manualAnalyzedAt` is set to the current server time when a row is marked `analyzed`, and removed when the row is marked back to `pending`.

The fields are stored inline in existing JSONL records:

- `human_rating_gap_analyses.jsonl` rows for human rating gap analysis.
- `risk_review_calibrations.jsonl` rows for risk item analysis.

This keeps the displayed API state and persisted dataset state synchronized without a join layer.

## Risk Item Scope

The current risk item analysis table should be reused. It becomes a second-pass analysis queue for disagreed risk items.

A risk review row is considered disagreed when either of these fields is explicitly `false`:

- `humanReview.agreeWithResultLevel`
- `humanReview.agree`

The result analysis tab should request risk rows with `agreement=disagreed` and display only those rows. The backend route should keep explicit `agreement=agreed` and `agreement=disagreed` support for other consumers, but `web/src/pages/ResultAnalysis.vue` should not expose an agreement selector.

Batch status updates for risk items should only update disagreed rows. If an update request references an agreed row or a row that no longer exists, the API returns it under `missing` or `skipped` and leaves it unchanged.

## API Changes

### List Human Rating Gaps

`GET /dashboard/analysis/human-rating-gaps`

Add query parameter:

- `manualAnalysisStatus`: optional. Allowed values are `pending` and `analyzed`.

Response items include:

```json
{
  "taskId": 88,
  "manualAnalysisStatus": "pending",
  "manualAnalyzedAt": "2026-05-19T08:00:00.000Z"
}
```

`manualAnalyzedAt` is omitted for pending rows.

### List Risk Review Calibrations

`GET /dashboard/analysis/risk-review-calibrations`

Existing `agreement` validation remains. The result analysis page must call this API with `agreement=disagreed`.

Add query parameter:

- `manualAnalysisStatus`: optional. Allowed values are `pending` and `analyzed`.

Response items include `manualAnalysisStatus` and optional `manualAnalyzedAt`.

### Batch Update Human Rating Gap Status

`PATCH /dashboard/analysis/human-rating-gaps/manual-analysis-status`

Request:

```json
{
  "taskIds": [88, 89],
  "status": "analyzed"
}
```

Response:

```json
{
  "success": true,
  "updated": 2,
  "missing": []
}
```

Validation:

- `taskIds` must be a non-empty array of positive integers.
- `status` must be `pending` or `analyzed`.

### Batch Update Risk Review Status

`PATCH /dashboard/analysis/risk-review-calibrations/manual-analysis-status`

Request:

```json
{
  "items": [
    { "taskId": 88, "riskId": 1 },
    { "taskId": 89, "riskId": 2 }
  ],
  "status": "pending"
}
```

Response:

```json
{
  "success": true,
  "updated": 1,
  "missing": [],
  "skipped": [
    { "taskId": 89, "riskId": 2, "reason": "not_disagreed" }
  ]
}
```

Validation:

- `items` must be a non-empty array.
- Each item must include a positive integer `taskId`.
- Each item must include a positive integer `riskId`. Historical fallback support may accept `riskIndex` only if `riskId` is absent in the stored row.
- `status` must be `pending` or `analyzed`.

For historical rows without `riskId`, implementation may support `taskId + riskIndex` as a fallback. New frontend requests should send `riskId`, because current risk review writes include it and it is the preferred stable key.

## Frontend Experience

### Human Rating Gap Analysis

Add a compact status filter to the toolbar:

- Placeholder: `分析状态`
- Values: all, `待分析`, `已分析`

Add a selection column and a status column:

- Status column label: `分析状态`
- `pending` renders as `待分析`
- `analyzed` renders as `已分析`

Add toolbar actions:

- `标记已分析`
- `标记待分析`

Actions apply to selected rows. When no rows are selected, buttons are disabled. After a successful update, reload the current page.

### Risk Item Analysis

Remove the visible `人工同意` selector from this tab. The tab displays only disagreed rows.

Keep the existing keyword search. Add the same status filter, selection column, status column, and batch actions as the human rating gap tab.

The table title or empty state may clarify that the table contains only risk items where human review disagreed with the automated risk level. Avoid adding instructional text inside the main table body.

## Backend Implementation Notes

- Add a shared `ManualAnalysisStatus` type in `src/dashboard/dashboardTypes.ts`.
- Extend `HumanRatingGapDashboardItem` and `RiskReviewCalibrationDashboardItem`.
- Normalize status while reading JSONL rows in `src/dashboard/dashboardDataStore.ts`.
- Add dataset rewrite helpers for the two batch update operations.
- Keep rewrite operations serialized through the existing file-store exclusive operation pattern.
- Extend `filterHumanRatingGaps` and `filterRiskReviewCalibrations` to support `manualAnalysisStatus`.
- Keep agreement filtering logic centralized so the risk tab and cross-device consumers do not duplicate agreement interpretation.
- Add PATCH handlers in `src/dashboard/dashboardHandlers.ts`.
- Update `src/api/apiDefinitions.ts` if dashboard paths are documented there.
- Update `web/src/api/dashboard.ts` with response fields and PATCH client functions.
- Update `web/src/pages/ResultAnalysis.vue` with selection state, status filter state, batch actions, and risk-tab disagreed-only loading.

## Error Handling

- Invalid status values return `400`.
- Empty batch requests return `400`.
- Missing rows are reported in the response and do not fail the full request.
- For risk item updates, agreed rows are reported as `skipped` and left unchanged.
- If the backing JSONL file does not exist, list endpoints return empty results and batch update endpoints report all requested rows as missing.

## Testing

Backend tests:

- Human rating gap list returns `pending` for historical rows without a status field.
- Human rating gap list filters by `manualAnalysisStatus`.
- Human rating gap batch update persists `analyzed` and `pending`.
- Risk review loading from the result analysis page requests `agreement=disagreed`.
- Risk review list filters by `manualAnalysisStatus`.
- Risk review batch update persists status for disagreed rows.
- Risk review batch update skips agreed rows.
- Invalid batch payloads return `400`.

Frontend verification:

- `web` TypeScript build succeeds.
- Human rating gap tab displays the status column and batch buttons.
- Risk item analysis tab displays only disagreed rows.
- Batch updates refresh the current table and preserve active filters/page where practical.

## Acceptance Criteria

- Both target tabs show `分析状态`.
- Missing historical statuses appear as `待分析`.
- Users can select multiple rows and mark them `已分析` or `待分析`.
- Updated statuses survive page refresh because they are written to the backend dataset files.
- Human rating gap status filtering works across the full backend dataset.
- Risk item analysis only shows human-disagreed risk rows.
- Risk item status filtering works across the full backend dataset of disagreed rows.
- No `manualAnalyzedBy` field is added.
- No separate table or separate status dataset is introduced.
