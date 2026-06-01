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
    ["arkts-language", "arkts-performance", "arkui-extra", "cross-device-adaptation"],
  );
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "ARKTS-MUST-002"));
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "ARKUI-MUST-001"));
  assert.ok(packs.flatMap((pack) => pack.rules).some((rule) => rule.rule_id === "RSP-MUST-01"));
});

test("loads built-in rule pack versions from yaml", () => {
  const packs = loadRegisteredRulePacksFromYamlDirectory(
    path.resolve(process.cwd(), "references/rules"),
  );

  assert.deepEqual(
    packs.map((pack) => [pack.packId, pack.version]).sort(),
    [
      ["arkts-language", "v1.0.0"],
      ["arkts-performance", "v1.0.0"],
      ["arkui-extra", "v1.0.0"],
      ["cross-device-adaptation", "v1.0.0"],
    ],
  );
});

test("loads arkui-extra rules with arkui extra detector metadata", () => {
  const packs = loadRegisteredRulePacksFromYamlDirectory(
    path.resolve(process.cwd(), "references/rules"),
  );
  const arkuiPack = packs.find((pack) => pack.packId === "arkui-extra");

  assert.ok(arkuiPack);
  assert.deepEqual(
    arkuiPack.rules.map((rule) => rule.rule_id),
    ["ARKUI-MUST-001", "ARKUI-FORBID-001"],
  );
  assert.deepEqual(
    arkuiPack.rules.map((rule) => rule.detector_kind),
    ["arkui_extra", "arkui_extra"],
  );
  assert.equal(arkuiPack.rules[0]?.detector_config.check, "route_navdestination");
  assert.equal(arkuiPack.rules[1]?.detector_config.check, "multi_bindsheet_same_component");
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
