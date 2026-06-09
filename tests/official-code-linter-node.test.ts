import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { officialCodeLinterNode } from "../src/workflow/nodes/officialCodeLinter/index.js";
import {
  detectChangedHarmonyModules,
  detectHvigorModuleBuildTarget,
} from "../src/rules/official-linter/hvigor/buildCheck.js";
import { prepareOfficialCodeLinterWorkspace } from "../src/rules/official-linter/run/workspacePreparer.js";
import type { ScoreGraphState } from "../src/workflow/graph/state.js";

async function collectWorkspaceFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(currentDir: string) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      const relative = path.relative(rootDir, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        results.push(relative);
      }
    }
  }
  await visit(rootDir);
  return results.sort();
}

test("detectChangedHarmonyModules derives module paths from the src/main parent", () => {
  assert.deepEqual(
    detectChangedHarmonyModules([
      "entry/src/main/ets/pages/Index.ets",
      "features/feature1/src/main/ets/pages/Home.ets",
      "libs/common/src/main/ets/utils/Foo.ets",
      "src/main/ets/pages/Root.ets",
      "entry/src/ohosTest/ets/Test.ets",
      "README.md",
      "features/feature1/src/main/ets/pages/Home.ets",
    ]),
    [".", "entry", "features/feature1", "libs/common"],
  );
});

test("detectHvigorModuleBuildTarget reads hap har and hsp tasks from module hvigorfile", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hvigor-target-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, "entry"), { recursive: true });
  await fs.mkdir(path.join(root, "features", "feature1"), { recursive: true });
  await fs.mkdir(path.join(root, "libs", "shared"), { recursive: true });
  await fs.mkdir(path.join(root, "libs", "unknown"), { recursive: true });
  await fs.writeFile(path.join(root, "entry", "hvigorfile.ts"), "export const hapTasks = [];\n");
  await fs.writeFile(
    path.join(root, "features", "feature1", "hvigorfile.ts"),
    "export const harTasks = [];\n",
  );
  await fs.writeFile(path.join(root, "libs", "shared", "hvigorfile.js"), "const hspTasks = [];\n");

  assert.equal(await detectHvigorModuleBuildTarget(root, "entry"), "hap");
  assert.equal(await detectHvigorModuleBuildTarget(root, "features/feature1"), "har");
  assert.equal(await detectHvigorModuleBuildTarget(root, "libs/shared"), "hsp");
  assert.equal(await detectHvigorModuleBuildTarget(root, "libs/unknown"), "unknown");
});

test("official linter workspace only contains copied project files and code-linter config", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generated = path.join(root, "generated");
  const caseDir = path.join(root, "case-1");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(generated, "entry", "src", "main", "resources", "base", "profile"), {
    recursive: true,
  });
  await fs.mkdir(path.join(generated, "node_modules", "left-pad"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "inputs"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "resources", "base", "profile", "route_map.json"),
    "{}\n",
  );
  await fs.writeFile(
    path.join(generated, "node_modules", "left-pad", "index.js"),
    "module.exports = 1;\n",
  );
  await fs.writeFile(path.join(caseDir, "inputs", "secret.txt"), "must not copy\n");

  const result = await prepareOfficialCodeLinterWorkspace({
    generatedProjectPath: generated,
    caseDir,
  });
  const workspaceFiles = await collectWorkspaceFiles(result.workspaceDir);

  assert.deepEqual(workspaceFiles, [
    "code-linter.json5",
    "entry/src/main/ets/pages/Index.ets",
    "entry/src/main/resources/base/profile/route_map.json",
  ]);
  assert.equal(workspaceFiles.includes("summary.json"), false);
  assert.equal(workspaceFiles.includes("findings.effective.json"), false);
  assert.equal(
    workspaceFiles.some((item) => item.startsWith("inputs/")),
    false,
  );
});

test("official linter workspace writes caller-provided rule sets into config", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-workspace-rules-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generated = path.join(root, "generated");
  const caseDir = path.join(root, "case-1");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );

  const result = await prepareOfficialCodeLinterWorkspace({
    generatedProjectPath: generated,
    caseDir,
    ruleSets: ["plugin:@typescript-eslint/recommended", "plugin:@cross-device-app-dev/recommended"],
  });
  const config = JSON.parse(await fs.readFile(result.configPath, "utf-8")) as { ruleSet: string[] };
  const workspaceConfig = JSON.parse(await fs.readFile(result.workspaceConfigPath, "utf-8")) as {
    ruleSet: string[];
  };

  assert.deepEqual(config.ruleSet, [
    "plugin:@typescript-eslint/recommended",
    "plugin:@cross-device-app-dev/recommended",
  ]);
  assert.deepEqual(workspaceConfig.ruleSet, config.ruleSet);
});

