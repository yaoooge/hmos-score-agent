import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectEvidence } from "../src/rules/evidenceCollector.js";
import { runTextPatternRule } from "../src/rules/evaluators/textPatternEvaluator.js";
import {
  defaultEnabledRulePackIds,
  getEnabledRulePacks,
  listRegisteredRules,
  resolveEnabledRulePackIds,
} from "../src/rules/engine/rulePackRegistry.js";
import { runRuleEngine } from "../src/rules/ruleEngine.js";
import type { CaseInput, CaseRuleDefinition } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

// 这组测试验证“真实规则顺序 + 首批支持规则命中”两件事。
async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rule-engine-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function createRuleFixture(
  t: test.TestContext,
  files: Record<string, string>,
): Promise<string> {
  const caseDir = await makeTempDir(t);
  await fs.mkdir(path.join(caseDir, "original"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "input.txt"), "修复 ArkTS 类型问题", "utf-8");
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    "@@ -0,0 +1,2 @@\n+let x: any = 1;\n+var y = 2;\n",
    "utf-8",
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(caseDir, "workspace", relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf-8");
  }

  return caseDir;
}

function makeCaseInput(caseDir: string): CaseInput {
  return {
    caseId: path.basename(caseDir),
    promptText: "修复 ArkTS 类型问题",
    originalProjectPath: path.join(caseDir, "original"),
    generatedProjectPath: path.join(caseDir, "workspace"),
    patchPath: path.join(caseDir, "diff", "changes.patch"),
  };
}

test("runRuleEngine keeps source order and flags supported violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let x: any = 1;\nvar y = 2;\nclass A { #secret = 1; }\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(result.staticRuleAuditResults[0]?.rule_id, "ARKTS-MUST-001");
  assert.ok(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
  );
  assert.ok(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-005" && item.result === "不满足",
    ),
  );
  assert.ok(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-003" && item.result === "不满足",
    ),
  );
  assert.ok(result.ruleViolations.length >= 1);
});

test("resolveEnabledRulePackIds only enables cross-device pack for involved tasks", () => {
  assert.deepEqual(resolveEnabledRulePackIds({}), [
    "arkts-language",
    "arkts-performance",
    "arkui-extra",
  ]);
  assert.deepEqual(
    resolveEnabledRulePackIds({
      crossDeviceAdaptation: {
        applicability: "not_involved",
        confidence: "high",
        reasons: ["需求未涉及一多适配"],
      },
    }),
    ["arkts-language", "arkts-performance", "arkui-extra"],
  );
  assert.deepEqual(
    resolveEnabledRulePackIds({
      crossDeviceAdaptation: {
        applicability: "uncertain",
        confidence: "low",
        reasons: ["信息不足"],
      },
    }),
    ["arkts-language", "arkts-performance", "arkui-extra"],
  );
  assert.deepEqual(
    resolveEnabledRulePackIds({
      crossDeviceAdaptation: {
        applicability: "involved",
        confidence: "high",
        reasons: ["需求明确要求一多适配"],
      },
    }),
    ["arkts-language", "arkts-performance", "arkui-extra", "cross-device-adaptation"],
  );
});

test("rule pack registry filters built-in packs by enabled pack ids", () => {
  assert.deepEqual(
    getEnabledRulePacks(["arkts-language"]).map((pack) => pack.packId),
    ["arkts-language"],
  );
  assert.equal(
    listRegisteredRules({ enabledPackIds: ["arkts-language"] }).some(
      (rule) => rule.pack_id === "arkts-performance",
    ),
    false,
  );
});

test("runRuleEngine flags configured routerMap with missing profile as not satisfied", async (t) => {
  const moduleJsonPath = "entry/src/main/module.json5";
  const caseDir = await createRuleFixture(t, {
    [moduleJsonPath]: "{ module: { name: 'entry', routerMap: '$profile:route_map' } }\n",
  });
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${moduleJsonPath} b/${moduleJsonPath}`,
      `--- a/${moduleJsonPath}`,
      `+++ b/${moduleJsonPath}`,
      "@@ -1,1 +1,1 @@",
      `-{ module: { name: 'entry' } }`,
      `+{ module: { name: 'entry', routerMap: '$profile:route_map' } }`,
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const routeRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-MUST-001",
  );

  assert.ok(routeRule);
  assert.equal(routeRule.result, "不满足");
  assert.match(routeRule.conclusion, /route_map\.json/);
});

test("runRuleEngine treats modules without routerMap as not involved", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/module.json5": "{ module: { name: 'entry' } }\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const routeRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-MUST-001",
  );

  assert.ok(routeRule);
  assert.equal(routeRule.result, "不涉及");
});

test("runRuleEngine flags routerMap pages missing NavDestination", async (t) => {
  const moduleJsonPath = "entry/src/main/module.json5";
  const routeMapPath = "entry/src/main/resources/base/profile/route_map.json";
  const pagePath = "entry/src/main/ets/pages/Index.ets";
  const caseDir = await createRuleFixture(t, {
    [moduleJsonPath]: "{ module: { name: 'entry', routerMap: '$profile:route_map' } }\n",
    [routeMapPath]: JSON.stringify({
      routerMap: [{ name: "Index", pageSourceFile: "src/main/ets/pages/Index" }],
    }),
    [pagePath]: [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() { Text('home') }",
      "  }",
      "}",
      "",
    ].join("\n"),
  });
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${routeMapPath} b/${routeMapPath}`,
      `--- a/${routeMapPath}`,
      `+++ b/${routeMapPath}`,
      "@@ -1,1 +1,1 @@",
      `-{"routerMap":[]}`,
      `+{"routerMap":[{"name":"Index","pageSourceFile":"src/main/ets/pages/Index"}]}`,
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const routeRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-MUST-001",
  );

  assert.ok(routeRule);
  assert.equal(routeRule.result, "不满足");
  assert.match(routeRule.conclusion, /NavDestination/);
});

