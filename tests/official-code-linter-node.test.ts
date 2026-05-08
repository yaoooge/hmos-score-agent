import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { officialCodeLinterNode } from "../src/nodes/officialCodeLinterNode.js";
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

test("official linter workspace only contains copied project files and code-linter config", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "official-linter-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const generated = path.join(root, "generated");
  const caseDir = path.join(root, "case-1");
  await fs.mkdir(path.join(generated, "entry", "src", "main", "ets", "pages"), {
    recursive: true,
  });
  await fs.mkdir(path.join(generated, "node_modules", "left-pad"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "inputs"), { recursive: true });
  await fs.writeFile(
    path.join(generated, "entry", "src", "main", "ets", "pages", "Index.ets"),
    "let a = 1;\n",
  );
  await fs.writeFile(path.join(generated, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  await fs.writeFile(path.join(caseDir, "inputs", "secret.txt"), "must not copy\n");

  const result = await prepareOfficialCodeLinterWorkspace({ generatedProjectPath: generated, caseDir });
  const workspaceFiles = await collectWorkspaceFiles(result.workspaceDir);

  assert.deepEqual(workspaceFiles, ["code-linter.json5", "entry/src/main/ets/pages/Index.ets"]);
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

test("officialCodeLinterNode is disabled by default and does not invoke configured linter", async (t) => {
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
    { runDir, timeoutMs: 120000 },
  );

  assert.equal(result.officialLinterRunStatus, "not_enabled");
  assert.deepEqual(result.officialLinterFindings, []);
  assert.deepEqual(result.officialLinterRuleResults, []);
  await assert.rejects(fs.access(markerPath));
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
  assert.doesNotMatch(effective, /Legacy\.ets|legacy issue|@security\/no-http/);

  const workspaceFiles = await collectWorkspaceFiles(
    path.join(caseDir, "intermediate", "code-linter", "workspace"),
  );
  assert.equal(workspaceFiles.includes("summary.json"), false);
  assert.equal(workspaceFiles.includes("findings.effective.json"), false);
  assert.equal(workspaceFiles.includes("stdout.sanitized.txt"), false);
  assert.equal(workspaceFiles.includes("stderr.sanitized.txt"), false);
  assert.equal(workspaceFiles.includes("exit-code.txt"), false);
});
