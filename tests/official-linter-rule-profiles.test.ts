import assert from "node:assert/strict";
import test from "node:test";
import {
  findOfficialLinterRuleProfile,
  officialLinterRuleProfiles,
} from "../src/scoring/officialLinterRuleProfiles.js";

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
  "@cross-device-app-dev/color-contrast",
  "@cross-device-app-dev/color-value",
  "@cross-device-app-dev/font-size",
  "@cross-device-app-dev/font-size-unit",
  "@cross-device-app-dev/grid-columns-span",
  "@cross-device-app-dev/grid-span-value",
  "@cross-device-app-dev/sidebar-navigation",
  "@cross-device-app-dev/size-unit",
  "@cross-device-app-dev/touch-target-size",
  "@cross-device-app-dev/one-multi-breakpoint-check",
];

test("official linter rule profiles cover every v1 recommended rule explicitly", () => {
  const configuredRuleIds = officialLinterRuleProfiles.map((profile) => profile.ruleId).sort();

  assert.equal(configuredRuleIds.length, new Set(configuredRuleIds).size);
  assert.deepEqual(configuredRuleIds, [...expectedRecommendedRuleIds].sort());
});

test("official linter rule profiles define concrete score impact for every rule", () => {
  for (const profile of officialLinterRuleProfiles) {
    assert.ok(
      profile.metricNames.length > 0,
      `${profile.ruleId} should target at least one metric`,
    );
    assert.ok(profile.ratio > 0, `${profile.ruleId} should have a positive ratio`);
    assert.match(
      profile.ruleId,
      /^@(?:typescript-eslint|security|performance|hw-stylistic|cross-device-app-dev)\//,
    );
  }
});

test("official linter rule profiles map every cross-device recommended rule explicitly", () => {
  const crossDeviceRuleIds = expectedRecommendedRuleIds.filter((ruleId) =>
    ruleId.startsWith("@cross-device-app-dev/"),
  );

  for (const ruleId of crossDeviceRuleIds) {
    const profile = findOfficialLinterRuleProfile(`OFFICIAL-LINTER:${ruleId}`);
    assert.ok(profile, `${ruleId} should have an exact profile`);
    assert.ok(
      profile.metricNames.includes("ArkUI组织方式合理性") ||
        profile.metricNames.includes("HarmonyOS工程实践符合度"),
      `${ruleId} should map to an existing platform rubric item`,
    );
    assert.equal(profile.severity, "medium");
  }
});

test("official linter performance and stylistic rules are low priority", () => {
  const lowPriorityPrefixes = ["@performance/", "@hw-stylistic/"];
  const lowPriorityProfiles = officialLinterRuleProfiles.filter((profile) =>
    lowPriorityPrefixes.some((prefix) => profile.ruleId.startsWith(prefix)),
  );

  assert.ok(lowPriorityProfiles.length > 0);
  for (const profile of lowPriorityProfiles) {
    assert.equal(profile.severity, "light", `${profile.ruleId} should be light severity`);
  }
});

test("official linter rule profiles do not use prefix fallback for unknown cross-device rules", () => {
  assert.equal(
    findOfficialLinterRuleProfile("OFFICIAL-LINTER:@cross-device-app-dev/unknown-rule"),
    undefined,
  );
});
