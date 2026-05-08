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
  const previousRunDir = process.env.HMOS_CODE_LINTER_RUN_DIR;
  const previousTimeout = process.env.HMOS_CODE_LINTER_TIMEOUT_MS;
  delete process.env.HMOS_CODE_LINTER_RUN_DIR;
  delete process.env.HMOS_CODE_LINTER_TIMEOUT_MS;

  try {
    const config = getConfig() as Record<string, unknown>;
    assert.equal(config.officialCodeLinterRunDir, undefined);
    assert.equal(config.officialCodeLinterTimeoutMs, 120000);
    assert.equal(Object.hasOwn(config, "officialCodeLinterNode"), false);
  } finally {
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