test("runRuleEngine resolves .ets routerMap page paths relative to the module root", async (t) => {
  const moduleJsonPath = "features/order/src/main/module.json5";
  const routeMapPath = "features/order/src/main/resources/base/profile/router_map.json";
  const pagePath = "features/order/src/main/ets/pages/ExplainPage.ets";
  const caseDir = await createRuleFixture(t, {
    [moduleJsonPath]: "{ module: { name: 'order', routerMap: '$profile:router_map' } }\n",
    [routeMapPath]: JSON.stringify({
      routerMap: [{ name: "ExplainPage", pageSourceFile: "src/main/ets/pages/ExplainPage.ets" }],
    }),
    [pagePath]: [
      "@Builder",
      "export function ExplainPageBuilder() { ExplainPage(); }",
      "@ComponentV2",
      "struct ExplainPage {",
      "  build() {",
      "    NavDestination() { Text('explain') }",
      "  }",
      "}",
      "",
    ].join("\n"),
  });
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${routeMapPath} b/${routeMapPath}`,
      `--- a/${routeMapPath}`,
      `+++ b/${routeMapPath}`,
      "@@ -1,1 +1,1 @@",
      `-{"routerMap":[]}`,
      `+{"routerMap":[{"name":"ExplainPage","pageSourceFile":"src/main/ets/pages/ExplainPage.ets"}]}`,
      `diff --git a/${pagePath} b/${pagePath}`,
      "--- /dev/null",
      `+++ b/${pagePath}`,
      "@@ -0,0 +1,8 @@",
      "+@Builder",
      "+export function ExplainPageBuilder() { ExplainPage(); }",
      "+@ComponentV2",
      "+struct ExplainPage {",
      "+  build() {",
      "+    NavDestination() { Text('explain') }",
      "+  }",
      "+}",
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const routeRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-MUST-001",
  );

  assert.ok(routeRule);
  assert.equal(routeRule.result, "满足");
  assert.deepEqual(result.ruleEvidenceIndex["ARKUI-MUST-001"]?.evidenceFiles, [pagePath]);
});

test("runRuleEngine only reports patch-scoped routerMap targets as NavDestination evidence", async (t) => {
  const moduleJsonPath = "features/order/src/main/module.json5";
  const routeMapPath = "features/order/src/main/resources/base/profile/router_map.json";
  const legacyPagePath = "features/order/src/main/ets/pages/LegacyPage.ets";
  const addedPagePath = "features/order/src/main/ets/pages/AddedPage.ets";
  const caseDir = await createRuleFixture(t, {
    [moduleJsonPath]: "{ module: { name: 'order', routerMap: '$profile:router_map' } }\n",
    [routeMapPath]: JSON.stringify({
      routerMap: [
        { name: "LegacyPage", pageSourceFile: "src/main/ets/pages/LegacyPage.ets" },
        { name: "AddedPage", pageSourceFile: "src/main/ets/pages/AddedPage.ets" },
      ],
    }),
    [legacyPagePath]: [
      "@Component",
      "struct LegacyPage {",
      "  build() {",
      "    Column() { Text('legacy') }",
      "  }",
      "}",
      "",
    ].join("\n"),
    [addedPagePath]: [
      "@Component",
      "struct AddedPage {",
      "  build() {",
      "    Column() { Text('added') }",
      "  }",
      "}",
      "",
    ].join("\n"),
  });
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${routeMapPath} b/${routeMapPath}`,
      `--- a/${routeMapPath}`,
      `+++ b/${routeMapPath}`,
      "@@ -1,1 +1,1 @@",
      `-{"routerMap":[{"name":"LegacyPage","pageSourceFile":"src/main/ets/pages/LegacyPage.ets"}]}`,
      `+{"routerMap":[{"name":"LegacyPage","pageSourceFile":"src/main/ets/pages/LegacyPage.ets"},{"name":"AddedPage","pageSourceFile":"src/main/ets/pages/AddedPage.ets"}]}`,
      `diff --git a/${addedPagePath} b/${addedPagePath}`,
      "--- /dev/null",
      `+++ b/${addedPagePath}`,
      "@@ -0,0 +1,6 @@",
      "+@Component",
      "+struct AddedPage {",
      "+  build() {",
      "+    Column() { Text('added') }",
      "+  }",
      "+}",
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const routeRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-MUST-001",
  );

  assert.ok(routeRule);
  assert.equal(routeRule.result, "不满足");
  assert.deepEqual(result.ruleViolations.find((item) => item.rule_id === "ARKUI-MUST-001")?.affected_items, [
    addedPagePath,
  ]);
  assert.match(routeRule.conclusion, /AddedPage\.ets/);
  assert.doesNotMatch(routeRule.conclusion, /LegacyPage\.ets/);
});

test("runRuleEngine flags multiple bindSheet calls chained on the same component", async (t) => {
  const pagePath = "entry/src/main/ets/pages/Index.ets";
  const caseDir = await createRuleFixture(t, {
    [pagePath]: [
      "@Entry",
      "@Component",
      "struct Index {",
      "  @State first: boolean = false;",
      "  @State second: boolean = false;",
      "  build() {",
      "    Button('open')",
      "      .bindSheet(this.first, this.firstBuilder())",
      "      .bindSheet(this.second, this.secondBuilder())",
      "  }",
      "}",
      "",
    ].join("\n"),
  });
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${pagePath} b/${pagePath}`,
      `--- a/${pagePath}`,
      `+++ b/${pagePath}`,
      "@@ -6,4 +6,5 @@ struct Index {",
      "   build() {",
      "     Button('open')",
      "+      .bindSheet(this.first, this.firstBuilder())",
      "+      .bindSheet(this.second, this.secondBuilder())",
      "   }",
      " }",
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const bindSheetRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-FORBID-001",
  );

  assert.ok(bindSheetRule);
  assert.equal(bindSheetRule.result, "不满足");
  assert.match(bindSheetRule.conclusion, /bindSheet/);
  assert.ok(result.ruleViolations.some((item) => item.rule_id === "ARKUI-FORBID-001"));
});

test("runRuleEngine allows separate components to use one bindSheet each", async (t) => {
  const pagePath = "entry/src/main/ets/pages/Index.ets";
  const caseDir = await createRuleFixture(t, {
    [pagePath]: [
      "@Entry",
      "@Component",
      "struct Index {",
      "  @State first: boolean = false;",
      "  @State second: boolean = false;",
      "  build() {",
      "    Column() {",
      "      Button('first')",
      "        .bindSheet(this.first, this.firstBuilder())",
      "      Button('second')",
      "        .bindSheet(this.second, this.secondBuilder())",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"),
  });
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${pagePath} b/${pagePath}`,
      `--- a/${pagePath}`,
      `+++ b/${pagePath}`,
      "@@ -7,4 +7,6 @@ struct Index {",
      "       Button('first')",
      "+        .bindSheet(this.first, this.firstBuilder())",
      "       Button('second')",
      "+        .bindSheet(this.second, this.secondBuilder())",
      "     }",
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const bindSheetRule = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKUI-FORBID-001",
  );

  assert.ok(bindSheetRule);
  assert.equal(bindSheetRule.result, "满足");
});

