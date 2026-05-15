import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecentDashboardRange,
  refreshDashboardRangeEnd,
} from "../web/src/dashboardDateRange.js";

test("createRecentDashboardRange builds a range ending at the provided time", () => {
  const [start, end] = createRecentDashboardRange(7, new Date("2026-05-15T12:00:00.000Z"));

  assert.equal(start.toISOString(), "2026-05-08T12:00:00.000Z");
  assert.equal(end.toISOString(), "2026-05-15T12:00:00.000Z");
});

test("refreshDashboardRangeEnd keeps the start and advances the end", () => {
  const start = new Date("2026-05-08T12:00:00.000Z");
  const staleEnd = new Date("2026-05-15T12:00:00.000Z");
  const refreshed = refreshDashboardRangeEnd(
    [start, staleEnd],
    new Date("2026-05-15T12:05:00.000Z"),
  );

  assert.notEqual(refreshed, null);
  assert.equal(refreshed?.[0], start);
  assert.equal(refreshed?.[1].toISOString(), "2026-05-15T12:05:00.000Z");
});

test("refreshDashboardRangeEnd leaves an empty range unset", () => {
  assert.equal(refreshDashboardRangeEnd(null), null);
});
