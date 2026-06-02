import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRegisteredRulePacksFromYamlDirectory } from "../src/rules/engine/rulePackYamlLoader.js";

async function makeTempRulePackDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-rule-pack-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

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
    arkuiPack.rules.map((rule) => rule.detector),
    [
      {
        kind: "static",
        mode: "arkui_extra",
        config: { check: "route_navdestination" },
      },
      {
        kind: "static",
        mode: "arkui_extra",
        config: { check: "multi_bindsheet_same_component" },
      },
    ],
  );
  assert.deepEqual(arkuiPack.rules[0]?.fallback, { policy: "agent_assisted" });
  assert.equal(arkuiPack.rules[0]?.decisionCriteria?.notApplicable?.[0], "module.json5 未配置 routerMap。");
  assert.equal(arkuiPack.rules[0]?.profile?.riskCode, "API_USAGE_DEVIATION");
});

test("loads cross-device rules as built-in unified-schema rules", () => {
  const packs = loadRegisteredRulePacksFromYamlDirectory(
    path.resolve(process.cwd(), "references/rules"),
  );
  const crossDeviceRule = packs
    .flatMap((pack) => pack.rules)
    .find((rule) => rule.rule_id === "RSP-MUST-01");

  assert.ok(crossDeviceRule);
  assert.equal(crossDeviceRule.rule_name, "横向断点划分范围必须符合系统推荐值");
  assert.equal(crossDeviceRule.priority, "P0");
  assert.deepEqual(crossDeviceRule.detector, {
    kind: "static",
    mode: "case_constraint_precheck",
    config: {
      targetPatterns: ["**/*.ets"],
      kit: ["ArkUI: GridRow / WidthBreakpoint"],
      targetChecks: [
        {
          target: "**/*.ets",
          astSignals: [],
          llmPrompt:
            "检查工程中自定义断点系统或 WidthBreakpointType 工具类的断点边界定义，横向断点划分必须为 xs:(0,320)、sm:[320,600)、md:[600,840)、lg:[840,1440)、xl:[1440,+∞)。若使用 GridRow 的 breakpoints.value，值必须为 ['320vp','600vp','840vp','1440vp']。断点边界值与系统推荐不一致即判定失败",
        },
      ],
    },
  });
  assert.deepEqual(crossDeviceRule.detector.config.kit, [
    "ArkUI: GridRow / WidthBreakpoint",
  ]);
  assert.equal(crossDeviceRule.profile?.riskCode, "API_USAGE_DEVIATION");
});

test("rejects legacy detector fields in built-in rule pack yaml", async (t) => {
  const dir = await makeTempRulePackDir(t);
  await fs.writeFile(
    path.join(dir, "legacy.yaml"),
    [
      "name: Legacy",
      "version: v1",
      "rule_pack_meta:",
      "  pack_id: legacy",
      "  source_name: test",
      "  source_version: test",
      "must_rules:",
      "  - id: LEGACY-MUST-001",
      "    rule: legacy fields are rejected",
      "    detector_kind: text_pattern",
      "    detector_config: {}",
      "    fallback_policy: agent_assisted",
      "should_rules: []",
      "forbidden_patterns: []",
      "",
    ].join("\n"),
    "utf-8",
  );

  assert.throws(
    () => loadRegisteredRulePacksFromYamlDirectory(dir),
    /Unsupported field.*detector_kind/,
  );
});