test("cross-device component precheck uses full changed file content for kit anchors", async (t) => {
  const caseDir = await makeTempDir(t);
  const relativePath = "entry/src/main/ets/pages/Index.ets";
  const workspaceFile = [
    "@Entry",
    "@Component",
    "struct Index {",
    "  private currentDisplayCount: number = 2;",
    "",
    "  build() {",
    "    Swiper() {",
    "      Text('A')",
    "      Text('B')",
    "    }",
    "    .displayCount(this.currentDisplayCount)",
    "  }",
    "}",
    "",
  ].join("\n");

  await fs.mkdir(path.join(caseDir, "original", path.dirname(relativePath)), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseDir, "workspace", path.dirname(relativePath)), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "workspace", relativePath), workspaceFile, "utf-8");
  await fs.writeFile(
    path.join(caseDir, "original", relativePath),
    workspaceFile.replace(
      ".displayCount(this.currentDisplayCount)",
      ".displayCount(1)",
    ),
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      `diff --git a/${relativePath} b/${relativePath}`,
      `--- a/${relativePath}`,
      `+++ b/${relativePath}`,
      "@@ -8,7 +8,7 @@ struct Index {",
      "       Text('A')",
      "       Text('B')",
      "     }",
      "-    .displayCount(1)",
      "+    .displayCount(this.currentDisplayCount)",
      "   }",
      " }",
      "",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
    enabledRulePackIds: ["cross-device-adaptation"],
  });

  const candidate = result.assistedRuleCandidates.find(
    (item) => item.rule_id === "CMP-MUST-03",
  );

  assert.ok(candidate);
  assert.equal(candidate.static_precheck?.signal_status, "all_matched");
  assert.deepEqual(candidate.static_precheck?.matched_tokens, ["Swiper"]);
  assert.deepEqual(candidate.evidence_files, [relativePath]);
});

test("ARKTS-FORBID-006 ignores typed arrow function callbacks", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-006");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "components/collect_personal_info/src/main/ets/common/ProfileUtils.ets",
        content: [
          "export const formatDate = (format: string): string => {",
          "  return format.replace(/Y{2,4}/g,",
          "    (match: string, escaped: string): string => escaped || match)",
          "}",
        ].join("\n"),
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("ARKTS-FORBID-006 flags object type call signatures", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-006");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "interface Callable {\n  (value: number): string;\n}\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:2"]);
});

test("ARKTS-FORBID-021 ignores text inside string literals", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-021");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "Logger.debug(TAG, 'pause the avplayer, when stop the pip in background');\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("ARKTS-FORBID-021 flags real in membership checks", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-021");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "if ('name' in userInfo) {\n  Logger.debug(TAG, 'has name');\n}\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
});

test("ARKTS-FORBID-026 ignores control flow after a safe finally block", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-026");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "components/module_secure_checkin/src/main/ets/viewmodels/CheckinPageVM.ets",
        content: [
          "async function submit(): Promise<void> {",
          "  try {",
          "    await sendRequest();",
          "  } finally {",
          "    this.isLoading = false;",
          "  }",
          "  throw new Error('outside finally');",
          "}",
        ].join("\n"),
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("ARKTS-FORBID-026 flags control flow inside a finally block", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-026");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: [
          "function load(): void {",
          "  try {",
          "    run();",
          "  } finally {",
          "    throw new Error('inside finally');",
          "  }",
          "}",
        ].join("\n"),
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:5"]);
});

test("ARKTS-FORBID-003 ignores hex colors inside string literals", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-003");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: ".backgroundColor(isActive ? '#cedefd' : ' #f3f3f3')\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("ARKTS-FORBID-003 flags real private field syntax", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-003");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "class Demo {\n  #secret: string = '';\n}\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:2"]);
});

test("ARKTS-SHOULD-011 ignores numbered list text inside string literals", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-SHOULD-011");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "Text('1. 查询信息；\\n' + '2. 删除信息；')\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("ARKTS-SHOULD-011 flags omitted leading or trailing zero in numeric literals", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-SHOULD-011");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "const opacity = .5;\nconst ratio = 1.;\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, [
    "entry/src/main/ets/pages/Index.ets:1",
    "entry/src/main/ets/pages/Index.ets:2",
  ]);
});

test("ARKTS-PERF-FORBID-003 ignores numbers inside string elements", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-PERF-FORBID-003");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "colors: [['rgba(0,0,0,0)', 0], ['rgba(0,0,0,0.7)', 1]]\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("ARKTS-PERF-FORBID-003 flags mixed integer and float numeric arrays", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-PERF-FORBID-003");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "const values = [0, 0.7, 1];\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:1"]);
});

test("ARKTS-FORBID-025 ignores strict equality against equals string literal", () => {
  const rule = listRegisteredRules().find((item) => item.rule_id === "ARKTS-FORBID-025");
  assert.ok(rule);

  const result = runTextPatternRule(rule, {
    workspaceFiles: [
      {
        relativePath: "entry/src/main/ets/pages/Index.ets",
        content: "if (button.value === '=') {\n  result = calcModel.calculate();\n}\n",
      },
    ],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 1,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  });

  assert.equal(result.result, "满足");
  assert.deepEqual(result.matchedLocations, []);
});

test("runRuleEngine exposes only current rule-audit fields", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal("ruleAuditResults" in result, false);
  assert.equal(
    result.staticRuleAuditResults.some((item) => item.result === "未接入判定器"),
    true,
  );
});