test("officialCodeLinterNode returns not_installed without rule results when run dir is absent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-node-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir: "", timeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "not_installed");
  assert.deepEqual(result.officialLinterFindings, []);
  assert.deepEqual(result.officialLinterRuleResults, []);
});

test("officialCodeLinterNode configures cross-device rule set from task understanding", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-cross-device-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "适配手机和平板双端展示",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      taskUnderstanding: {
        explicitConstraints: ["目标: 适配手机和平板双端展示"],
        contextualConstraints: ["模块: entry"],
        implicitConstraints: ["布局适配"],
        classificationHints: ["full_generation", "multi_device_adaptation"],
        crossDeviceAdaptation: {
          applicability: "involved",
          confidence: "high",
          reasons: ["需求明确要求手机和平板布局适配"],
        },
      },
      hasPatch: false,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 0,
        changedFiles: [],
        hasPatch: false,
      },
    } as ScoreGraphState,
    { enabled: true, runDir: "", timeoutMs: 120000, hvigorEnabled: false },
  );
  const config = JSON.parse(
    await fs.readFile(
      path.join(caseDir, "intermediate", "code-linter", "code-linter.json5"),
      "utf-8",
    ),
  ) as { ruleSet: string[] };

  assert.ok(config.ruleSet.includes("plugin:@cross-device-app-dev/recommended"));
  assert.deepEqual(result.officialLinterSummary?.configuredRuleSets, config.ruleSet);
});

test("officialCodeLinterNode treats task understanding missing cross-device field as not involved", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-cross-device-missing-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "旧 prepared state",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      taskUnderstanding: {
        explicitConstraints: ["旧约束"],
        contextualConstraints: ["模块: entry"],
        implicitConstraints: ["修改范围: 未知"],
        classificationHints: ["continuation"],
      },
      hasPatch: false,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 0,
        changedFiles: [],
        hasPatch: false,
      },
    } as never,
    { enabled: true, runDir: "", timeoutMs: 120000, hvigorEnabled: false },
  );

  assert.equal(
    result.officialLinterSummary?.configuredRuleSets.includes(
      "plugin:@cross-device-app-dev/recommended",
    ),
    false,
  );
  assert.match(
    result.officialLinterSummary?.diagnostics ?? "",
    /cross-device applicability missing; treated as not_involved/,
  );
});

test("officialCodeLinterNode does not invoke configured linter when disabled", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-node-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "run");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const markerPath = path.join(root, "linter-was-called.txt");
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(
    fakeLinterBin,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(markerPath)}, 'called');`,
      "console.log('[]');",
    ].join("\n"),
  );
  await fs.chmod(fakeLinterBin, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: false, runDir, timeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "not_enabled");
  assert.equal(result.hvigorBuildCheckStatus, "not_enabled");
  assert.deepEqual(result.officialLinterFindings, []);
  assert.deepEqual(result.officialLinterRuleResults, []);
  await assert.rejects(fs.access(markerPath));
});

test("officialCodeLinterNode can run hvigor when codelinter is disabled", async (t) => {
  const previousCodeLinterEnabled = process.env.HMOS_CODE_LINTER_ENABLED;
  const previousHvigorEnabled = process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED;
  process.env.HMOS_CODE_LINTER_ENABLED = "false";
  process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED = "true";
  t.after(() => {
    if (previousCodeLinterEnabled === undefined) {
      delete process.env.HMOS_CODE_LINTER_ENABLED;
    } else {
      process.env.HMOS_CODE_LINTER_ENABLED = previousCodeLinterEnabled;
    }
    if (previousHvigorEnabled === undefined) {
      delete process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED;
    } else {
      process.env.HMOS_HVIGOR_BUILD_CHECK_ENABLED = previousHvigorEnabled;
    }
  });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-only-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const commandLogPath = path.join(root, "command-log.jsonl");
  const markerPath = path.join(root, "linter-was-called.txt");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "hvigorfile.ts"),
    "export const hapTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(
    fakeLinterBin,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.writeFileSync(${JSON.stringify(markerPath)}, 'called');`,
      "console.log('[]');",
    ].join("\n"),
  );
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['ohpm', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === 'install') { process.exit(0); }",
      "process.exit(1);",
    ].join("\n"),
  );
  await fs.chmod(fakeOhpm, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['hvigor', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      "console.log('build ok');",
      "process.exit(0);",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      remoteBuildSuccess: false,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "not_enabled");
  assert.equal(result.hvigorBuildCheckStatus, "success");
  await assert.rejects(fs.access(markerPath));
  const commandCalls = (await fs.readFile(commandLogPath, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(commandCalls[0], ["hvigor", "--version"]);
  assert.deepEqual(commandCalls[1], ["ohpm", "install"]);
  assert.deepEqual(commandCalls.at(-1), ["hvigor", "assembleApp", "--no-daemon"]);
});

test("officialCodeLinterNode uses remote build result when hvigor build check is disabled", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-remote-build-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      remoteBuildSuccess: false,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: false, hvigorEnabled: false, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "not_enabled");
  assert.equal(result.hvigorBuildCheckStatus, "failed");
  assert.equal(result.hvigorBuildCheckSummary?.buildCheckSource, "remote");
  assert.equal(result.hvigorBuildCheckSummary?.hardGateTriggered, true);
  assert.equal(result.hvigorBuildCheckSummary?.scoreCap, 59);
});

