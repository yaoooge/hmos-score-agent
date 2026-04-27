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
  for (const fileName of ["rubric.yaml", "report_result_schema.json"]) {
    await fs.access(path.resolve(process.cwd(), "references/scoring", fileName));
  }
});

test("app config no longer exposes direct model provider settings", () => {
  const config = getConfig() as Record<string, unknown>;

  const oldProviderPrefix = "model" + "Provider";
  assert.equal(`${oldProviderPrefix}BaseUrl` in config, false);
  assert.equal(`${oldProviderPrefix}ApiKey` in config, false);
  assert.equal(`${oldProviderPrefix}Model` in config, false);
});

test("repo-maintained runtime files no longer use direct model provider naming", async () => {
  const files = [
    "src/config.ts",
    "src/tools/runInteractiveScore.ts",
    "src/workflow/scoreWorkflow.ts",
  ];

  for (const file of files) {
    const content = await fs.readFile(path.resolve(process.cwd(), file), "utf-8");
    assert.doesNotMatch(content, new RegExp(["MODEL" + "_PROVIDER", "model" + "Provider", "Chat" + "Model" + "Client"].join("|")));
  }
});
