# Gitignore-Aware Patch And Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make patch generation and rule-evaluation evidence collection ignore files matched by the root `.gitignore` in `original/` and `workspace/`, while preserving fallback behavior and preventing compiled artifacts from polluting score results.

**Architecture:** Introduce one shared ignore-filter module that loads simplified root-level `.gitignore` rules plus built-in fallback ignores, then reuse it from both `patchGenerator` and `evidenceCollector`. Drive the change with TDD: patch tests first, then evidence collector tests, then a rule-engine regression test proving ignored build artifacts no longer trigger false positives.

**Tech Stack:** TypeScript, Node.js built-in test runner, `git diff --no-index`

---

### Task 1: Add Shared Root `.gitignore` Filter Module

**Files:**
- Create: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/gitignoreMatcher.ts`
- Test: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/gitignore-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectVisibleFiles, loadIgnoreFilter } from "../src/io/gitignoreMatcher.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gitignore-matcher-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("loadIgnoreFilter applies root gitignore patterns and built-in fallback ignores", async (t) => {
  const rootDir = await makeTempDir(t);
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "build"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".git"), { recursive: true });
  await fs.writeFile(path.join(rootDir, ".gitignore"), "dist/\n*.cache\nentry/build\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "src", "Index.ets"), "let value = 1;\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "build", "artifact.txt"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "trace.cache"), "noise\n", "utf-8");

  const filter = await loadIgnoreFilter(rootDir);

  assert.equal(filter.isIgnored("build", "directory"), true);
  assert.equal(filter.isIgnored("dist", "directory"), true);
  assert.equal(filter.isIgnored("trace.cache", "file"), true);
  assert.equal(filter.isIgnored("entry/build", "directory"), true);
  assert.equal(filter.isIgnored("src/Index.ets", "file"), false);
});

test("collectVisibleFiles returns only non-ignored relative paths", async (t) => {
  const rootDir = await makeTempDir(t);
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "build"), { recursive: true });
  await fs.writeFile(path.join(rootDir, ".gitignore"), "generated/\n*.log\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "src", "Index.ets"), "let value = 1;\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "app.log"), "noise\n", "utf-8");
  await fs.writeFile(path.join(rootDir, "build", "artifact.txt"), "noise\n", "utf-8");

  const files = await collectVisibleFiles(rootDir);

  assert.deepEqual(files, ["src/Index.ets"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/gitignore-matcher.test.ts`
Expected: FAIL because `src/io/gitignoreMatcher.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs/promises";
import path from "node:path";

const BUILTIN_EXACT_NAMES = new Set([
  ".git",
  ".agent_bench",
  ".hvigor",
  "build",
  "node_modules",
  "oh_modules",
  "oh-package-lock.json5",
]);

type EntryKind = "file" | "directory";

type Rule =
  | { type: "exact"; value: string }
  | { type: "prefix"; value: string }
  | { type: "suffix"; value: string };

export interface IgnoreFilter {
  isIgnored(relativePath: string, kind: EntryKind): boolean;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function toRule(pattern: string): Rule | null {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!") || trimmed.includes("**")) {
    return null;
  }
  if (trimmed.endsWith("/")) {
    return { type: "prefix", value: trimmed.slice(0, -1) };
  }
  if (trimmed.startsWith("*.")) {
    return { type: "suffix", value: trimmed.slice(1) };
  }
  return { type: "exact", value: trimmed };
}

function matchesRule(rule: Rule, relativePath: string, kind: EntryKind): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/");
  if (rule.type === "suffix") {
    return kind === "file" && normalized.endsWith(rule.value);
  }
  if (rule.type === "prefix") {
    return normalized === rule.value || normalized.startsWith(`${rule.value}/`) || segments.includes(rule.value);
  }
  return normalized === rule.value || segments.includes(rule.value);
}

async function loadRules(rootDir: string): Promise<Rule[]> {
  const rules: Rule[] = [];
  const gitignorePath = path.join(rootDir, ".gitignore");
  try {
    const text = await fs.readFile(gitignorePath, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const rule = toRule(line);
      if (rule) {
        rules.push(rule);
      }
    }
  } catch {
    // missing or unreadable gitignore falls back to builtin ignores only
  }
  return rules;
}

export async function loadIgnoreFilter(rootDir: string): Promise<IgnoreFilter> {
  const rules = await loadRules(rootDir);
  return {
    isIgnored(relativePath: string, kind: EntryKind): boolean {
      const normalized = normalizeRelativePath(relativePath);
      const segments = normalized.split("/");
      if (segments.some((segment) => BUILTIN_EXACT_NAMES.has(segment))) {
        return true;
      }
      if (kind === "file" && normalized.endsWith(".log")) {
        return true;
      }
      return rules.some((rule) => matchesRule(rule, normalized, kind));
    },
  };
}

export async function collectVisibleFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
  const filter = currentDir === rootDir ? await loadIgnoreFilter(rootDir) : undefined;
  const activeFilter = filter ?? (await loadIgnoreFilter(rootDir));
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizeRelativePath(path.relative(rootDir, absolutePath));
    if (activeFilter.isIgnored(relativePath, entry.isDirectory() ? "directory" : "file")) {
      continue;
    }
    if (entry.isDirectory()) {
      results.push(...(await collectVisibleFiles(rootDir, absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      results.push(relativePath);
    }
  }
  return results.sort();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/gitignore-matcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/gitignoreMatcher.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/gitignore-matcher.test.ts
git commit -m "feat: add shared gitignore matcher"
```