test("officialCodeLinterNode runs hvigor build check for changed modules and cleans artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const commandLogPath = path.join(root, "command-log.jsonl");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "hvigorfile.ts"),
    "export const hapTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['ohpm', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === 'install') { console.log('ohpm install ok'); process.exit(0); }",
      "console.error('unexpected ohpm args');",
      "process.exit(1);",
    ].join("\n"),
  );
  await fs.chmod(fakeOhpm, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['hvigor', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      "fs.mkdirSync(path.join(process.cwd(), 'entry', 'build'), { recursive: true });",
      "fs.mkdirSync(path.join(process.cwd(), 'oh_modules'), { recursive: true });",
      "fs.mkdirSync(path.join(process.cwd(), '.hvigor'), { recursive: true });",
      "console.log('build ok');",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.hvigorBuildCheckStatus, "success");
  assert.equal(result.hvigorBuildCheckSummary?.moduleResults[0]?.command, "assembleHap");
  assert.equal(result.hvigorBuildCheckSummary?.hardGateTriggered, false);
  const commandCalls = (await fs.readFile(commandLogPath, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(commandCalls[0], ["hvigor", "--version"]);
  assert.deepEqual(commandCalls[1], ["ohpm", "install"]);
  assert.deepEqual(commandCalls[2], [
    "hvigor",
    "assembleHap",
    "--mode",
    "module",
    "-p",
    "module=entry@default",
    "-p",
    "product=default",
    "--no-daemon",
  ]);
  assert.deepEqual(commandCalls[3], ["hvigor", "assembleApp", "--no-daemon"]);

  const artifactDir = path.join(caseDir, "intermediate", "code-linter");
  const hvigorSummary = JSON.parse(
    await fs.readFile(path.join(artifactDir, "hvigor-summary.json"), "utf-8"),
  ) as { status: string };
  assert.equal(hvigorSummary.status, "success");
  await assert.rejects(fs.access(path.join(artifactDir, "workspace", ".hvigor")));
  await assert.rejects(fs.access(path.join(artifactDir, "workspace", "oh_modules")));
  await assert.rejects(fs.access(path.join(artifactDir, "workspace", "entry", "build")));
});

test("officialCodeLinterNode records patch-attributed deprecated API warnings from hvigor output", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-deprecated-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const workspaceIndexPath = path.join(
    caseDir,
    "intermediate",
    "code-linter",
    "workspace",
    "entry",
    "src",
    "main",
    "ets",
    "pages",
    "Index.ets",
  );
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "hvigorfile.ts"),
    "export const hapTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    [
      "@Entry",
      "@Component",
      "struct Index {",
      "  build() {",
      "    Column() {",
      "      Text('x')",
      "    }",
      "    this.keep()",
      "    this.showToast()",
      "    this.legacy()",
    ].join("\n"),
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    "#!/usr/bin/env node\nif (process.argv[2] === 'install') { process.exit(0); }\nprocess.exit(1);\n",
  );
  await fs.chmod(fakeOhpm, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      "const file = process.env.TEST_INDEX_ABSOLUTE_PATH;",
      "console.log(`\\u001b[33mWARN: \\u001b[33mWARN: \\u001b[33mArkTS:WARN File: ${file}:9:18\\n 'showToast' has been deprecated.\\u001b[39m`);",
      "console.log(`WARN: WARN: ArkTS:WARN File: ${file}:10:18\\n 'legacy' has been deprecated.`);",
      "process.exit(0);",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const previousPath = process.env.TEST_INDEX_ABSOLUTE_PATH;
  process.env.TEST_INDEX_ABSOLUTE_PATH = workspaceIndexPath;
  t.after(() => {
    if (previousPath === undefined) {
      delete process.env.TEST_INDEX_ABSOLUTE_PATH;
    } else {
      process.env.TEST_INDEX_ABSOLUTE_PATH = previousPath;
    }
  });

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        changedLineNumbersByFile: {
          "entry/src/main/ets/pages/Index.ets": [9],
        },
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.hvigorBuildCheckStatus, "success");
  assert.deepEqual(result.hvigorBuildCheckSummary?.deprecatedApiWarnings, [
    {
      file: "entry/src/main/ets/pages/Index.ets",
      line: 9,
      column: 18,
      apiName: "showToast",
      modulePath: "entry",
      moduleName: "entry",
      command: "assembleHap",
      message:
        "ArkTS:WARN File: entry/src/main/ets/pages/Index.ets:9:18 'showToast' has been deprecated.",
    },
  ]);
});

