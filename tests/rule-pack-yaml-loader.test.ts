import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRegisteredRulePacksFromYamlDirectory } from "../src/rules/engine/rulePackYamlLoader.js";

test("loads built-in rule packs directly from references/rules yaml", () => {
  const packs = loadRegisteredRulePacksFromYamlDirectory(
    path.resolve(process.cwd(), "references/rules"),
  );

  assert.deepEqual(
    packs.map((pack) => pack.packId).sort(),
    ["arkts-language", "arkts-performance", "cross-device-adaptation"],
  );
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "ARKTS-MUST-002"));
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "RSP-MUST-01"));
});

test("loads case-constraint metadata from built-in yaml shape", () => {
  const packs = loadRegisteredRulePacksFromYamlDirectory(
    path.resolve(process.cwd(), "references/rules"),
  );
  const crossDeviceRule = packs
    .flatMap((pack) => pack.rules)
    .find((rule) => rule.rule_id === "RSP-MUST-01");

  assert.ok(crossDeviceRule);
  assert.equal(crossDeviceRule.rule_name, "横向断点划分范围必须符合系统推荐值");
  assert.equal(crossDeviceRule.priority, "P0");
  assert.deepEqual(crossDeviceRule.detector_config.kit, [
    "ArkUI: GridRow / WidthBreakpoint",
  ]);
});
