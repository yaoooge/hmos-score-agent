import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import packageJson from "../package.json" with { type: "json" };
import { getRegisteredRulePacks } from "../src/rules/engine/rulePackRegistry.js";
import {
  buildRulePackYamlDocuments,
  defaultRulePackYamlOutputDirectory,
  serializeRulePackYamlDocument,
  writeRulePackYamlFiles,
} from "../src/rules/engine/rulePackYamlExporter.js";

test("builds minimal YAML documents for each registered rule pack", () => {
  const packs = getRegisteredRulePacks();
  const documents = buildRulePackYamlDocuments(packs);

  assert.equal(documents.length, 3);

  const arktsLanguage = documents.find((item) => item.packId === "arkts-language");
  assert.ok(arktsLanguage);
  assert.equal(arktsLanguage.fileName, "arkts-language.yaml");
  assert.equal(arktsLanguage.document.name, "ArkTS TypeScript 适配与编程规范融合规则包");
  assert.equal(arktsLanguage.document.version, "v1.0.0");
  assert.equal(arktsLanguage.document.rule_pack_meta.pack_id, "arkts-language");
  assert.equal(
    arktsLanguage.document.rule_pack_meta.source_name,
    "Huawei-ArkTS-TypeScript-Adaptation-Guide-and-Programming-Guide",
  );
  assert.equal(
    arktsLanguage.document.rule_pack_meta.source_version,
    "merged-html-and-v1-rules-2026-04-08",
  );
  assert.equal(arktsLanguage.document.must_rules.length, 10);
  assert.equal(arktsLanguage.document.should_rules.length, 11);
  assert.equal(arktsLanguage.document.forbidden_patterns.length, 26);

  const must004 = arktsLanguage.document.must_rules.find((item) => item.id === "ARKTS-MUST-001");
  assert.ok(must004);
  assert.equal(
    must004.rule,
    "类型、枚举、接口和命名空间名称必须唯一，且不得与变量或函数等标识符冲突。",
  );
  assert.equal(must004.detector_kind, "not_implemented");
  assert.deepEqual(must004.detector_config, {});
  assert.equal(must004.fallback_policy, "agent_assisted");

  const movedMust001 = arktsLanguage.document.forbidden_patterns.find(
    (item) => item.id === "ARKTS-FORBID-001",
  );
  assert.ok(movedMust001);
  assert.equal(
    movedMust001.rule,
    "对象属性名必须是合法标识符，禁止依赖数字键或普通字符串键的动态属性访问。",
  );
  assert.equal(movedMust001.detector_kind, "text_pattern");
  assert.deepEqual(movedMust001.detector_config.fileExtensions, [".ets"]);
  assert.equal(movedMust001.fallback_policy, "agent_assisted");

  const performance = documents.find((item) => item.packId === "arkts-performance");
  assert.ok(performance);
  assert.equal(performance.fileName, "arkts-performance.yaml");
  assert.equal(performance.document.name, "ArkTS 高性能编程实践规则包");
  assert.equal(performance.document.must_rules.length, 0);
  assert.equal(performance.document.should_rules.length, 6);
  assert.equal(performance.document.forbidden_patterns.length, 5);

  const crossDevice = documents.find((item) => item.packId === "cross-device-adaptation");
  assert.ok(crossDevice);
  assert.equal(crossDevice.fileName, "cross-device-adaptation.yaml");
  assert.equal(crossDevice.document.name, "HarmonyOS 一多适配通用规则包");
  assert.equal(crossDevice.document.rule_pack_meta.pack_id, "cross-device-adaptation");
  assert.equal(crossDevice.document.must_rules.length, 36);
  assert.equal(crossDevice.document.should_rules.length, 19);
  assert.equal(crossDevice.document.forbidden_patterns.length, 0);

  const breakpointRule = crossDevice.document.must_rules.find(
    (item) => item.id === "RSP-MUST-01",
  );
  assert.ok(breakpointRule);
  assert.equal(breakpointRule.detector_kind, "case_constraint");
  assert.deepEqual(breakpointRule.detector_config.targetPatterns, ["**/*.ets"]);
  assert.deepEqual(breakpointRule.detector_config.kit, ["ArkUI: GridRow / WidthBreakpoint"]);
  assert.match(breakpointRule.detector_config.llmPrompt as string, /横向断点划分必须为/);
  assert.deepEqual(breakpointRule.detector_config.targetChecks, [
    {
      target: "**/*.ets",
      astSignals: [],
      llmPrompt:
        "检查工程中自定义断点系统或 WidthBreakpointType 工具类的断点边界定义，横向断点划分必须为 xs:(0,320)、sm:[320,600)、md:[600,840)、lg:[840,1440)、xl:[1440,+∞)。若使用 GridRow 的 breakpoints.value，值必须为 ['320vp','600vp','840vp','1440vp']。断点边界值与系统推荐不一致即判定失败",
    },
  ]);
});

test("serializes exported rule pack documents as parseable YAML", () => {
  const [document] = buildRulePackYamlDocuments(getRegisteredRulePacks());
  assert.ok(document);

  const serialized = serializeRulePackYamlDocument(document.document);
  const parsed = yaml.load(serialized) as Record<string, unknown>;

  assert.equal(parsed.name, document.document.name);
  assert.deepEqual(Object.keys(parsed), [
    "name",
    "version",
    "summary",
    "rule_pack_meta",
    "must_rules",
    "should_rules",
    "forbidden_patterns",
  ]);
});

test("writes one YAML file per registered rule pack", async () => {
  const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rule-pack-yaml-export-"));

  const writtenFiles = await writeRulePackYamlFiles(getRegisteredRulePacks(), outputDirectory);

  assert.deepEqual(writtenFiles.map((filePath) => path.basename(filePath)).sort(), [
    "arkts-language.yaml",
    "arkts-performance.yaml",
    "cross-device-adaptation.yaml",
  ]);

  const languageYaml = await fs.readFile(path.join(outputDirectory, "arkts-language.yaml"), "utf8");
  const languageDocument = yaml.load(languageYaml) as {
    rule_pack_meta: { pack_id: string };
    must_rules: unknown[];
    should_rules: unknown[];
    forbidden_patterns: unknown[];
  };

  assert.equal(languageDocument.rule_pack_meta.pack_id, "arkts-language");
  assert.equal(languageDocument.must_rules.length, 10);
  assert.equal(languageDocument.should_rules.length, 11);
  assert.equal(languageDocument.forbidden_patterns.length, 26);

  const crossDeviceYaml = await fs.readFile(
    path.join(outputDirectory, "cross-device-adaptation.yaml"),
    "utf8",
  );
  const crossDeviceDocument = yaml.load(crossDeviceYaml) as {
    rule_pack_meta: { pack_id: string };
    must_rules: unknown[];
    should_rules: unknown[];
    forbidden_patterns: unknown[];
  };
  assert.equal(crossDeviceDocument.rule_pack_meta.pack_id, "cross-device-adaptation");
  assert.equal(crossDeviceDocument.must_rules.length, 36);
  assert.equal(crossDeviceDocument.should_rules.length, 19);
  assert.equal(crossDeviceDocument.forbidden_patterns.length, 0);
});

test("package exposes a rule pack YAML export script", () => {
  assert.equal(
    packageJson.scripts["rulepack:export"],
    "node --import tsx src/tools/generateRulePackYaml.ts",
  );
});

test("default rule pack YAML export directory is references/rules", () => {
  assert.equal(defaultRulePackYamlOutputDirectory, "references/rules");
});