test("runRuleEngine routes all runtime case rules to agent candidates and keeps static results non-final", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets":
      "import { LoginWithHuaweiIDButton } from '@kit.AccountKit';\nLoginWithHuaweiIDButton()\n",
    "entry/src/main/module.json5": '{ "module": { "name": "entry" } }\n',
  });

  const runtimeRules: CaseRuleDefinition[] = [
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      rule_source: "must_rule",
      summary: "登录页必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/pages/*.ets"],
        astSignals: [
          { type: "import", module: "@kit.AccountKit" },
          { type: "call", name: "LoginWithHuaweiIDButton" },
        ],
        llmPrompt: "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
        kit: ["Account Kit"],
        targetChecks: [
          {
            target: "**/pages/*.ets",
            astSignals: [
              { type: "import", module: "@kit.AccountKit" },
              { type: "call", name: "LoginWithHuaweiIDButton" },
            ],
            llmPrompt: "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
          },
        ],
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
    {
      pack_id: "case-requirement_004",
      rule_id: "HM-REQ-008-06",
      rule_name: "module.json5 需配置 Client ID",
      rule_source: "should_rule",
      summary: "module.json5 需配置 Client ID",
      priority: "P1",
      detector_kind: "case_constraint",
      detector_config: {
        targetPatterns: ["**/module.json5"],
        astSignals: [{ type: "json_key", name: "metadata" }],
        llmPrompt: "检查 module.json5 是否配置 metadata",
      },
      fallback_policy: "agent_assisted",
      is_case_rule: true,
    },
  ];

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules,
  });

  assert.equal(result.caseRuleResults.length, 0);
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "HM-REQ-008-01"),
    false,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-01"),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-06"),
    true,
  );
  assert.deepEqual(
    result.assistedRuleCandidates.find((item) => item.rule_id === "HM-REQ-008-01")?.kit,
    ["Account Kit"],
  );
  assert.deepEqual(
    result.assistedRuleCandidates.find((item) => item.rule_id === "HM-REQ-008-01")
      ?.target_checks,
    [
      {
        target: "**/pages/*.ets",
        ast_signals: [
          { type: "import", module: "@kit.AccountKit" },
          { type: "call", name: "LoginWithHuaweiIDButton" },
        ],
        llm_prompt: "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
      },
    ],
  );
  assert.equal(
    result.staticRuleAuditResults.some(
      (item) => item.rule_id === "HM-REQ-008-01" && item.result === "未接入判定器",
    ),
    true,
  );
});

