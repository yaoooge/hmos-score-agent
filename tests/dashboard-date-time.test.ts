import assert from "node:assert/strict";
import test from "node:test";
import { formatDashboardDateTime } from "../web/src/dateTime.js";

test("formatDashboardDateTime formats timestamps as yyyy-mm-dd hh:mm:ss", () => {
  assert.equal(formatDashboardDateTime("2026-05-14T09:08:07"), "2026-05-14 09:08:07");
});

test("formatDashboardDateTime pads single digit date and time parts", () => {
  assert.equal(formatDashboardDateTime("2026-01-02T03:04:05"), "2026-01-02 03:04:05");
});

test("formatDashboardDateTime returns a placeholder for missing or invalid timestamps", () => {
  assert.equal(formatDashboardDateTime(""), "-");
  assert.equal(formatDashboardDateTime("not-a-date"), "-");
});
