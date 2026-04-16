import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getConfig } from "../src/config.js";

// 这组测试锁住“参考资源必须在仓库内部”这个基本约束。
test("getConfig defaults referenceRoot to the repo-local scoring references directory", () => {
  const previous = process.env.DEFAULT_REFERENCE_ROOT;
  delete process.env.DEFAULT_REFERENCE_ROOT;

  try {
    const config = getConfig();
    assert.equal(config.referenceRoot, path.resolve(process.cwd(), "references/scoring"));
  } finally {
    if (previous === undefined) {
      delete process.env.DEFAULT_REFERENCE_ROOT;
    } else {
      process.env.DEFAULT_REFERENCE_ROOT = previous;
    }
  }
});

test("repo-local scoring reference files exist", async () => {
  for (const fileName of ["rubric.yaml", "report_result_schema.json", "arkts_internal_rules.yaml"]) {
    await fs.access(path.resolve(process.cwd(), "references/scoring", fileName));
  }
});