test("runRuleEngine derives candidate llm prompt from target checks when summary prompt is omitted", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "Text('hello')\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_004",
        rule_id: "HM-REQ-008-01",
        rule_name: "必须使用 LoginWithHuaweiIDButton",
        rule_source: "must_rule",
        summary: "登录页必须使用 LoginWithHuaweiIDButton",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/pages/*.ets"],
          astSignals: [],
          targetChecks: [
            {
              target: "**/pages/*.ets",
              astSignals: [],
              llmPrompt: "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
            },
          ],
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  const candidate = result.assistedRuleCandidates.find(
    (item) => item.rule_id === "HM-REQ-008-01",
  );

  assert.ok(candidate);
  assert.equal(
    candidate.llm_prompt,
    "检查是否从 @kit.AccountKit 导入并使用 LoginWithHuaweiIDButton",
  );
});

test("runRuleEngine uses kit anchors for static precheck on runtime case rules", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "GridRow({",
      "  breakpoints: { value: ['320vp', '600vp', '840vp', '1440vp'] },",
      "}) {",
      "  Text(WidthBreakpoint.MD)",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_rsp",
        rule_id: "RSP-MUST-01",
        rule_name: "横向断点划分范围必须符合系统推荐值",
        rule_source: "must_rule",
        summary: "横向断点划分范围必须符合系统推荐值",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/*.ets"],
          astSignals: [],
          llmPrompt:
            "检查工程中自定义断点系统或 WidthBreakpointType 工具类的断点边界定义，横向断点划分必须为 xs:(0,320)、sm:[320,600)、md:[600,840)、lg:[840,1440)、xl:[1440,+∞)。若使用 GridRow 的 breakpoints.value，值必须为 ['320vp','600vp','840vp','1440vp']。",
          kit: ["ArkUI: GridRow / WidthBreakpoint"],
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  const candidate = result.assistedRuleCandidates.find((item) => item.rule_id === "RSP-MUST-01");

  assert.ok(candidate);
  assert.equal(candidate.static_precheck?.signal_status, "all_matched");
  assert.deepEqual(candidate.static_precheck?.matched_tokens, ["GridRow", "WidthBreakpoint"]);
  assert.match(candidate.static_precheck?.summary ?? "", /Kit 静态锚点/);
});

test("runRuleEngine does not expose unmatched case-constraint target files as evidence files", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "Text('plain page')\n",
    "entry/src/main/ets/components/Card.ets": "Column() {}\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_rsp",
        rule_id: "RSP-MUST-01",
        rule_name: "横向断点划分范围必须符合系统推荐值",
        rule_source: "must_rule",
        summary: "横向断点划分范围必须符合系统推荐值",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/*.ets"],
          astSignals: [],
          llmPrompt: "检查工程中自定义断点系统或 WidthBreakpointType 工具类的断点边界定义",
          kit: ["ArkUI: GridRow / WidthBreakpoint"],
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  const candidate = result.assistedRuleCandidates.find((item) => item.rule_id === "RSP-MUST-01");

  assert.ok(candidate);
  assert.equal(candidate.static_precheck?.signal_status, "none_matched");
  assert.deepEqual(candidate.static_precheck?.target_files, [
    "entry/src/main/ets/components/Card.ets",
    "entry/src/main/ets/pages/Index.ets",
  ]);
  assert.deepEqual(candidate.evidence_files, []);
});

test("runRuleEngine treats ArkUI slash-separated kit components as OR evidence", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Tabs() {",
      "    }",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_tabs",
        rule_id: "RSP-MUST-TABS",
        rule_name: "底部导航必须使用 Tabs 或 TabContent",
        rule_source: "must_rule",
        summary: "底部导航必须使用 Tabs 或 TabContent",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/*.ets"],
          astSignals: [],
          llmPrompt: "检查底部导航栏是否使用 Tabs + TabContent 组件实现",
          kit: ["ArkUI: Tabs / TabContent"],
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  const candidate = result.assistedRuleCandidates.find((item) => item.rule_id === "RSP-MUST-TABS");

  assert.ok(candidate);
  assert.equal(candidate.static_precheck?.signal_status, "all_matched");
  assert.deepEqual(candidate.static_precheck?.matched_tokens, ["Tabs"]);
  assert.match(candidate.static_precheck?.summary ?? "", /ArkUI 内置组件/);
});

test("runRuleEngine does not treat local same-name functions as external kit API evidence", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/entryability/EntryAbility.ets": [
      "function cloudFunction(): void {",
      "  // local fallback implementation",
      "}",
      "export class EntryAbility {",
      "  doPreload(): void {",
      "    cloudFunction();",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_preload",
        rule_id: "RSP-MUST-02",
        rule_name: "预加载调用失败需要使用云函数获取数据",
        rule_source: "must_rule",
        summary: "预加载调用失败需要使用云函数获取数据",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/EntryAbility.ets"],
          astSignals: [],
          llmPrompt: "检查预加载方法报错后是否有调用云函数方法cloudFunction获取数据的逻辑",
          kit: ["CloudFoundationKit: cloudFunction"],
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  const candidate = result.assistedRuleCandidates.find((item) => item.rule_id === "RSP-MUST-02");

  assert.ok(candidate);
  assert.equal(candidate.static_precheck?.signal_status, "partial_matched");
  assert.deepEqual(candidate.static_precheck?.matched_tokens, ["cloudFunction"]);
  assert.match(candidate.static_precheck?.summary ?? "", /同名本地方法/);
  assert.match(candidate.static_precheck?.summary ?? "", /未发现.*来源证据/);
});

test("runRuleEngine keeps missing case targets in agent candidates instead of static violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/Index.ets": "Text('plain')\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
    runtimeRules: [
      {
        pack_id: "case-requirement_004",
        rule_id: "HM-REQ-008-01",
        rule_name: "必须使用 LoginWithHuaweiIDButton",
        rule_source: "must_rule",
        summary: "登录页必须使用 LoginWithHuaweiIDButton",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/pages/*.ets"],
          astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
          llmPrompt: "检查登录页按钮",
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  });

  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "HM-REQ-008-01"),
    false,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "HM-REQ-008-01"),
    true,
  );
  assert.equal(
    result.ruleViolations.some((item) => item.rule_id === "HM-REQ-008-01"),
    false,
  );
});

test("collectEvidence ignores workspace and original files matched by root gitignore", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "build/cache/compiled.js": "var y = 2;\n",
  });

  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "build/\n*.tmp\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "original", ".gitignore"), "cache/\n", "utf-8");
  await fs.mkdir(path.join(caseDir, "original", "cache"), { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "original", "cache", "archived.txt"),
    "archived\n",
    "utf-8",
  );
  await fs.writeFile(path.join(caseDir, "workspace", "trace.tmp"), "noise\n", "utf-8");

  const evidence = await collectEvidence(makeCaseInput(caseDir));

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.deepEqual(evidence.originalFiles, []);
  assert.equal(evidence.summary.workspaceFileCount, 1);
  assert.equal(evidence.summary.originalFileCount, 0);
});

test("collectEvidence ignores ohosTest and test directories during rule evaluation", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/test/LocalUnit.test.ets": "let x: any = 1;\n",
    "entry/src/ohosTest/ets/test/Ability.test.ets": "var y = 2;\n",
  });

  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "test"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "ohosTest", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "test", "Sample.test.ets"),
    "archived\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "ohosTest", "ets", "Ability.test.ets"),
    "archived\n",
    "utf-8",
  );

  const evidence = await collectEvidence(makeCaseInput(caseDir));

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.deepEqual(evidence.originalFiles, []);
  assert.equal(evidence.summary.workspaceFileCount, 1);
  assert.equal(evidence.summary.originalFileCount, 0);
});

test("collectEvidence ignores module-level ohosTest and test directories during rule evaluation", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "commons/commonLib/src/test/LocalUnit.test.ets": "let x: any = 1;\n",
    "commons/commonLib/src/ohosTest/ets/test/Ability.test.ets": "var y = 2;\n",
    "features/home/src/test/LocalUnit.test.ets": "let z: any = 1;\n",
    "features/home/src/ohosTest/ets/test/Ability.test.ets": "var w = 2;\n",
  });

  const evidence = await collectEvidence(makeCaseInput(caseDir));

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.equal(evidence.summary.workspaceFileCount, 1);
});

test("collectEvidence ignores files named BuildProfile.ets during scoring", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/main/ets/BuildProfile.ets": "let x: any = 1;\nvar y = 2;\n",
    "features/home/BuildProfile.ets": "let z: any = 1;\n",
  });

  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "main", "ets", "BuildProfile.ets"),
    "let archived: any = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      "diff --git a/entry/src/main/ets/BuildProfile.ets b/entry/src/main/ets/BuildProfile.ets",
      "@@ -1 +1 @@",
      "-let archived: number = 1;",
      "+let archived: any = 1;",
      "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets",
      "@@ -1 +1 @@",
      "-let count: number = 0;",
      "+let count: number = 1;",
    ].join("\n"),
    "utf-8",
  );

  const evidence = await collectEvidence(makeCaseInput(caseDir), { taskType: "continuation" });

  assert.deepEqual(
    evidence.workspaceFiles.map((item) => item.relativePath),
    ["entry/src/main/ets/pages/Index.ets"],
  );
  assert.deepEqual(evidence.originalFiles, []);
  assert.deepEqual(evidence.changedFiles, ["entry/src/main/ets/pages/Index.ets"]);
  assert.deepEqual(evidence.summary.changedLineNumbersByFile, {
    "entry/src/main/ets/pages/Index.ets": [1],
  });
  assert.doesNotMatch(evidence.patchText ?? "", /BuildProfile\.ets/);
});

test("runRuleEngine limits incremental rule evaluation to changed files when patch is available", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/ChangedPage.ets": "let count: number = 1;\n",
    "entry/src/main/ets/pages/LegacyPage.ets": "let risk: any = 1;\nvar count = 2;\n",
  });

  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      "diff --git a/entry/src/main/ets/pages/ChangedPage.ets b/entry/src/main/ets/pages/ChangedPage.ets",
      "@@ -1 +1 @@",
      "-let count: number = 0;",
      "+let count: number = 1;",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  assert.equal(result.evidenceSummary.hasPatch, true);
  assert.deepEqual(result.evidenceSummary.changedFiles, [
    "entry/src/main/ets/pages/ChangedPage.ets",
  ]);
  assert.equal(
    result.deterministicRuleResults.some(
      (item) =>
        ["ARKTS-FORBID-004", "ARKTS-FORBID-005"].includes(item.rule_id) && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine limits static text scan to patch added lines for every task type", async (t) => {
  for (const taskType of ["full_generation", "continuation", "bug_fix"] as const) {
    await t.test(taskType, async (t) => {
      const caseDir = await createRuleFixture(t, {
        "entry/src/main/ets/pages/Index.ets": "var legacy = 1;\nlet changed: number = 2;\n",
      });

      await fs.writeFile(
        path.join(caseDir, "diff", "changes.patch"),
        [
          "diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets",
          "@@ -2 +2 @@",
          "-let changed: number = 1;",
          "+let changed: number = 2;",
        ].join("\n"),
        "utf-8",
      );

      const result = await runRuleEngine({
        referenceRoot,
        caseInput: makeCaseInput(caseDir),
        taskType,
      });

      assert.equal(
        result.deterministicRuleResults.some(
          (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
        ),
        false,
      );
    });
  }
});

test("runRuleEngine does not report violations from files ignored by workspace gitignore", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "build/generated.js": "var y = 2;\nlet x: any = 1;\n",
  });

  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "build/\n", "utf-8");

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-005" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine does not report violations from ohosTest and test directories", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/test/LocalUnit.test.ets": "let x: any = 1;\n",
    "entry/src/ohosTest/ets/test/Ability.test.ets": "var y = 2;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-005" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-019" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine still evaluates business code under directories named test", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/test/Index.ets": "var y = 2;\nlet x: any = 1;\n",
    "entry/src/test/LocalUnit.test.ets": "let ignored: any = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-005" && item.result === "不满足",
    ),
    true,
  );
});

test("runRuleEngine only evaluates code-like files for text syntax rules", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/main/resources/base/element/color.json": '{ "value": "#FFFFFF" }\n',
    "entry/src/main/resources/base/media/background.png": "#private-binary-noise\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-003" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine only applies arkts syntax rules to ets files", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "entry/src/main/js/generated.js": "var y = 2;\nlet x: any = 1;\nclass A { #secret = 1; }\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-003" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-005" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine evaluates arkts-performance rules and keeps unsupported rules agent-assisted", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": `
function add(left?: number, right?: number): number {
  return (left ?? 0) + (right ?? 0);
}

let arrUnion: (number | string)[] = [1, 'hello'];
let arrNum: number[] = [1, 1.1, 2];
let sparse: number[] = [];
sparse[9999] = 0;

function sum(num: number): number {
  for (let t = 1; t < 100; t++) {
    throw new Error('Invalid numbers.');
  }
  return num;
}

let intNum = 1;
intNum = 1.1;
`,
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-PERF-FORBID-001",
    "ARKTS-PERF-FORBID-002",
    "ARKTS-PERF-FORBID-003",
    "ARKTS-PERF-FORBID-004",
    "ARKTS-PERF-FORBID-005",
    "ARKTS-PERF-SHOULD-002",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }

  for (const ruleId of [
    "ARKTS-PERF-SHOULD-001",
    "ARKTS-PERF-SHOULD-003",
    "ARKTS-PERF-SHOULD-004",
    "ARKTS-PERF-SHOULD-005",
    "ARKTS-PERF-SHOULD-006",
  ]) {
    assert.equal(
      result.staticRuleAuditResults.some(
        (item) => item.rule_id === ruleId && item.result === "未接入判定器",
      ),
      true,
      ruleId,
    );
    assert.equal(
      result.assistedRuleCandidates.some((item) => item.rule_id === ruleId),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine does not treat hex color literals in ets files as private field syntax", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "Text('hello').fontColor('#FF6B35')\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-003" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine ignores block comment numbering when evaluating float literal style", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "/**",
      " * 1. 第一条说明",
      " * 2. 第二条说明",
      " */",
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() {}",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-SHOULD-011" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine does not treat object property values as this-type usage", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "@Entry",
      "@Component",
      "struct Index {",
      "  private scroller: Scroller = new Scroller();",
      "  build() {",
      "    Child({ selectedValue: this.scroller })",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-009" && item.result === "不满足",
    ),
    false,
  );
});

