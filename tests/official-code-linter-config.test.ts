import assert from "node:assert/strict";
import test from "node:test";
import { getConfig } from "../src/config.js";
import {
  buildOfficialCodeLinterConfig,
  serializeOfficialCodeLinterConfig,
} from "../src/rules/officialCodeLinter/configWriter.js";
import { officialCodeLinterRecommendedRuleSets } from "../src/rules/officialCodeLinter/recommendedRuleSets.js";

test("official Code Linter v1 uses exactly four recommended rule sets", () => {
  assert.deepEqual(officialCodeLinterRecommendedRuleSets, [
    "plugin:@typescript-eslint/recommended",
    "plugin:@security/recommended",
    "plugin:@performance/recommended",
    "plugin:@hw-stylistic/recommended",
  ]);
  assert.equal(officialCodeLinterRecommendedRuleSets.includes("plugin:@previewer/recommended"), false);
  assert.equal(
    officialCodeLinterRecommendedRuleSets.includes("plugin:@cross-device-app-dev/recommended"),
    false,
  );
});

test("generated code-linter config explicitly includes the four v1 recommended rule sets", () => {
  const config = buildOfficialCodeLinterConfig();
  assert.deepEqual(config.ruleSet, officialCodeLinterRecommendedRuleSets);
  assert.ok(config.files.includes("**/*.ets"));
  assert.ok(config.files.includes("**/*.json5"));
  assert.ok(config.ignore.includes("node_modules/**/*"));
  assert.ok(config.ignore.includes("src/ohosTest/**/*"));

  const text = serializeOfficialCodeLinterConfig(config);
  assert.match(text, /plugin:@typescript-eslint\/recommended/);
  assert.match(text, /plugin:@security\/recommended/);
  assert.match(text, /plugin:@performance\/recommended/);
  assert.match(text, /plugin:@hw-stylistic\/recommended/);
});

test("official Code Linter config defaults to global node with optional run dir", () => {
  const previousOfficialToolRunDir = process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
  const previousEnabled = process.env.HMOS_CODE_LINTER_ENABLED;
  const previousRunDir = process.env.HMOS_CODE_LINTER_RUN_DIR;
  const previousTimeout = process.env.HMOS_CODE_LINTER_TIMEOUT_MS;
  delete process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
  delete process.env.HMOS_CODE_LINTER_ENABLED;
  delete process.env.HMOS_CODE_LINTER_RUN_DIR;
  delete process.env.HMOS_CODE_LINTER_TIMEOUT_MS;

  try {
    const config = getConfig() as Record<string, unknown>;
    assert.equal(config.officialCodeLinterEnabled, false);
    assert.equal(config.officialToolRunDir, undefined);
    assert.equal(config.officialCodeLinterRunDir, undefined);
    assert.equal(config.hvigorBuildCheckRunDir, undefined);
    assert.equal(config.officialCodeLinterTimeoutMs, 120000);
    assert.equal(Object.hasOwn(config, "officialCodeLinterNode"), false);
  } finally {
    if (previousOfficialToolRunDir === undefined) {
      delete process.env.HMOS_OFFICIAL_TOOL_RUN_DIR;
    } else {
      process.env.HMOS_OFFICIAL_TOOL_RUN_DIR = previousOfficialToolRunDir;
    }
    if (previousEnabled === undefined) {
      delete process.env.HMOS_CODE_LINTER_ENABLED;
    } else {
      process.env.HMOS_CODE_LINTER_ENABLED = previousEnabled;
    }
    if (previousRunDir === undefined) {
      delete process.env.HMOS_CODE_LINTER_RUN_DIR;
    } else {
      process.env.HMOS_CODE_LINTER_RUN_DIR = previousRunDir;
    }
    if (previousTimeout === undefined) {
      delete process.env.HMOS_CODE_LINTER_TIMEOUT_MS;
    } else {
      process.env.HMOS_CODE_LINTER_TIMEOUT_MS = previousTimeout;
    }
  }
});

test("official Code Linter is enabled only by explicit true environment flag", () => {
  const previousEnabled = process.env.HMOS_CODE_LINTER_ENABLED;

  try {
    process.env.HMOS_CODE_LINTER_ENABLED = "true";
    assert.equal(getConfig().officialCodeLinterEnabled, true);

    process.env.HMOS_CODE_LINTER_ENABLED = "1";
    assert.equal(getConfig().officialCodeLinterEnabled, false);

    process.env.HMOS_CODE_LINTER_ENABLED = "false";
    assert.equal(getConfig().officialCodeLinterEnabled, false);
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.HMOS_CODE_LINTER_ENABLED;
    } else {
      process.env.HMOS_CODE_LINTER_ENABLED = previousEnabled;
    }
  }
});

test("hvigor build check uses its own enable flag and falls back to legacy linter flag", () => {
  const previousCodeLinterEnabled = process.env.HMOS_CODE_LINTER_ENABLED;
  const previousHvigorEnabled = process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED;

  try {
    process.env.HMOS_CODE_LINTER_ENABLED = "false";
    process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED = "true";
    assert.equal(getConfig().officialCodeLinterEnabled, false);
    assert.equal(getConfig().hvigorBuildCheckEnabled, true);

    process.env.HMOS_CODE_LINTER_ENABLED = "true";
    process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED = "false";
    assert.equal(getConfig().officialCodeLinterEnabled, true);
    assert.equal(getConfig().hvigorBuildCheckEnabled, false);

    delete process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED;
    assert.equal(getConfig().hvigorBuildCheckEnabled, true);
  } finally {
    if (previousCodeLinterEnabled === undefined) {
      delete process.env.HMOS_CODE_LINTER_ENABLED;
    } else {
      process.env.HMOS_CODE_LINTER_ENABLED = previousCodeLinterEnabled;
    }
    if (previousHvigorEnabled === undefined) {
      delete process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED;
    } else {
      process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED = previousHvigorEnabled;
    }
  }
});
