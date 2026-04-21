import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { DetectorKind, RegisteredRule, RegisteredRulePack } from "./ruleTypes.js";
import { rulePackYamlMetadataByPackId } from "./rulePackYamlMetadata.js";

export interface RulePackYamlRule {
  id: string;
  rule: string;
  detector_kind: DetectorKind;
  detector_config: Record<string, unknown>;
  fallback_policy: RegisteredRule["fallback_policy"];
}

export interface RulePackYamlDocument {
  name: string;
  version: string;
  summary: string;
  rule_pack_meta: {
    pack_id: string;
    source_name: string;
    source_version: string;
  };
  must_rules: RulePackYamlRule[];
  should_rules: RulePackYamlRule[];
  forbidden_patterns: RulePackYamlRule[];
}

export interface BuiltRulePackYamlDocument {
  packId: string;
  fileName: string;
  document: RulePackYamlDocument;
}

export async function writeRulePackYamlFiles(
  packs: RegisteredRulePack[],
  outputDirectory: string,
): Promise<string[]> {
  const documents = buildRulePackYamlDocuments(packs);
  await fs.mkdir(outputDirectory, { recursive: true });

  const writtenFiles: string[] = [];
  for (const item of documents) {
    const filePath = path.join(outputDirectory, item.fileName);
    await fs.writeFile(filePath, serializeRulePackYamlDocument(item.document), "utf8");
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

export function buildRulePackYamlDocuments(
  packs: RegisteredRulePack[],
): BuiltRulePackYamlDocument[] {
  return packs.map((pack) => {
    const metadata = rulePackYamlMetadataByPackId[pack.packId];
    if (!metadata) {
      throw new Error(`Missing YAML export metadata for rule pack: ${pack.packId}`);
    }

    const document: RulePackYamlDocument = {
      name: metadata.name,
      version: metadata.version,
      summary: metadata.summary,
      rule_pack_meta: {
        pack_id: pack.packId,
        source_name: metadata.source_name,
        source_version: metadata.source_version,
      },
      must_rules: pack.rules.filter((rule) => rule.rule_source === "must_rule").map(toYamlRule),
      should_rules: pack.rules.filter((rule) => rule.rule_source === "should_rule").map(toYamlRule),
      forbidden_patterns: pack.rules
        .filter((rule) => rule.rule_source === "forbidden_pattern")
        .map(toYamlRule),
    };

    return {
      packId: pack.packId,
      fileName: `${pack.packId}.yaml`,
      document,
    };
  });
}

export function serializeRulePackYamlDocument(document: RulePackYamlDocument): string {
  return yaml.dump(document, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
}

function toYamlRule(rule: RegisteredRule): RulePackYamlRule {
  return {
    id: rule.rule_id,
    rule: rule.summary,
    detector_kind: rule.detector_kind,
    detector_config: rule.detector_config,
    fallback_policy: rule.fallback_policy,
  };
}
