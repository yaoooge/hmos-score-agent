import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pagesDir = dirname(fileURLToPath(import.meta.url));

const paginatedDashboardPages = [
  "TaskDashboard.vue",
  "ResultAnalysis.vue",
  "CrossDeviceAnalysis.vue",
  "ConsistencyAnalysis.vue",
];

const tabbedTablePages = [
  "ResultAnalysis.vue",
  "CrossDeviceAnalysis.vue",
];

function readPage(fileName) {
  return readFileSync(join(pagesDir, fileName), "utf8");
}

test("dashboard paginated tables default to 10 rows", () => {
  for (const fileName of paginatedDashboardPages) {
    const source = readPage(fileName);
    assert.doesNotMatch(
      source,
      /\b(?:\w+PageSize|pageSize)\s*=\s*ref\((?!10\))/,
      `${fileName} has a paginated table defaulting to a value other than 10`,
    );
  }
});

test("dashboard tab tables do not set fixed table heights", () => {
  for (const fileName of tabbedTablePages) {
    const source = readPage(fileName);
    assert.doesNotMatch(
      source,
      /<el-table\b[^>]*\sheight=["'{]/,
      `${fileName} sets a fixed el-table height, which creates an internal table scrollbar`,
    );
  }
});
