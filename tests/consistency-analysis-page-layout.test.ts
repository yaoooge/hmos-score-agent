import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const consistencyAnalysisVue = fs.readFileSync(
  path.join(process.cwd(), "web", "src", "pages", "ConsistencyAnalysis.vue"),
  "utf-8",
);

test("consistency risk report exposes clickable titles and a detail drawer", () => {
  assert.match(consistencyAnalysisVue, /@click="openRiskDetailDrawer\(row\)"/);
  assert.match(consistencyAnalysisVue, /v-model="riskDetailDrawerVisible"/);
  assert.match(consistencyAnalysisVue, /riskDetailItem\?\.details/);
  assert.match(consistencyAnalysisVue, /Agent 结论/);
  assert.match(consistencyAnalysisVue, /证据/);
});
