# Rule Pack YAML Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one minimal YAML rule-set file per registered rule pack under `reference/`.

**Architecture:** Add a small exporter module that converts registered runtime rule packs into plain YAML-ready objects, then add a CLI tool that writes those objects to disk. Keep export metadata separate from runtime rule execution so scoring behavior does not change.

**Tech Stack:** TypeScript ESM, Node.js built-in test runner, `js-yaml`, existing `tsx` test setup.

---

## File Structure

- Create: `src/rules/engine/rulePackYamlMetadata.ts`
  - Owns pack-level export metadata for `name`, `version`, `summary`, `source_name`, and `source_version`.
- Create: `src/rules/engine/rulePackYamlExporter.ts`
  - Converts `RegisteredRulePack[]` into YAML-ready documents.
  - Serializes documents with `js-yaml`.
  - Writes one file per pack to a target directory.
- Create: `src/tools/generateRulePackYaml.ts`
  - CLI entry point that writes exported YAML files to `reference/`.
- Create: `tests/rule-pack-yaml-export.test.ts`
  - Verifies object mapping, grouping, YAML parsing, file writing, and registry consistency.
- Modify: `package.json`
  - Adds `rulepack:export` script.
- Generate: `reference/arkts-language.yaml`
  - Exported YAML for the `arkts-language` pack.
- Generate: `reference/arkts-performance.yaml`
  - Exported YAML for the `arkts-performance` pack.

## Task 1: YAML Object Mapping

**Files:**
- Create: `tests/rule-pack-yaml-export.test.ts`
- Create: `src/rules/engine/rulePackYamlMetadata.ts`
- Create: `src/rules/engine/rulePackYamlExporter.ts`

- [ ] **Step 1: Write the failing mapping test**

Add this first test to `tests/rule-pack-yaml-export.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import yaml from "js-yaml";
import { getRegisteredRulePacks } from "../src/rules/engine/rulePackRegistry.js";
import {
  buildRulePackYamlDocuments,
  serializeRulePackYamlDocument,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: FAIL because `src/rules/engine/rulePackYamlExporter.ts` does not exist.

- [ ] **Step 3: Add export metadata**

Create `src/rules/engine/rulePackYamlMetadata.ts`:

```ts
export interface RulePackYamlMetadata {
  name: string;
  version: string;
  summary: string;
  source_name: string;
  source_version: string;
}

export const rulePackYamlMetadataByPackId: Record<string, RulePackYamlMetadata> = {
  "arkts-language": {
    name: "ArkTS TypeScript 适配与编程规范融合规则包",
    version: "v1.0.0",
    summary:
      "基于《从TypeScript到ArkTS的适配规则》与《ArkTS编程规范》融合提炼的内部规则包，按 must / should / forbidden 分类，用于 HarmonyOS NEXT 生成代码评分与审查。",
    source_name: "Huawei-ArkTS-TypeScript-Adaptation-Guide-and-Programming-Guide",
    source_version: "merged-html-and-v1-rules-2026-04-08",
  },
  "arkts-performance": {
    name: "ArkTS 高性能编程实践规则包",
    version: "v1.0.0",
    summary:
      "基于 ArkTS 高性能编程实践规则整理的内部规则包，按 should / forbidden 分类，用于识别 HarmonyOS NEXT 生成代码中的常见性能风险。",
    source_name: "Huawei-ArkTS-High-Performance-Programming-Practices",
    source_version: "performance-rules-2026-04-17",
  },
};
```

- [ ] **Step 4: Add minimal exporter implementation**

Create `src/rules/engine/rulePackYamlExporter.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: PASS for the two new exporter tests.

## Task 2: File Writing

**Files:**
- Modify: `tests/rule-pack-yaml-export.test.ts`
- Modify: `src/rules/engine/rulePackYamlExporter.ts`

- [ ] **Step 1: Write the failing file-writing test**

Append this test to `tests/rule-pack-yaml-export.test.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeRulePackYamlFiles } from "../src/rules/engine/rulePackYamlExporter.js";

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
```

- [ ] **Step 2: Run test to verify it fails if file writing is missing**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: FAIL if `writeRulePackYamlFiles` has not been exported yet. If Task 1 already included the implementation, this test may pass immediately; in that case, no production change is required for this task.

- [ ] **Step 3: Implement missing file-writing behavior if needed**

If `writeRulePackYamlFiles` was not added in Task 1, add this function to `src/rules/engine/rulePackYamlExporter.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: PASS for all exporter tests.

## Task 3: CLI Entry And npm Script

**Files:**
- Modify: `tests/rule-pack-yaml-export.test.ts`
- Create: `src/tools/generateRulePackYaml.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing package script test**

Append this test to `tests/rule-pack-yaml-export.test.ts`:

```ts
import packageJson from "../package.json" with { type: "json" };

test("package exposes a rule pack YAML export script", () => {
  assert.equal(
    packageJson.scripts["rulepack:export"],
    "node --import tsx src/tools/generateRulePackYaml.ts",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: FAIL because `package.json` does not yet include `rulepack:export`.

- [ ] **Step 3: Add CLI entry**

Create `src/tools/generateRulePackYaml.ts`:

```ts
import path from "node:path";
import { getRegisteredRulePacks } from "../rules/engine/rulePackRegistry.js";
import { writeRulePackYamlFiles } from "../rules/engine/rulePackYamlExporter.js";

const outputDirectory = path.resolve(process.cwd(), "reference");
const writtenFiles = await writeRulePackYamlFiles(getRegisteredRulePacks(), outputDirectory);

for (const filePath of writtenFiles) {
  console.log(`Wrote ${path.relative(process.cwd(), filePath)}`);
}
```

- [ ] **Step 4: Add npm script**

Modify `package.json` scripts to include:

```json
"rulepack:export": "node --import tsx src/tools/generateRulePackYaml.ts"
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: PASS for all exporter tests.

## Task 4: Generate Reference YAML And Verify

**Files:**
- Generate: `reference/arkts-language.yaml`
- Generate: `reference/arkts-performance.yaml`

- [ ] **Step 1: Run full targeted test suite**

Run:

```bash
npm test -- tests/rule-pack-yaml-export.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run export command**

Run:

```bash
npm run rulepack:export
```

Expected output includes:

```text
Wrote reference/arkts-language.yaml
Wrote reference/arkts-performance.yaml
```

- [ ] **Step 3: Verify generated files exist**

Run:

```bash
ls reference
```

Expected output includes:

```text
arkts-language.yaml
arkts-performance.yaml
```

- [ ] **Step 4: Run project tests**

Run:

```bash
npm test
```

Expected: PASS for the full test suite.

- [ ] **Step 5: Check git diff for intended scope**

Run:

```bash
git status --short
```

Expected: only the planned exporter files, generated `reference/*.yaml`, `package.json`, and test file are new or modified, plus any unrelated pre-existing user changes already present before this work.

## Self-Review

- Spec coverage: The plan covers one YAML file per registered pack, output to `reference/`, minimal top-level fields, minimal rule fields, pack metadata, repeatable export, and tests.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `RulePackYamlDocument`, `RulePackYamlRule`, and `BuiltRulePackYamlDocument` names are consistent across tests and implementation snippets.