test("runRuleEngine avoids known false positives from valid ArkTS syntax", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "function helper(): number {",
      "  return 1;",
      "}",
      "function secondHelper(): number {",
      "  return helper();",
      "}",
      "class ViewModel {",
      "  tabList: string[] = [];",
      "}",
      "struct Index {",
      "  private vm: ViewModel = new ViewModel();",
      "  private listeners: string[] = [];",
      "  build() {",
      "    const authRequest = new AuthRequest();",
      "    authRequest.scopes = ['phone'];",
      "    authRequest.permissions = ['serviceauthcode'];",
      "    const resourceName = imageUrl.split('//')[1];",
      "    if (paramsArr.length && paramsArr[0]) {",
      "      console.info(paramsArr[0]);",
      "    }",
      "    if (this.listeners.indexOf(listener) < 0) {",
      "      console.info(listener);",
      "    }",
      "    for (let i = 0; i < paramsArr.length; i++) {",
      "      console.info(paramsArr[i]);",
      "    }",
      "    let pref = dataPreferences.getPreferencesSync(context, { name: CardManager.KEY_CARD_ID });",
      "    let windowModel: WindowModel = AppStorageV2.connect(WindowModel, () => new WindowModel())!;",
      "    Tabs()",
      "      .tabBar(this.tabBarBuilder(this.vm.tabList[0], 0))",
      "      .indicator({",
      "        color: $r('app.color.tab_indicator_color'),",
      "        height: 2,",
      "        width: 20,",
      "        marginTop: 8,",
      "        borderRadius: 2",
      "      })",
      "    const dialogConfig: DialogConfig = {",
      "      onConfirm: (value?: string) => {",
      "        console.info(value);",
      "      }",
      "    };",
      "    this.render(dialogConfig);",
      "  }",
      "  subscribe(eventType: string, callback: (event?: string) => void) {",
      "    callback(eventType);",
      "  }",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-FORBID-001",
    "ARKTS-FORBID-016",
    "ARKTS-MUST-008",
    "ARKTS-FORBID-025",
    "ARKTS-PERF-FORBID-001",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      false,
      ruleId,
    );
  }
});

test("runRuleEngine builds fallback evidence snippets when patch paths include workspace prefix", async (t) => {
  const caseDir = await createRuleFixture(t, {
    ".gitignore": ".hvigor/\n",
    "entry/src/main/ets/common/models/Restaurant.ts":
      "export interface Restaurant { id: string; }\n",
    "entry/src/main/ets/pages/Index.ets": "@Entry\n@Component\nstruct Index {}\n",
  });

  await fs.writeFile(
    path.join(caseDir, "diff", "changes.patch"),
    [
      "diff --git a/workspace/entry/src/main/ets/pages/Index.ets b/workspace/entry/src/main/ets/pages/Index.ets",
      "+++ b/workspace/entry/src/main/ets/pages/Index.ets",
      "@@ -1 +1 @@",
      "-@Entry",
      "+@Entry",
    ].join("\n"),
    "utf-8",
  );

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  assert.deepEqual(result.ruleEvidenceIndex.__fallback__?.evidenceFiles, [
    "entry/src/main/ets/pages/Index.ets",
  ]);
  assert.equal((result.ruleEvidenceIndex.__fallback__?.evidenceSnippets.length ?? 0) > 0, true);
});

