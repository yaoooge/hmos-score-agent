import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const crossDeviceVue = fs.readFileSync(
  path.join(process.cwd(), "web", "src", "pages", "CrossDeviceAnalysis.vue"),
  "utf-8",
);

test("cross-device rule violation table keeps affected cases without duplicate count column", () => {
  assert.match(crossDeviceVue, /<el-tab-pane label="规则违背" name="rules">/);
  assert.match(crossDeviceVue, /prop="affectedTaskCount" label="影响用例"/);
  assert.doesNotMatch(crossDeviceVue, /prop="violationCount" label="次数"/);
});

test("cross-device rule violation tab keeps date range filtering and only adds hit ratio", () => {
  assert.match(crossDeviceVue, /setTitleControls\?\.\(\{ dateRange: \{ model: range \} \}\)/);
  assert.match(crossDeviceVue, /fetchCrossDeviceRuleViolations\(\{\s+\.\.\.dateParams\(\)/);
  assert.match(crossDeviceVue, /ruleSummaryText/);
  assert.match(crossDeviceVue, /label="命中比例"/);
  assert.match(
    crossDeviceVue,
    /formatHitRatio\(row\.affectedTaskCount, ruleSummary\.relatedCaseCount/,
  );
  assert.doesNotMatch(crossDeviceVue, /label="影响 taskId"/);
});
