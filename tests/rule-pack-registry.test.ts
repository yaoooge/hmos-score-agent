import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getRegisteredRulePacks,
  listRegisteredRules,
} from "../src/rules/engine/rulePackRegistry.js";

test("arkts-language pack registers all rules from current source set", () => {
  const packs = getRegisteredRulePacks();
  const arktsPack = packs.find((item) => item.packId === "arkts-language");

  assert.ok(arktsPack);
  const rules = arktsPack.rules;
  assert.equal(rules.filter((item) => item.rule_source === "must_rule").length, 10);
  assert.equal(rules.filter((item) => item.rule_source === "should_rule").length, 21);
  assert.equal(rules.filter((item) => item.rule_source === "forbidden_pattern").length, 26);
  assert.equal(rules.length, 57);
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

  const rules = listRegisteredRules();
  assert.equal(rules.length, 68);
});

test("registered rules carry real summaries and detector configs instead of placeholder entries", () => {
  const rules = listRegisteredRules();
  const movedMust002 = rules.find((item) => item.rule_id === "ARKTS-FORBID-002");
  const should021 = rules.find((item) => item.rule_id === "ARKTS-SHOULD-021");
  const forbid002 = rules.find((item) => item.rule_id === "ARKTS-FORBID-021");
  const must004 = rules.find((item) => item.rule_id === "ARKTS-MUST-001");
  const should012 = rules.find((item) => item.rule_id === "ARKTS-SHOULD-012");

  assert.ok(movedMust002);
  assert.equal(movedMust002.rule_source, "forbidden_pattern");
  assert.equal(movedMust002.detector_kind, "text_pattern");
  assert.match(movedMust002.summary, /Symbol/);
  assert.deepEqual(movedMust002.detector_config.fileExtensions, [".ets"]);

  assert.ok(should021);
  assert.equal(should021.detector_kind, "text_pattern");
  assert.match(should021.summary, /Array<T>|T\[\]/);

  assert.ok(forbid002);
  assert.equal(forbid002.detector_kind, "text_pattern");
  assert.match(forbid002.summary, /\bin\b/);

  assert.ok(must004);
  assert.equal(must004.rule_source, "must_rule");
  assert.equal(must004.detector_kind, "not_implemented");
  assert.doesNotMatch(must004.summary, /当前默认进入静态规则包/);

  assert.ok(should012);
  assert.equal(should012.detector_kind, "text_pattern");
  assert.deepEqual(should012.detector_config.fileExtensions, [".ets"]);
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

test("arkts rule pack source files exist for runtime loading", () => {
  for (const relativePath of [
    "src/rules/packs/arkts-language/must.ts",
    "src/rules/packs/arkts-language/should.ts",
    "src/rules/packs/arkts-language/forbidden.ts",
    "src/rules/packs/arkts-performance/must.ts",
    "src/rules/packs/arkts-performance/should.ts",
    "src/rules/packs/arkts-performance/forbidden.ts",
  ]) {
    assert.equal(fs.existsSync(path.resolve(process.cwd(), relativePath)), true, relativePath);
  }
});