test("officialCodeLinterNode runs assembleApp after changed modules compile and marks baseline app failure", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-app-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const commandLogPath = path.join(root, "command-log.jsonl");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "hvigorfile.ts"),
    "export const hapTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['ohpm', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === 'install') { process.exit(0); }",
      "process.exit(1);",
    ].join("\n"),
  );
  await fs.chmod(fakeOhpm, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['hvigor', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      "if (process.argv[2] === 'assembleApp') { console.error('baseline app compile failed'); process.exit(7); }",
      "console.log('module build ok');",
      "process.exit(0);",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.hvigorBuildCheckStatus, "failed");
  assert.equal(result.hvigorBuildCheckSummary?.hardGateTriggered, true);
  assert.equal(result.hvigorBuildCheckSummary?.scoreCap, 59);
  const appResult = result.hvigorBuildCheckSummary?.moduleResults.find(
    (item) => item.command === "assembleApp",
  );
  assert.equal(appResult?.modulePath, ".");
  assert.equal(appResult?.moduleName, "app");
  assert.equal(appResult?.status, "failed");
  assert.match(appResult?.stderrExcerpt ?? "", /baseline app compile failed/);
  assert.match(result.hvigorBuildCheckSummary?.diagnostics ?? "", /整包 assembleApp 编译失败/);
  assert.match(result.hvigorBuildCheckSummary?.diagnostics ?? "", /原代码问题，非新增修改引入/);
  const commandCalls = (await fs.readFile(commandLogPath, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(commandCalls.at(-1), ["hvigor", "assembleApp", "--no-daemon"]);

  const artifactDir = path.join(caseDir, "intermediate", "code-linter");
  const hvigorSummary = JSON.parse(
    await fs.readFile(path.join(artifactDir, "hvigor-summary.json"), "utf-8"),
  ) as { diagnostics?: string };
  assert.match(hvigorSummary.diagnostics ?? "", /原代码问题，非新增修改引入/);
});

test("officialCodeLinterNode truncates long hvigor stderr excerpts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-stderr-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "hvigorfile.ts"),
    "export const hapTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    "#!/usr/bin/env node\nif (process.argv[2] === 'install') { process.exit(0); }\nprocess.exit(1);\n",
  );
  await fs.chmod(fakeOhpm, 0o755);
  const longStderr = `${"warning: hvigor output line\n".repeat(5000)}final hvigor failure\n`;
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      `fs.writeSync(2, ${JSON.stringify(longStderr)});`,
      "process.exit(7);",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  const stderrExcerpt = result.hvigorBuildCheckSummary?.moduleResults[0]?.stderrExcerpt ?? "";
  assert.equal(result.hvigorBuildCheckStatus, "failed");
  assert.ok(Buffer.byteLength(stderrExcerpt, "utf-8") <= 16 * 1024);
  assert.match(stderrExcerpt, /final hvigor failure/);
});

