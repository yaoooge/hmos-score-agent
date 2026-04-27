import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildOpencodeSandbox } from "../src/opencode/sandboxBuilder.js";

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("buildOpencodeSandbox copies only allowed case inputs into a prepared sandbox", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-"));
  const caseDir = path.join(root, "case-artifacts");
  const generatedProjectPath = path.join(root, "workspace", "generated");
  const originalProjectPath = path.join(root, "workspace", "original");
  const referenceRoot = path.join(root, "references");
  const patchPath = path.join(root, "patches", "effective.patch");

  await writeFile(path.join(generatedProjectPath, "entry", "src", "main.ets"), "generated");
  await writeFile(path.join(generatedProjectPath, ".env"), "secret");
  await writeFile(path.join(generatedProjectPath, "node_modules", "pkg", "index.js"), "ignored");
  await writeFile(path.join(generatedProjectPath, "BuildProfile.ets"), "ignored by policy");
  await writeFile(path.join(originalProjectPath, "entry", "src", "main.ets"), "original");
  await writeFile(path.join(referenceRoot, "rubric.yaml"), "rubric: true");
  await writeFile(patchPath, "diff --git a/a b/a\n");

  const outsideFile = path.join(root, "outside.txt");
  await writeFile(outsideFile, "outside");
  await fs.symlink(outsideFile, path.join(generatedProjectPath, "outside-link.txt"));

  const sandbox = await buildOpencodeSandbox({
    caseDir,
    generatedProjectPath,
    originalProjectPath,
    originalProjectProvided: true,
    effectivePatchPath: patchPath,
    referenceRoot,
    metadata: {
      case_id: "case-1",
      prompt: "实现登录页",
    },
  });

  assert.equal(sandbox.root, path.join(caseDir, "opencode-sandbox"));
  assert.equal(await fs.readFile(path.join(sandbox.generatedRoot, "entry", "src", "main.ets"), "utf-8"), "generated");
  assert.equal(await fs.readFile(path.join(sandbox.originalRoot!, "entry", "src", "main.ets"), "utf-8"), "original");
  assert.equal(await fs.readFile(path.join(sandbox.referencesRoot, "rubric.yaml"), "utf-8"), "rubric: true");
  assert.equal(await fs.readFile(sandbox.patchPath!, "utf-8"), "diff --git a/a b/a\n");
  assert.equal(
    await fs.readFile(path.join(sandbox.metadataRoot, "metadata.json"), "utf-8"),
    `${JSON.stringify({ case_id: "case-1", prompt: "实现登录页" }, null, 2)}\n`,
  );

  assert.equal(await exists(path.join(sandbox.generatedRoot, ".env")), false);
  assert.equal(await exists(path.join(sandbox.generatedRoot, "node_modules", "pkg", "index.js")), false);
  assert.equal(await exists(path.join(sandbox.generatedRoot, "BuildProfile.ets")), false);
  assert.equal(await exists(path.join(sandbox.generatedRoot, "outside-link.txt")), false);
});

test("buildOpencodeSandbox omits original and patch directories when inputs are absent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-sandbox-minimal-"));
  const caseDir = path.join(root, "case-artifacts");
  const generatedProjectPath = path.join(root, "workspace", "generated");
  const referenceRoot = path.join(root, "references");
  await writeFile(path.join(generatedProjectPath, "entry", "src", "main.ets"), "generated");
  await writeFile(path.join(referenceRoot, "rubric.yaml"), "rubric: true");

  const sandbox = await buildOpencodeSandbox({
    caseDir,
    generatedProjectPath,
    originalProjectProvided: false,
    referenceRoot,
    metadata: { case_id: "case-2" },
  });

  assert.equal(sandbox.originalRoot, undefined);
  assert.equal(sandbox.patchPath, undefined);
  assert.equal(await exists(path.join(sandbox.root, "original")), false);
  assert.equal(await exists(path.join(sandbox.root, "patch")), false);
});
