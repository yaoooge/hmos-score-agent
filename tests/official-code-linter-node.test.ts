import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { officialCodeLinterNode } from "../src/nodes/officialCodeLinterNode.js";
import {
  detectChangedHarmonyModules,
  detectHvigorModuleBuildTarget,
} from "../src/rules/officialCodeLinter/hvigorBuildCheck.js";
import { prepareOfficialCodeLinterWorkspace } from "../src/rules/officialCodeLinter/workspacePreparer.js";
import type { ScoreGraphState } from "../src/workflow/state.js";

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
  await fs.writeFile(path.join(generated, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  await fs.writeFile(path.join(caseDir, "inputs", "secret.txt"), "must not copy\n");

  const result = await prepareOfficialCodeLinterWorkspace({ generatedProjectPath: generated, caseDir });
  const workspaceFiles = await collectWorkspaceFiles(result.workspaceDir);

  assert.deepEqual(workspaceFiles, [
    "code-linter.json5",
    "entry/src/main/ets/pages/Index.ets",
    "entry/src/main/resources/base/profile/route_map.json",
  ]);
  assert.equal(workspaceFiles.includes("summary.json"), false);
  assert.equal(workspaceFiles.includes("findings.effective.json"), false);
  assert.equal(workspaceFiles.some((item) => item.startsWith("inputs/")), false);
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

test("officialCodeLinterNode runs hvigor build check for changed modules and cleans artifacts", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  const hvigorLogPath = path.join(root, "hvigor-log.jsonl");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
  await fs.writeFile(path.join(generated, "entry", "hvigorfile.ts"), "export const hapTasks = [];\n");
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  const fakeLinterBin = path.join(runDir, "bin", "codelinter");
  await fs.writeFile(fakeLinterBin, "#!/usr/bin/env node\nconsole.log('[]');\n");
  await fs.chmod(fakeLinterBin, 0o755);
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `fs.appendFileSync(${JSON.stringify(hvigorLogPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
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
  const hvigorCalls = (await fs.readFile(hvigorLogPath, "utf-8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  assert.deepEqual(hvigorCalls[0], ["--version"]);
  assert.deepEqual(hvigorCalls[1], [
    "assembleHap",
    "--mode",
    "module",
    "-p",
    "module=entry@default",
    "-p",
    "product=default",
    "--no-daemon",
  ]);

  const artifactDir = path.join(caseDir, "intermediate", "code-linter");
  const hvigorSummary = JSON.parse(
    await fs.readFile(path.join(artifactDir, "hvigor-summary.json"), "utf-8"),
  ) as { status: string };
  assert.equal(hvigorSummary.status, "success");
  await assert.rejects(fs.access(path.join(artifactDir, "workspace", ".hvigor")));
  await assert.rejects(fs.access(path.join(artifactDir, "workspace", "oh_modules")));
  await assert.rejects(fs.access(path.join(artifactDir, "workspace", "entry", "build")));
});

test("officialCodeLinterNode marks hvigor failure as a hard gate", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-hvigor-fail-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseDir = path.join(root, "case-1");
  const generated = path.join(root, "generated");
  const runDir = path.join(root, "tools", "codelinter");
  const hvigorRunDir = path.join(root, "tools", "hvigor");
  await fs.mkdir(path.join(generated, "features", "feature1", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(runDir, "bin"), { recursive: true });
  await fs.mkdir(hvigorRunDir, { recursive: true });
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
  const fakeHvigorw = path.join(hvigorRunDir, "hvigorw");
  await fs.writeFile(
    fakeHvigorw,
    [
      "#!/usr/bin/env node",
      "if (process.argv[2] === '--version') { console.log('hvigor 1.0.0'); process.exit(0); }",
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
  assert.deepEqual(result.officialLinterFindings?.map((item) => item.file), [
    "entry/src/main/ets/pages/Changed.ets",
  ]);
  const effectivePath = path.join(caseDir, "intermediate", "code-linter", "findings.effective.json");
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
