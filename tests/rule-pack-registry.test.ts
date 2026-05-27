import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  defaultEnabledRulePackIds,
  getRegisteredRulePacks,
  listRegisteredRules,
} from "../src/rules/engine/rulePackRegistry.js";

test("arkts-language pack registers all rules from current source set", () => {
  const packs = getRegisteredRulePacks();
  const arktsPack = packs.find((item) => item.packId === "arkts-language");

  assert.ok(arktsPack);
  const rules = arktsPack.rules;
  assert.equal(rules.filter((item) => item.rule_source === "must_rule").length, 10);
  assert.equal(rules.filter((item) => item.rule_source === "should_rule").length, 11);
  assert.equal(rules.filter((item) => item.rule_source === "forbidden_pattern").length, 26);
  assert.equal(rules.length, 47);
});

test("arkts-performance pack registers PDF-derived performance rules", () => {
  const packs = getRegisteredRulePacks();
  const performancePack = packs.find((item) => item.packId === "arkts-performance");

  assert.ok(performancePack);
  assert.equal(performancePack.displayName, "ArkTS 高性能编程实践");
  assert.equal(performancePack.rules.length, 11);
  assert.equal(performancePack.rules.filter((item) => item.rule_source === "must_rule").length, 0);
  assert.equal(
    performancePack.rules.filter((item) => item.rule_source === "should_rule").length,
    6,
  );
  assert.equal(
    performancePack.rules.filter((item) => item.rule_source === "forbidden_pattern").length,
    5,
  );

  const rules = listRegisteredRules({ enabledPackIds: [...defaultEnabledRulePackIds] });
  assert.equal(rules.length, 60);
});

test("arkui-extra pack is registered and default enabled", () => {
  const packs = getRegisteredRulePacks();
  const arkuiPack = packs.find((item) => item.packId === "arkui-extra");

  assert.ok(arkuiPack);
  assert.equal(arkuiPack.displayName, "ArkUI 补充工程规则");
  assert.deepEqual(
    arkuiPack.rules.map((item) => item.rule_id),
    ["ARKUI-MUST-001", "ARKUI-FORBID-001"],
  );
  assert.equal(defaultEnabledRulePackIds.includes("arkui-extra"), true);
});

test("arkts-language should rules are renumbered contiguously after official-linter duplicate removals", () => {
  const rules = listRegisteredRules().filter(
    (item) => item.pack_id === "arkts-language" && item.rule_source === "should_rule",
  );

  assert.deepEqual(
    rules.map((item) => item.rule_id),
    [
      "ARKTS-SHOULD-001",
      "ARKTS-SHOULD-002",
      "ARKTS-SHOULD-003",
      "ARKTS-SHOULD-004",
      "ARKTS-SHOULD-005",
      "ARKTS-SHOULD-006",
      "ARKTS-SHOULD-007",
      "ARKTS-SHOULD-008",
      "ARKTS-SHOULD-009",
      "ARKTS-SHOULD-010",
      "ARKTS-SHOULD-011",
    ],
  );
});

test("registered rules carry real summaries and detector configs instead of placeholder entries", () => {
  const rules = listRegisteredRules();
  const movedMust002 = rules.find((item) => item.rule_id === "ARKTS-FORBID-002");
  const should011 = rules.find((item) => item.rule_id === "ARKTS-SHOULD-011");
  const forbid002 = rules.find((item) => item.rule_id === "ARKTS-FORBID-021");
  const must004 = rules.find((item) => item.rule_id === "ARKTS-MUST-001");

  assert.ok(movedMust002);
  assert.equal(movedMust002.rule_source, "forbidden_pattern");
  assert.equal(movedMust002.detector_kind, "text_pattern");
  assert.match(movedMust002.summary, /Symbol/);
  assert.deepEqual(movedMust002.detector_config.fileExtensions, [".ets"]);

  assert.ok(should011);
  assert.equal(should011.detector_kind, "text_pattern");
  assert.match(should011.summary, /浮点数小数点/);

  assert.ok(forbid002);
  assert.equal(forbid002.detector_kind, "text_pattern");
  assert.match(forbid002.summary, /\bin\b/);

  assert.ok(must004);
  assert.equal(must004.rule_source, "must_rule");
  assert.equal(must004.detector_kind, "not_implemented");
  assert.doesNotMatch(must004.summary, /当前默认进入静态规则包/);

  assert.equal(rules.some((item) => /单引号|switch 语句|大括号/.test(item.summary)), false);
});

test("registered rules carry performance-pack summaries and detector configs", () => {
  const rules = listRegisteredRules();
  const perfShould002 = rules.find((item) => item.rule_id === "ARKTS-PERF-SHOULD-002");
  const perfForbid003 = rules.find((item) => item.rule_id === "ARKTS-PERF-FORBID-003");
  const perfShould001 = rules.find((item) => item.rule_id === "ARKTS-PERF-SHOULD-001");

  assert.ok(perfShould002);
  assert.equal(perfShould002.pack_id, "arkts-performance");
  assert.equal(perfShould002.detector_kind, "text_pattern");
  assert.match(perfShould002.summary, /整型与浮点型混用/);
  assert.deepEqual(perfShould002.detector_config.fileExtensions, [".ets"]);

  assert.ok(perfForbid003);
  assert.equal(perfForbid003.pack_id, "arkts-performance");
  assert.equal(perfForbid003.detector_kind, "text_pattern");
  assert.match(perfForbid003.summary, /混用整型和浮点型/);

  assert.ok(perfShould001);
  assert.equal(perfShould001.detector_kind, "not_implemented");
});

test("all text pattern rules share consistent detector config shape", () => {
  const textPatternRules = listRegisteredRules().filter(
    (item) => item.detector_kind === "text_pattern",
  );

  assert.equal(textPatternRules.length > 0, true);
  for (const rule of textPatternRules) {
    assert.deepEqual(rule.detector_config.fileExtensions, [".ets"], rule.rule_id);
    assert.equal(Array.isArray(rule.detector_config.patterns), true, rule.rule_id);
    assert.equal((rule.detector_config.patterns as unknown[]).length > 0, true, rule.rule_id);
    assert.equal(rule.fallback_policy, "agent_assisted", rule.rule_id);
  }
});

test("registered rule packs use yaml source of truth", () => {
  const packs = getRegisteredRulePacks();
  const languagePack = packs.find((pack) => pack.packId === "arkts-language");
  assert.ok(languagePack);
  assert.ok(languagePack.rules.some((rule) => rule.rule_id === "ARKTS-MUST-002"));
  assert.equal(
    languagePack.rules.find((rule) => rule.rule_id === "ARKTS-MUST-001")?.decision_criteria?.fail?.[0],
    "存在类型、枚举、接口或命名空间与变量或函数标识符冲突。",
  );
});

test("registered rule packs are sourced only from references/rules yaml", () => {
  const ruleReferenceDirectory = path.resolve(process.cwd(), "references/rules");
  const legacyRulePackDirectory = path.resolve(process.cwd(), "src/rules/packs");

  assert.equal(fs.existsSync(ruleReferenceDirectory), true);
  assert.deepEqual(
    fs
      .readdirSync(ruleReferenceDirectory)
      .filter((fileName) => fileName.endsWith(".yaml"))
      .sort(),
    [
      "arkts-language.yaml",
      "arkts-performance.yaml",
      "arkui-extra.yaml",
      "cross-device-adaptation.yaml",
    ],
  );
  assert.equal(fs.existsSync(legacyRulePackDirectory), false);
});
