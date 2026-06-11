import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getArkFactsForEvidence,
  getArkFactsForProject,
  runArkAnalyzerFacts,
} from "../src/rules/arkfacts/runner.js";

const sceneFixture = {
  projectDirectory: "/workspace/sample",
  files: [
    {
      name: "entry/src/main/ets/pages/Index.ets",
      classes: [{ name: "Index", hasViewTree: true, methods: ["build"] }],
    },
  ],
  viewTrees: [
    {
      component: "Index",
      file: "entry/src/main/ets/pages/Index.ets",
      nodeCount: 1,
      root: {
        name: "Column",
        kind: "system",
        attributes: {},
        stateValues: [],
        children: [],
      },
    },
  ],
};

test("runner returns facts from injected fixture and writes debug artifacts", async () => {
  const caseDir = await fs.mkdtemp(path.join(os.tmpdir(), "arkfacts-runner-"));

  const facts = await runArkAnalyzerFacts({
    projectPath: "/workspace/sample",
    caseDir,
    fixtureScene: sceneFixture,
  });

  assert.equal(facts.files[0]?.relativePath, "entry/src/main/ets/pages/Index.ets");
  assert.equal(facts.viewTrees[0]?.component, "Index");

  const outputDir = path.join(caseDir, "intermediate", "arkanalyzer");
  const factsJson = JSON.parse(await fs.readFile(path.join(outputDir, "ark-facts.json"), "utf-8"));
  const sceneJson = JSON.parse(
    await fs.readFile(path.join(outputDir, "scene-summary.json"), "utf-8"),
  );
  const diagnosticsJson = JSON.parse(
    await fs.readFile(path.join(outputDir, "diagnostics.json"), "utf-8"),
  );
  const unresolvedJson = JSON.parse(
    await fs.readFile(path.join(outputDir, "unresolved-expressions.json"), "utf-8"),
  );

  assert.equal(factsJson.viewTrees[0].component, "Index");
  assert.equal(sceneJson.projectDirectory, "/workspace/sample");
  assert.deepEqual(diagnosticsJson, []);
  assert.deepEqual(unresolvedJson, []);
});

test("runner reports unavailable analyzer without fabricating facts", async () => {
  const facts = await runArkAnalyzerFacts({
    projectPath: "/workspace/sample",
    analyzerHome: "/path/that/does/not/exist",
    skipExternalExecution: false,
  });

  assert.equal(facts.files.length, 0);
  assert.equal(facts.diagnostics[0]?.code, "ARKANALYZER_UNAVAILABLE");
});

test("runner writes ArkAnalyzer-compatible config for explicit script mode", async () => {
  const caseDir = await fs.mkdtemp(path.join(os.tmpdir(), "arkfacts-script-"));
  const scriptPath = path.join(caseDir, "fake-parse-project.cjs");
  await fs.writeFile(
    scriptPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const [, , configPath, outputDir] = process.argv;",
      "fs.copyFileSync(configPath, path.join(outputDir, 'observed-config.json'));",
      "fs.writeFileSync(path.join(outputDir, 'scene-summary.json'), JSON.stringify({",
      "  projectDirectory: '/workspace/sample',",
      "  files: [],",
      "  viewTrees: []",
      "}));",
    ].join("\n"),
    "utf-8",
  );

  const facts = await runArkAnalyzerFacts({
    projectPath: "/workspace/sample",
    caseDir,
    analyzerScriptPath: scriptPath,
    sdkPaths: ["/sdk/openharmony/ets", "/sdk/hms/ets"],
    skipExternalExecution: false,
  });

  const outputDir = path.join(caseDir, "intermediate", "arkanalyzer");
  const config = JSON.parse(await fs.readFile(path.join(outputDir, "observed-config.json"), "utf-8"));

  assert.equal(facts.diagnostics.length, 0);
  assert.equal(config.targetProjectName, "sample");
  assert.equal(config.targetProjectDirectory, "/workspace/sample");
  assert.deepEqual(config.sdks, [
    { name: "etsSdk", path: "/sdk/openharmony/ets", moduleName: "" },
    { name: "hmsSdk", path: "/sdk/hms/ets", moduleName: "" },
  ]);
  assert.deepEqual(config.options.supportFileExts, [".ets", ".ts"]);
  assert.deepEqual(config.options.ignoreFileNames, ["build", ".hvigor", "oh_modules", ".preview", ".test"]);
  assert.equal(config.options.enableBuiltIn, true);
  assert.equal(config.options.enableLeadingComments, true);
});

test("evidence cache returns the same facts object for repeated calls", async () => {
  const evidence = {
    workspaceFiles: [],
    allWorkspaceFiles: [],
    originalFiles: [],
    changedFiles: [],
    summary: {
      workspaceFileCount: 0,
      originalFileCount: 0,
      changedFileCount: 0,
      changedFiles: [],
      hasPatch: false,
    },
  };

  const first = await getArkFactsForEvidence(evidence, {
    projectPath: "/workspace/sample",
    fixtureScene: sceneFixture,
  });
  const second = await getArkFactsForEvidence(evidence, {
    projectPath: "/workspace/sample",
    fixtureScene: { files: [], viewTrees: [] },
  });

  assert.equal(first, second);
  assert.equal(second.files[0]?.relativePath, "entry/src/main/ets/pages/Index.ets");
});

test("project cache does not reuse fixture or sdk-specific facts across inputs", async () => {
  const first = await getArkFactsForProject({
    projectPath: "/workspace/sample",
    fixtureScene: sceneFixture,
    sdkPaths: ["/sdk/a"],
  });
  const second = await getArkFactsForProject({
    projectPath: "/workspace/sample",
    fixtureScene: { files: [], viewTrees: [] },
    sdkPaths: ["/sdk/b"],
  });

  assert.equal(first.files.length, 1);
  assert.equal(second.files.length, 0);
});