test("runRuleEngine keeps unsupported rules without direct evidence as 未接入判定器", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.staticRuleAuditResults.some(
      (item) => item.rule_id === "ARKTS-MUST-001" && item.result === "未接入判定器",
    ),
    true,
  );
  assert.equal(
    result.staticRuleAuditResults.some(
      (item) =>
        item.rule_id === "ARKTS-MUST-001" &&
        item.conclusion.includes("当前版本未接入静态判定器，需要 Agent 辅助判定。"),
    ),
    true,
  );
});

test("runRuleEngine keeps unsupported no-evidence rules in agent candidates", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let x: any = 1;\nvar y = 2;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-FORBID-004"),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "ARKTS-MUST-001"),
    true,
  );
  assert.ok(
    result.assistedRuleCandidates.find((item) => item.rule_id === "ARKTS-MUST-001")
      ?.decision_criteria,
  );
  const unsupportedRuleCandidate = result.assistedRuleCandidates.find(
    (item) => item.rule_id === "ARKTS-MUST-001",
  );
  assert.match(
    unsupportedRuleCandidate?.why_uncertain ?? "",
    /未接入静态判定器，需要 Agent 辅助判定/,
  );
  assert.doesNotMatch(
    unsupportedRuleCandidate?.why_uncertain ?? "",
    /当前版本未接入对应判定器/,
  );
  const unsupportedCandidates = result.assistedRuleCandidates.filter((item) => !item.is_case_rule);
  assert.equal(unsupportedCandidates.length > 1, true);
  assert.equal(
    unsupportedCandidates.every(
      (item) => item.local_preliminary_signal === "未接入静态判定器，需要agent辅助判定",
    ),
    true,
  );
});

test("runTextPatternRule marks rules as 不涉及 when applicability patterns do not match", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count = 1;\n",
  });

  const evidence = await collectEvidence(makeCaseInput(caseDir));
  const result = runTextPatternRule(
    {
      pack_id: "custom-pack",
      rule_id: "CUSTOM-FORBID-001",
      rule_source: "forbidden_pattern",
      summary: "禁止在 type 或 interface 中定义构造签名。",
      detector_kind: "text_pattern",
      detector_config: {
        fileExtensions: [".ets"],
        applicabilityPatterns: ["\\binterface\\b|\\btype\\b"],
        patterns: ["^\\s*new\\s*\\([^)]*\\)\\s*:\\s*[^;{]+;?$"],
      },
      fallback_policy: "agent_assisted",
    },
    evidence,
  );

  assert.equal(result.result, "不涉及");
  assert.match(result.conclusion, /适用场景/);
});

test("runTextPatternRule marks rules as 满足 when applicability patterns match without violations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "interface Reader {\n  read(): void;\n}\n",
  });

  const evidence = await collectEvidence(makeCaseInput(caseDir));
  const result = runTextPatternRule(
    {
      pack_id: "custom-pack",
      rule_id: "CUSTOM-FORBID-002",
      rule_source: "forbidden_pattern",
      summary: "禁止在 type 或 interface 中定义构造签名。",
      detector_kind: "text_pattern",
      detector_config: {
        fileExtensions: [".ets"],
        applicabilityPatterns: ["\\binterface\\b|\\btype\\b"],
        patterns: ["^\\s*new\\s*\\([^)]*\\)\\s*:\\s*[^;{]+;?$"],
      },
      fallback_policy: "agent_assisted",
    },
    evidence,
  );

  assert.equal(result.result, "满足");
  assert.match(result.conclusion, /适用场景|违规命中/);
});

test("runTextPatternRule marks rules as 不满足 when applicability patterns and violations match", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "interface Maker {\n  new(): Maker;\n}\n",
  });

  const evidence = await collectEvidence(makeCaseInput(caseDir));
  const result = runTextPatternRule(
    {
      pack_id: "custom-pack",
      rule_id: "CUSTOM-FORBID-003",
      rule_source: "forbidden_pattern",
      summary: "禁止在 type 或 interface 中定义构造签名。",
      detector_kind: "text_pattern",
      detector_config: {
        fileExtensions: [".ets"],
        applicabilityPatterns: ["\\binterface\\b|\\btype\\b"],
        patterns: ["^\\s*new\\s*\\([^)]*\\)\\s*:\\s*[^;{]+;?$"],
      },
      fallback_policy: "agent_assisted",
    },
    evidence,
  );

  assert.equal(result.result, "不满足");
  assert.deepEqual(result.matchedLocations, ["entry/src/main/ets/pages/Index.ets:2"]);
});

test("runRuleEngine keeps unsupported rules in assisted candidates even without direct evidence", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.staticRuleAuditResults.some(
      (item) => item.rule_id === "ARKTS-MUST-001" && item.result === "未接入判定器",
    ),
    true,
  );
  assert.equal(
    result.assistedRuleCandidates.some((item) => item.rule_id === "ARKTS-MUST-001"),
    true,
  );
});

test("runRuleEngine allows Symbol.iterator but rejects Symbol()", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets":
      "const allowed = Symbol.iterator;\nconst bad = Symbol('x');\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-002" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) =>
        item.rule_id === "ARKTS-FORBID-002" &&
        item.conclusion.includes("仅允许使用 Symbol.iterator"),
    ),
    true,
  );
});

test("runRuleEngine classifies every registered rule from rule packs into deterministic or agent-assisted", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  const defaultEnabledRuleCount = listRegisteredRules({
    enabledPackIds: [...defaultEnabledRulePackIds],
  }).length;

  assert.equal(result.staticRuleAuditResults.length, defaultEnabledRuleCount);
  assert.equal(
    result.deterministicRuleResults.length + result.assistedRuleCandidates.length,
    defaultEnabledRuleCount,
  );
});

test("runRuleEngine flags unsupported module system patterns in ets files", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "const fs = require('fs')\n// @ts-ignore\n",
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-018" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults.some(
      (item) => item.rule_id === "ARKTS-FORBID-019" && item.result === "不满足",
    ),
    true,
  );
});

test("runRuleEngine reports text-pattern violations with concrete line locations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "const ok = 0.5;",
      "const ratio = .5;",
      "const whole = 1.;",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  const ruleResult = result.deterministicRuleResults.find(
    (item) => item.rule_id === "ARKTS-SHOULD-011",
  );
  const violation = result.ruleViolations.find((item) => item.rule_id === "ARKTS-SHOULD-011");
  const evidence = result.ruleEvidenceIndex["ARKTS-SHOULD-011"];

  assert.equal(ruleResult?.result, "不满足");
  assert.match(ruleResult?.conclusion ?? "", /entry\/src\/main\/ets\/pages\/Index\.ets:2/);
  assert.match(ruleResult?.conclusion ?? "", /entry\/src\/main\/ets\/pages\/Index\.ets:3/);
  assert.deepEqual(violation?.affected_items, [
    "entry/src/main/ets/pages/Index.ets:2",
    "entry/src/main/ets/pages/Index.ets:3",
  ]);
  assert.deepEqual(evidence?.evidenceFiles, [
    "entry/src/main/ets/pages/Index.ets:2",
    "entry/src/main/ets/pages/Index.ets:3",
  ]);
  assert.deepEqual(evidence?.evidenceSnippets, [
    "entry/src/main/ets/pages/Index.ets:2: const ratio = .5;",
    "entry/src/main/ets/pages/Index.ets:3: const whole = 1.;",
  ]);
});