test("officialCodeLinterNode stops when ohpm install fails", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-ohpm-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const commandLogPath = path.join(root, "command-log.jsonl");
  await fs.mkdir(path.join(generated, "features", "feature1", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "features", "feature1", "hvigorfile.ts"),
    "export const harTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "features", "feature1", "src", "main", "ets", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['ohpm', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === 'install') { console.error('install failed'); process.exit(4); }",
      "process.exit(0);",
    ].join("\n"),
  );
  await fs.chmod(fakeOhpm, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['hvigor', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      "console.error('build should not run');",
      "process.exit(9);",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["features/feature1/src/main/ets/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.hvigorBuildCheckStatus, "failed");
  assert.equal(result.hvigorBuildCheckSummary?.hardGateTriggered, true);
  assert.equal(result.hvigorBuildCheckSummary?.moduleResults.length, 0);
  const commandCalls = (await fs.readFile(commandLogPath, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(commandCalls, [
    ["hvigor", "--version"],
    ["ohpm", "install"],
  ]);
});

test("officialCodeLinterNode marks hvigor failure as a hard gate", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const commandLogPath = path.join(root, "command-log.jsonl");
  await fs.mkdir(path.join(generated, "features", "feature1", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.mkdir(path.join(root, "tools", "ohpm", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "features", "feature1", "hvigorfile.ts"),
    "export const harTasks = [];\n",
  );
  await fs.writeFile(
    path.join(generated, "features", "feature1", "src", "main", "ets", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeOhpm = path.join(root, "tools", "ohpm", "bin", "ohpm");
  await fs.writeFile(
    fakeOhpm,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['ohpm', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === 'install') { process.exit(0); }",
      "process.exit(1);",
    ].join("\n"),
  );
  await fs.chmod(fakeOhpm, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `fs.appendFileSync(${JSON.stringify(commandLogPath)}, JSON.stringify(['hvigor', ...process.argv.slice(2)]) + '\\n');`,
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
      "fs.mkdirSync(path.join(process.cwd(), '.hvigor'), { recursive: true });",
      "fs.mkdirSync(path.join(process.cwd(), 'oh_modules'), { recursive: true });",
      "fs.mkdirSync(path.join(process.cwd(), 'features', 'feature1', 'build'), { recursive: true });",
      "console.error('compile failed');",
      "process.exit(7);",
    ].join("\n"),
  );
  await fs.chmod(fakeHvigorw, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["features/feature1/src/main/ets/Index.ets"],
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, hvigorRunDir, timeoutMs: 120000, hvigorTimeoutMs: 120000 },
  );

  assert.equal(result.hvigorBuildCheckStatus, "failed");
  assert.equal(result.hvigorBuildCheckSummary?.hardGateTriggered, true);
  assert.equal(result.hvigorBuildCheckSummary?.scoreCap, 59);
  assert.equal(result.hvigorBuildCheckSummary?.moduleResults[0]?.command, "assembleHar");
  assert.equal(result.hvigorBuildCheckSummary?.moduleResults[0]?.modulePath, "features/feature1");
  const commandCalls = (await fs.readFile(commandLogPath, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.equal(
    commandCalls.some((call) => call[1] === "assembleApp"),
    false,
  );
  const artifactDir = path.join(caseDir, "intermediate", "code-linter");
  await fs.access(path.join(artifactDir, "hvigor-summary.json"));
  await fs.access(path.join(artifactDir, "workspace", ".hvigor"));
  await fs.access(path.join(artifactDir, "workspace", "oh_modules"));
  await fs.access(path.join(artifactDir, "workspace", "features", "feature1", "build"));
});

test("officialCodeLinterNode writes only effective findings and diagnostics outside workspace", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-node-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "run");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Changed.ets"),
    "let a = 1;\n",
  );
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Legacy.ets"),
    "let b = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(
    fakeLinterBin,
    [
      "#!/usr/bin/env node",
      "const expected = ['-c', 'code-linter.json5', '-f', 'json', '.'];",
      "const actual = process.argv.slice(2);",
      "if (actual.join('\\u0000') !== expected.join('\\u0000')) {",
      "  console.error('unexpected args: ' + JSON.stringify(actual));",
      "  process.exit(9);",
      "}",
      "const workspace = process.cwd();",
      "console.log(JSON.stringify([",
      "{filePath: workspace + '/entry/src/main/ets/pages/Changed.ets', messages: [{ rule: '@performance/foreach-args-check', message: 'changed issue', severity: 'warn', line: 1, column: 1 }]},",
      "{filePath: workspace + '/entry/src/main/ets/pages/Changed.ets', messages: [{ rule: '@performance/foreach-args-check', message: 'same-file legacy issue', severity: 'warn', line: 2, column: 1 }]},",
      "{filePath: workspace + '/entry/src/main/ets/pages/Legacy.ets', messages: [{ rule: '@security/no-http', message: 'legacy issue', severity: 'warn', line: 2, column: 1 }]}",
      "]));",
    ].join("\n"),
  );
  await fs.chmod(fakeLinterBin, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      hasPatch: true,
      evidenceSummary: {
        workspaceFileCount: 2,
        originalFileCount: 0,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Changed.ets"],
        changedLineNumbersByFile: {
          "entry/src/main/ets/pages/Changed.ets": [1],
        },
        hasPatch: true,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, timeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "success");
  assert.deepEqual(
    result.officialLinterFindings?.map((item) => item.file),
    ["entry/src/main/ets/pages/Changed.ets"],
  );
  const effectivePath = path.join(
    caseDir,
    "intermediate",
    "code-linter",
    "findings.effective.json",
  );
  const effective = await fs.readFile(effectivePath, "utf-8");
  assert.match(effective, /Changed\.ets/);
  assert.doesNotMatch(
    effective,
    /Legacy\.ets|legacy issue|same-file legacy issue|@security\/no-http/,
  );

  const workspaceFiles = await collectWorkspaceFiles(
    path.join(caseDir, "intermediate", "code-linter", "workspace"),
  );
  assert.equal(workspaceFiles.includes("summary.json"), false);
  assert.equal(workspaceFiles.includes("findings.effective.json"), false);
  assert.equal(workspaceFiles.includes("stdout.sanitized.txt"), false);
  assert.equal(workspaceFiles.includes("stderr.sanitized.txt"), false);
  assert.equal(workspaceFiles.includes("exit-code.txt"), false);
});

test("officialCodeLinterNode reports missing profile for unknown cross-device rules", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-unknown-cross-device-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(
    fakeLinterBin,
    [
      "#!/usr/bin/env node",
      "const workspace = process.cwd();",
      "console.log(JSON.stringify([",
      "{filePath: workspace + '/entry/src/main/ets/pages/Index.ets', messages: [{ ruleId: '@cross-device-app-dev/future-rule', message: 'future issue', severity: 1, line: 1, column: 1 }]}",
      "]));",
    ].join("\n"),
  );
  await fs.chmod(fakeLinterBin, 0o755);

  const result = await officialCodeLinterNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "适配手机和平板双端展示",
        originalProjectPath: generated,
        generatedProjectPath: generated,
      },
      taskUnderstanding: {
        explicitConstraints: ["目标: 适配手机和平板双端展示"],
        contextualConstraints: ["模块: entry"],
        implicitConstraints: ["布局适配"],
        classificationHints: ["full_generation", "multi_device_adaptation"],
        crossDeviceAdaptation: {
          applicability: "involved",
          confidence: "high",
          reasons: ["需求明确要求手机和平板布局适配"],
        },
      },
      hasPatch: false,
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 0,
        changedFileCount: 0,
        changedFiles: [],
        hasPatch: false,
      },
    } as ScoreGraphState,
    { enabled: true, runDir, timeoutMs: 120000, hvigorEnabled: false },
  );

  assert.equal(result.officialLinterRunStatus, "success");
  assert.equal(
    result.officialLinterRuleResults?.[0]?.rule_id,
    "OFFICIAL-LINTER:@cross-device-app-dev/future-rule",
  );
  assert.match(result.officialLinterSummary?.diagnostics ?? "", /profile missing/);
  assert.match(
    result.officialLinterSummary?.diagnostics ?? "",
    /@cross-device-app-dev\/future-rule/,
  );
});
