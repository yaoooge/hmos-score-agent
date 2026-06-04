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

test("getConfig derives official tool run directories from HMOS_OFFICIAL_TOOL_RUN_DIR", () => {
  const previousOfficialToolRunDir = process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
  const previousCodeLinterRunDir = process.env.HMOS_CODE_LINTER_RUN_DIR;
  const previousHvigorTimeoutMs = process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS;
  const toolRoot = path.resolve(process.cwd(), ".tmp-official-tools");
  process.env.HMOS_OFFICIAL_TOOL_RUN_DIR = toolRoot;
  process.env.HMOS_CODE_LINTER_RUN_DIR = path.resolve(process.cwd(), "legacy-codelinter");
  delete process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS;

  try {
    const config = getConfig();
    assert.equal(config.officialToolRunDir, toolRoot);
    assert.equal(config.officialCodeLinterRunDir, path.join(toolRoot, "codelinter"));
    assert.equal(config.hvigorBuildCheckRunDir, path.join(toolRoot, "hvigor"));
    assert.equal(config.hvigorBuildCheckTimeoutMs, 300000);
  } finally {
    if (previousOfficialToolRunDir === undefined) {
      delete process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
    } else {
      process.env.HMOS_OFFICIAL_TOOL_RUN_DIR = previousOfficialToolRunDir;
    }
    if (previousCodeLinterRunDir === undefined) {
      delete process.env.HMOS_CODE_LINTER_RUN_DIR;
    } else {
      process.env.HMOS_CODE_LINTER_RUN_DIR = previousCodeLinterRunDir;
    }
    if (previousHvigorTimeoutMs === undefined) {
      delete process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS;
    } else {
      process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS = previousHvigorTimeoutMs;
    }
  }
});

test("getConfig derives hvigor run dir from legacy codelinter run dir", () => {
  const previousOfficialToolRunDir = process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
  const previousCodeLinterRunDir = process.env.HMOS_CODE_LINTER_RUN_DIR;
  const previousHvigorTimeoutMs = process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS;
  delete process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
  const codeLinterRunDir = path.resolve(process.cwd(), "command-line-tools", "codelinter");
  process.env.HMOS_CODE_LINTER_RUN_DIR = codeLinterRunDir;
  process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS = "12345";

  try {
    const config = getConfig();
    assert.equal(config.officialToolRunDir, undefined);
    assert.equal(config.officialCodeLinterRunDir, codeLinterRunDir);
    assert.equal(
      config.hvigorBuildCheckRunDir,
      path.resolve(process.cwd(), "command-line-tools", "hvigor"),
    );
    assert.equal(config.hvigorBuildCheckTimeoutMs, 12345);
  } finally {
    if (previousOfficialToolRunDir === undefined) {
      delete process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
    } else {
      process.env.HMOS_OFFICIAL_TOOL_RUN_DIR = previousOfficialToolRunDir;
    }
    if (previousCodeLinterRunDir === undefined) {
      delete process.env.HMOS_CODE_LINTER_RUN_DIR;
    } else {
      process.env.HMOS_CODE_LINTER_RUN_DIR = previousCodeLinterRunDir;
    }
    if (previousHvigorTimeoutMs === undefined) {
      delete process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS;
    } else {
      process.env.HMOS_HVIGOR_BUILD_CHECK_TIMEOUT_MS = previousHvigorTimeoutMs;
    }
  }
});

test("repo-maintained runtime files no longer use direct model provider naming", async () => {
  const files = ["src/config.ts", "src/workflow/graph/scoreWorkflow.ts"];

  for (const file of files) {
    const content = await fs.readFile(path.resolve(process.cwd(), file), "utf-8");
    assert.doesNotMatch(
      content,
      new RegExp(
        ["MODEL" + "_PROVIDER", "model" + "Provider", "Chat" + "Model" + "Client"].join("|"),
      ),
    );
  }
});