test("runRuleEngine flags unsupported type signatures and constructor parameter properties", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "interface Callable {",
      "  (value: number): string;",
      "  new (name: string): Callable;",
      "  [key: string]: string;",
      "}",
      "class Demo {",
      "  static {}",
      "  static {}",
      "  constructor(public name: string) {}",
      "}",
      "const value = <number>input;",
      "for (const key in payload) {}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-FORBID-006",
    "ARKTS-FORBID-007",
    "ARKTS-MUST-002",
    "ARKTS-FORBID-008",
    "ARKTS-FORBID-010",
    "ARKTS-FORBID-014",
    "ARKTS-FORBID-015",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags restricted runtime interfaces and NaN comparisons", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "eval('doSomething()');",
      "target.__proto__ = source;",
      "const raw = __defineGetter__;",
      "let first = 1, second = 2;",
      "if (value === NaN) {",
      "  console.info(value);",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  for (const ruleId of ["ARKTS-FORBID-020", "ARKTS-MUST-008", "ARKTS-MUST-009"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags advanced type features and expression-style declarations", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "type Pair = Left & Right;",
      "type Result<T> = T extends string ? Success : Failure;",
      "type Capture<T> = T extends infer R ? R : never;",
      "type Self = this;",
      "type Name = User['name'];",
      "const render = function () { return 1; };",
      "const LocalClass = class {};",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of ["ARKTS-FORBID-009", "ARKTS-FORBID-012"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags object layout mutation and unsupported exception or function patterns", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "delete profile.name;",
      "Demo.prototype = factory();",
      "try {",
      "  throw 'boom';",
      "} catch (error: any) {",
      "  console.info(error);",
      "}",
      "function outer() {",
      "  function inner() { return 1; }",
      "  return inner();",
      "}",
      "function* iterate() {",
      "  yield 1;",
      "}",
      "function badThis() {",
      "  return this;",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  for (const ruleId of ["ARKTS-FORBID-013", "ARKTS-MUST-006", "ARKTS-FORBID-016"]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags migrated forbidden rules without duplicate legacy forbidden hits", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "let value: any = source;",
      "delete profile.name;",
      "const displayName = profile['name'];",
      "type Pair = Left & Right;",
      "const render = function () { return 1; };",
      "for (const key in profile) {",
      "  console.info(key);",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-FORBID-001",
    "ARKTS-FORBID-005",
    "ARKTS-FORBID-009",
    "ARKTS-FORBID-012",
    "ARKTS-FORBID-013",
    "ARKTS-FORBID-015",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }

  for (const removedRuleId of [
    "ARKTS-MUST-011",
    "ARKTS-MUST-012",
    "ARKTS-MUST-013",
    "ARKTS-MUST-015",
    "ARKTS-MUST-017",
    "ARKTS-MUST-018",
    "ARKTS-MUST-020",
    "ARKTS-MUST-022",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some((item) => item.rule_id === removedRuleId),
      false,
      removedRuleId,
    );
  }
});

test("runRuleEngine flags dynamic property access and common style should-rules", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "globalThis.cache = store;",
      'if (ready) console.info("ready");',
      "if (other)",
      "{",
      "\tconsole.info(other);",
      "}",
      "if (failed) {",
      "  console.info(failed);",
      "}",
      "else {",
      "  console.info('retry');",
      "}",
      "const ratio = .5;",
      "const name = user['name'];",
      `const longLine = "${"a".repeat(130)}";`,
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "continuation",
  });

  for (const ruleId of [
    "ARKTS-FORBID-001",
    "ARKTS-SHOULD-001",
    "ARKTS-SHOULD-011",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine flags forbidden risky control-flow and runtime interfaces", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "try {",
      "  throw 'boom';",
      "} catch (error: unknown) {",
      "  console.info(error);",
      "}",
      "const dynamicRequire = require('lib');",
      "eval('run()');",
      "const locked = value as const;",
      "if (flag = check()) {",
      "  console.info(flag);",
      "}",
      "try {",
      "  work();",
      "} finally {",
      "  return;",
      "}",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "bug_fix",
  });

  for (const ruleId of [
    "ARKTS-MUST-006",
    "ARKTS-FORBID-018",
    "ARKTS-FORBID-020",
    "ARKTS-FORBID-024",
    "ARKTS-FORBID-025",
    "ARKTS-FORBID-026",
  ]) {
    assert.equal(
      result.deterministicRuleResults.some(
        (item) => item.rule_id === ruleId && item.result === "不满足",
      ),
      true,
      ruleId,
    );
  }
});

test("runRuleEngine keeps AST-related unsupported rules in agent-assisted state", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": [
      "class Demo {}",
      "interface Demo { value: number }",
      "let payload: { name: string } = { name: 'demo' };",
      "const rawConfig = { enabled: true, retries: 3 };",
      "const values = [];",
      "const mixed = [1, 'two'];",
      "enum Status {",
      "  Ready = 1,",
      "  Done = 'done',",
      "}",
      "enum Mode {",
      "  Active = getMode(),",
      "}",
      "namespace Utils {",
      "  let active = true;",
      "}",
      "namespace Utils {}",
      "const nsRef = Utils;",
    ].join("\n"),
  });

  const result = await runRuleEngine({
    referenceRoot,
    caseInput: makeCaseInput(caseDir),
    taskType: "full_generation",
  });

  for (const ruleId of [
    "ARKTS-MUST-001",
    "ARKTS-FORBID-011",
    "ARKTS-MUST-003",
    "ARKTS-FORBID-017",
    "ARKTS-FORBID-023",
  ]) {
    assert.equal(
      result.staticRuleAuditResults.some(
        (item) => item.rule_id === ruleId && item.result === "未接入判定器",
      ),
      true,
      ruleId,
    );
    assert.equal(
      result.assistedRuleCandidates.some((item) => item.rule_id === ruleId),
      true,
      ruleId,
    );
  }
});
