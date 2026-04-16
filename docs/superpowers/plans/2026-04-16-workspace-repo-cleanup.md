# Workspace Repo Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `init-input/workspace` back into a normal tracked directory, and generate case patches from directory diffs instead of a nested Git repo.

**Architecture:** Remove the embedded Git metadata from `init-input/workspace`, replace the outer repo's gitlink with normal tracked files, and add a small patch-generation utility plus documentation. The utility will compare `original` and `workspace` directories directly so runtime behavior no longer depends on a nested repository.

**Tech Stack:** TypeScript, Node.js built-in test runner, shell/git commands

---

### Task 1: Add Patch Generation Utility

**Files:**
- Create: `src/io/patchGenerator.ts`
- Create: `tests/patch-generator.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

```ts
test("generateCasePatch writes a unified diff between original and workspace", async (t) => {
  const caseDir = await createCaseFixture(t);
  const patchPath = path.join(caseDir, "diff", "changes.patch");

  await generateCasePatch(caseDir, patchPath);

  const patchText = await fs.readFile(patchPath, "utf-8");
  assert.match(patchText, /restaurant/i);
  assert.match(patchText, /diff --git|^Only in /m);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: FAIL with `Cannot find module '../src/io/patchGenerator.js'` or missing export.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function generateCasePatch(caseDir: string, outputPath: string): Promise<string> {
  // create diff directory
  // run `git diff --no-index -- original workspace`
  // allow exit code 1 because diff found changes
  // write patch output to outputPath
  // return outputPath
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json src/io/patchGenerator.ts tests/patch-generator.test.ts
git commit -m "feat: add directory-based patch generation"
```

### Task 2: Update Repo Tracking and Docs

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `init-input/workspace` (tracked directory content, not gitlink)

- [ ] **Step 1: Write the failing test**

```ts
test("README documents directory-based patch generation", async () => {
  const readme = await fs.readFile(path.resolve(process.cwd(), "README.md"), "utf-8");
  assert.match(readme, /git diff --no-index/);
  assert.doesNotMatch(readme, /workspace.*独立 git/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: FAIL because README has no patch-generation instructions.

- [ ] **Step 3: Write minimal implementation**

```text
- remove `init-input/workspace/.git`
- `git rm --cached init-input/workspace`
- `git add init-input/workspace`
- update README with `npm run case:patch -- --case init-input`
```

- [ ] **Step 4: Run tests and repo checks**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: PASS

Run: `git status --short`
Expected: `init-input/workspace` listed as normal file changes/additions, not `m init-input/workspace`

- [ ] **Step 5: Commit**

```bash
git add README.md .gitignore init-input/workspace
git commit -m "chore: stop tracking workspace as nested git repo"
```

### Task 3: Verify End-to-End

**Files:**
- Test: `tests/patch-generator.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `node --import tsx --test tests/patch-generator.test.ts`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Verify repo status**

Run: `git status --short`
Expected: no `m init-input/workspace`; only intended tracked changes remain

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: cover workspace patch generation flow"
```
