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

test("getConfig reads provider-neutral model provider env keys only", () => {
  const previousBaseUrl = process.env.MODEL_PROVIDER_BASE_URL;
  const previousApiKey = process.env.MODEL_PROVIDER_API_KEY;
  const previousModel = process.env.MODEL_PROVIDER_MODEL;

  process.env.MODEL_PROVIDER_BASE_URL = "https://provider.example/v1";
  process.env.MODEL_PROVIDER_API_KEY = "provider-key";
  process.env.MODEL_PROVIDER_MODEL = "gpt-5.4";

  try {
    const config = getConfig();
    assert.equal(config.modelProviderBaseUrl, "https://provider.example/v1");
    assert.equal(config.modelProviderApiKey, "provider-key");
    assert.equal(config.modelProviderModel, "gpt-5.4");
  } finally {
    if (previousBaseUrl === undefined) delete process.env.MODEL_PROVIDER_BASE_URL;
    else process.env.MODEL_PROVIDER_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.MODEL_PROVIDER_API_KEY;
    else process.env.MODEL_PROVIDER_API_KEY = previousApiKey;
    if (previousModel === undefined) delete process.env.MODEL_PROVIDER_MODEL;
    else process.env.MODEL_PROVIDER_MODEL = previousModel;
  }
});

// 这组文件属于仓库自维护内容，不应再出现供应商指向命名。
test("repo-maintained docs and config files no longer use supplier-specific model naming", async () => {
  const files = [
    "README.md",
    "文档总览.md",
    "需求清单.md",
    "评分服务设计文档.md",
    "src/config.ts",
    "src/tools/runInteractiveScore.ts",
    "src/agent/agentClient.ts",
    "docs/superpowers/specs/2026-04-16-provider-neutral-naming-design.md",
    "docs/superpowers/plans/2026-04-16-provider-neutral-naming.md",
  ];

  for (const file of files) {
    const content = await fs.readFile(path.resolve(process.cwd(), file), "utf-8");
    assert.doesNotMatch(content, /OpenAI|OPENAI_|openai/);
  }
});
