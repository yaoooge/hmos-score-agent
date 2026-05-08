import type { RuleImpactDetail } from "../types.js";

export type OfficialLinterRuleProfile = {
  ruleId: string;
  metricNames: string[];
  ratio: number;
  severity: RuleImpactDetail["severity"];
};

const typeSafetyMetrics = ["ArkTS/ArkUI语法与类型安全"];
const staticQualityMetrics = ["静态坏味道控制"];
const securityBoundaryMetrics = ["安全与边界意识", "安全/边界意识"];
const performanceRiskMetrics = ["性能风险"];

function profile(input: OfficialLinterRuleProfile): OfficialLinterRuleProfile {
  return input;
}

const typeSafetyRuleIds = [
  "@typescript-eslint/await-thenable",
  "@typescript-eslint/consistent-type-imports",
  "@typescript-eslint/explicit-function-return-type",
  "@typescript-eslint/explicit-module-boundary-types",
  "@typescript-eslint/no-explicit-any",
  "@typescript-eslint/no-for-in-array",
  "@typescript-eslint/no-unsafe-argument",
  "@typescript-eslint/no-unsafe-assignment",
  "@typescript-eslint/no-unsafe-call",
  "@typescript-eslint/no-unsafe-member-access",
  "@typescript-eslint/no-unsafe-return",
  "@typescript-eslint/prefer-literal-enum-member",
];

const staticQualityRuleIds = [
  "@typescript-eslint/no-dynamic-delete",
  "@typescript-eslint/no-this-alias",
  "@typescript-eslint/no-unnecessary-type-constraint",
  "@security/no-commented-code",
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

const securityRuleIds = [
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
];

const performanceRuleIds = [
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
];

export const officialLinterRuleProfiles = [
  ...typeSafetyRuleIds.map((ruleId) =>
    profile({
      ruleId,
      metricNames: typeSafetyMetrics,
      ratio: 0.1,
      severity: "medium",
    }),
  ),
  ...staticQualityRuleIds.map((ruleId) =>
    profile({
      ruleId,
      metricNames: staticQualityMetrics,
      ratio: 0.08,
      severity: "light",
    }),
  ),
  ...securityRuleIds.map((ruleId) =>
    profile({
      ruleId,
      metricNames: securityBoundaryMetrics,
      ratio: 0.2,
      severity: "heavy",
    }),
  ),
  ...performanceRuleIds.map((ruleId) =>
    profile({
      ruleId,
      metricNames: performanceRiskMetrics,
      ratio: 0.12,
      severity: "medium",
    }),
  ),
] satisfies OfficialLinterRuleProfile[];

const profilesByOfficialRuleId = new Map(
  officialLinterRuleProfiles.map((item) => [`OFFICIAL-LINTER:${item.ruleId}`, item]),
);

export function findOfficialLinterRuleProfile(ruleId: string): OfficialLinterRuleProfile | undefined {
  return profilesByOfficialRuleId.get(ruleId);
}
