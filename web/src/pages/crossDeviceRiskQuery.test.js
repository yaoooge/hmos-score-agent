import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossDeviceRiskQueryParams } from "./crossDeviceRiskQuery.js";

test("buildCrossDeviceRiskQueryParams always requests disagreed risk reviews", () => {
  const params = buildCrossDeviceRiskQueryParams({
    from: "2026-05-01T00:00:00.000Z",
    to: "2026-05-19T00:00:00.000Z",
    page: 2,
    pageSize: 20,
    keyword: "foo",
    riskLevel: "high",
  });

  assert.deepEqual(params, {
    from: "2026-05-01T00:00:00.000Z",
    to: "2026-05-19T00:00:00.000Z",
    page: 2,
    pageSize: 20,
    keyword: "foo",
    riskLevel: "high",
    agreement: "disagreed",
  });
});
