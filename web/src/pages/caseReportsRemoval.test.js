import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const pagesDir = dirname(fileURLToPath(import.meta.url));
const webSrcDir = join(pagesDir, "..");

function readSource(relativePath) {
  return readFileSync(join(webSrcDir, relativePath), "utf8");
}

test("case reports page is removed from dashboard navigation", () => {
  const appSource = readSource("App.vue");
  const routerSource = readSource("router/index.ts");

  assert.equal(existsSync(join(pagesDir, "CaseReports.vue")), false);
  assert.doesNotMatch(appSource, /用例报表|\/reports|TrendCharts/);
  assert.doesNotMatch(routerSource, /CaseReports|\/reports/);
});

test("case reports frontend API helpers are removed", () => {
  const dashboardApiSource = readSource("api/dashboard.ts");

  assert.doesNotMatch(
    dashboardApiSource,
    /DailyReportItem|ScoreBucket|fetchDailyReport|fetchScoreDistribution|\/dashboard\/reports/,
  );
});
