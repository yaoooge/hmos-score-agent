import assert from "node:assert/strict";
import test from "node:test";
import { officialLinterRuleProfiles } from "../src/scoring/officialLinterRuleProfiles.js";

const expectedRecommendedRuleIds = [
  "@typescript-eslint/await-thenable",
  "@typescript-eslint/consistent-type-imports",
  "@typescript-eslint/explicit-function-return-type",
  "@typescript-eslint/explicit-module-boundary-types",
  "@typescript-eslint/no-dynamic-delete",
  "@typescript-eslint/no-explicit-any",
  "@typescript-eslint/no-for-in-array",
  "@typescript-eslint/no-this-alias",
  "@typescript-eslint/no-unnecessary-type-constraint",
  "@typescript-eslint/no-unsafe-argument",
  "@typescript-eslint/no-unsafe-assignment",
  "@typescript-eslint/no-unsafe-call",
  "@typescript-eslint/no-unsafe-member-access",
  "@typescript-eslint/no-unsafe-return",
  "@typescript-eslint/prefer-literal-enum-member",
  "@security/no-commented-code",
  "@security/no-unsafe-3des",
  "@security/no-unsafe-aes",
  "@security/no-unsafe-dh",
  "@security/no-unsafe-dh-key",
  "@security/no-unsafe-dsa",
  "@security/no-unsafe-dsa-key",
  "@security/no-unsafe-ecdsa",
  "@security/no-unsafe-hash",
  "@security/no-unsafe-mac",
  "@security/no-unsafe-rsa-encrypt",
  "@security/no-unsafe-rsa-key",
  "@security/no-unsafe-rsa-sign",
  "@performance/avoid-overusing-custom-component-check",
  "@performance/bad-deep-clone-check",
  "@performance/crypto-replacement-check",
  "@performance/datashare-query-unrelease-check",
  "@performance/foreach-args-check",
  "@performance/gif-hardware-decoding-check",
  "@performance/high-frequency-log-check",
  "@performance/monitor-invisible-area-in-image-animation",
  "@performance/no-high-loaded-frame-rate-range",
  "@performance/no-use-any-import",
  "@performance/reuse-date-instances-check",
  "@performance/start-window-icon-check",
  "@performance/update-state-var-between-animatetos-check",
  "@performance/waterflow-data-preload-check",
  "@performance/web-on-active-check",
  "@hw-stylistic/array-bracket-spacing",
  "@hw-stylistic/brace-style",
  "@hw-stylistic/comma-spacing",
  "@hw-stylistic/curly",
  "@hw-stylistic/indent",
  "@hw-stylistic/keyword-spacing",
  "@hw-stylistic/max-len",
  "@hw-stylistic/no-multi-spaces",
  "@hw-stylistic/no-tabs",
  "@hw-stylistic/object-property-newline",
  "@hw-stylistic/one-var-declaration-per-line",
  "@hw-stylistic/operator-linebreak",
  "@hw-stylistic/quotes",
  "@hw-stylistic/semi-spacing",
  "@hw-stylistic/space-before-blocks",
  "@hw-stylistic/space-before-function-paren",
  "@hw-stylistic/space-infix-ops",
];

test("official linter rule profiles cover every v1 recommended rule explicitly", () => {
  const configuredRuleIds = officialLinterRuleProfiles.map((profile) => profile.ruleId).sort();

  assert.equal(configuredRuleIds.length, new Set(configuredRuleIds).size);
  assert.deepEqual(configuredRuleIds, [...expectedRecommendedRuleIds].sort());
});

test("official linter rule profiles define concrete score impact for every rule", () => {
  for (const profile of officialLinterRuleProfiles) {
    assert.ok(profile.metricNames.length > 0, `${profile.ruleId} should target at least one metric`);
    assert.ok(profile.ratio > 0, `${profile.ruleId} should have a positive ratio`);
    assert.match(profile.ruleId, /^@(?:typescript-eslint|security|performance|hw-stylistic)\//);
  }
});
