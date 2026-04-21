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

  assert.equal(documents.length, 2);

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
  assert.equal(arktsLanguage.document.must_rules.length, 30);
  assert.equal(arktsLanguage.document.should_rules.length, 21);
  assert.equal(arktsLanguage.document.forbidden_patterns.length, 12);

  const must001 = arktsLanguage.document.must_rules.find((item) => item.id === "ARKTS-MUST-001");
  assert.ok(must001);
  assert.equal(
    must001.rule,
    "对象属性名必须是合法标识符，禁止依赖数字键或普通字符串键的动态属性访问。",
  );
  assert.equal(must001.detector_kind, "text_pattern");
  assert.deepEqual(must001.detector_config.fileExtensions, [".ets"]);
  assert.equal(must001.fallback_policy, "agent_assisted");

  const performance = documents.find((item) => item.packId === "arkts-performance");
  assert.ok(performance);
  assert.equal(performance.fileName, "arkts-performance.yaml");
  assert.equal(performance.document.name, "ArkTS 高性能编程实践规则包");
  assert.equal(performance.document.must_rules.length, 0);
  assert.equal(performance.document.should_rules.length, 6);
  assert.equal(performance.document.forbidden_patterns.length, 5);
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

  assert.deepEqual(
    writtenFiles.map((filePath) => path.basename(filePath)).sort(),
    ["arkts-language.yaml", "arkts-performance.yaml"],
  );

  const languageYaml = await fs.readFile(path.join(outputDirectory, "arkts-language.yaml"), "utf8");
  const languageDocument = yaml.load(languageYaml) as {
    rule_pack_meta: { pack_id: string };
    must_rules: unknown[];
    should_rules: unknown[];
    forbidden_patterns: unknown[];
  };

  assert.equal(languageDocument.rule_pack_meta.pack_id, "arkts-language");
  assert.equal(languageDocument.must_rules.length, 30);
  assert.equal(languageDocument.should_rules.length, 21);
  assert.equal(languageDocument.forbidden_patterns.length, 12);
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