### Task 2: Make Patch Generation Respect Root `.gitignore`

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/patchGenerator.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/patch-generator.test.ts`
- Depends on: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/gitignoreMatcher.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("generateCasePatch respects original and workspace root gitignore files", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await fs.writeFile(path.join(caseDir, "original", ".gitignore"), "tmp/\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "generated/\n*.log\n", "utf-8");
  await fs.mkdir(path.join(caseDir, "original", "tmp"), { recursive: true });
  await fs.mkdir(path.join(caseDir, "workspace", "generated"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "original", "tmp", "archived.txt"), "archived\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", "generated", "artifact.txt"), "compiled any\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", "trace.log"), "compiled any\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "workspace", "src", "feature.txt"), "restaurant-grid-updated\n", "utf-8");

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.doesNotMatch(patchText, /original\/tmp\/archived\.txt/);
  assert.doesNotMatch(patchText, /workspace\/generated\/artifact\.txt/);
  assert.doesNotMatch(patchText, /workspace\/trace\.log/);
  assert.match(patchText, /restaurant-grid-updated/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: FAIL because ignored files still appear in patch input.

- [ ] **Step 3: Write minimal implementation**

```ts
import { collectVisibleFiles } from "./gitignoreMatcher.js";

async function copyFilteredTree(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const visibleFiles = await collectVisibleFiles(sourceDir);
  await Promise.all(
    visibleFiles.map(async (relativePath) => {
      const sourcePath = path.join(sourceDir, relativePath);
      const targetPath = path.join(targetDir, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }),
  );
}
```

Keep `generateCasePatch()` contract unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/patchGenerator.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/patch-generator.test.ts
git commit -m "feat: respect gitignore when generating patches"
```

### Task 3: Make Evidence Collection Respect Root `.gitignore`

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/evidenceCollector.ts`
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts`
- Depends on: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/src/io/gitignoreMatcher.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { collectEvidence } from "../src/rules/evidenceCollector.js";

test("collectEvidence ignores workspace and original files matched by root gitignore", async (t) => {
  const caseDir = await createRuleFixture(t, {
    "entry/src/main/ets/pages/Index.ets": "let count: number = 1;\n",
    "build/cache/compiled.js": "var y = 2;\n",
  });

  await fs.writeFile(path.join(caseDir, "workspace", ".gitignore"), "build/\n*.tmp\n", "utf-8");
  await fs.writeFile(path.join(caseDir, "original", ".gitignore"), "cache/\n", "utf-8");
  await fs.mkdir(path.join(caseDir, "original", "cache"), { recursive: true });
  await fs.writeFile(path.join(caseDir, "original", "cache", "archived.txt"), "archived\n", "utf-8");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/rule-engine.test.ts`
Expected: FAIL because `collectEvidence()` still returns ignored compiled files.

- [ ] **Step 3: Write minimal implementation**

```ts
import { collectVisibleFiles } from "../io/gitignoreMatcher.js";

export async function collectEvidence(caseInput: CaseInput): Promise<CollectedEvidence> {
  const workspaceFilePaths = await collectVisibleFiles(caseInput.generatedProjectPath);
  const originalFiles = await collectVisibleFiles(caseInput.originalProjectPath).catch(() => []);
  const workspaceFiles = await Promise.all(
    workspaceFilePaths.map(async (relativePath) => ({
      relativePath,
      content: await fs.readFile(path.join(caseInput.generatedProjectPath, relativePath), "utf-8"),
    })),
  );
  // keep patchText and changedFiles logic unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/rule-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/src/rules/evidenceCollector.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts
git commit -m "feat: respect gitignore when collecting evidence"
```

### Task 4: Add Rule-Engine Regression For Ignored Build Artifacts

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足"),
    false,
  );
  assert.equal(
    result.deterministicRuleResults.some((item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足"),
    false,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/rule-engine.test.ts`
Expected: FAIL because ignored build files still trigger rule hits.

- [ ] **Step 3: Write minimal implementation**

```ts
// No new production code should be needed after Task 3.
// If this test still fails, fix only the ignore-path propagation bug you observe,
// keeping rule evaluation logic unchanged.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/rule-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts
git commit -m "test: prevent ignored build artifacts from affecting rule evaluation"
```

### Task 5: Document Simplified `.gitignore` Behavior And Verify End-To-End

**Files:**
- Modify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/README.md`
- Verify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/patch-generator.test.ts`
- Verify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts`
- Verify: `/Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/gitignore-matcher.test.ts`

- [ ] **Step 1: Write the failing documentation test**

```ts
test("README documents gitignore-aware patch generation and evaluation boundaries", async () => {
  const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf-8");
  assert.match(readme, /\.gitignore/);
  assert.match(readme, /workspace\/\.gitignore/);
  assert.match(readme, /original\/\.gitignore/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: FAIL because README does not yet mention the new ignore behavior.

- [ ] **Step 3: Write minimal implementation**

```md
### Patch 与评测过滤

- `case:patch` 会分别读取 `original/.gitignore` 和 `workspace/.gitignore`
- 规则评测采集文件时，也会按对应目录根级 `.gitignore` 过滤
- 当前仅支持根级 `.gitignore` 的常见规则，例如目录模式、文件模式和简单 `*` 通配
```

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `node --import tsx --test tests/gitignore-matcher.test.ts tests/patch-generator.test.ts tests/rule-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Run full verification**

Run: `npm test`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add /Users/guoyutong/MyWorkSpace/hmos-score-agent/README.md /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/patch-generator.test.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/gitignore-matcher.test.ts /Users/guoyutong/MyWorkSpace/hmos-score-agent/tests/rule-engine.test.ts
git commit -m "docs: describe gitignore-aware patch and evaluation behavior"
```
