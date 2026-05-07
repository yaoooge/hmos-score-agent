# Remove Task Understanding Representative Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `representativeFiles` from task understanding pre-generation data and prevent it from reaching the task understanding agent prompt.

**Architecture:** Keep `collectProjectStructure()` as the source of module and implementation hints, but remove representative file collection from the shared `ProjectStructureSummary` contract. Update task understanding prompt construction so both first-run and retry prompts rely on module paths, implementation hints, and patch summary only.

**Tech Stack:** TypeScript, Node.js test runner, opencode prompt builders.

---

### Task 1: Lock Prompt Behavior With Failing Tests

**Files:**
- Modify: `tests/opencode-task-understanding.test.ts`

- [ ] **Step 1: Write the failing test assertions**

Add assertions to the first opencode task understanding test after the existing input boundary checks:

```ts
  assert.doesNotMatch(prompt, /representativeFiles/);
  assert.doesNotMatch(prompt, /代表文件/);
```

Add assertions to the retry prompt test after the `constraint_draft` assertions:

```ts
  assert.doesNotMatch(calls[1]?.prompt ?? "", /representativeFiles/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /代表文件/);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test tests/opencode-task-understanding.test.ts
```

Expected: FAIL because the current prompt still serializes `agent_input.projectStructure.representativeFiles` and the retry draft still emits `代表文件`.

### Task 2: Lock Node Output Contract With Failing Tests

**Files:**
- Modify: `tests/task-understanding-node.test.ts`

- [ ] **Step 1: Replace the old representative file assertion**

Replace the existing assertion that checks `result.workspaceProjectStructure?.representativeFiles.includes(...)` with:

```ts
  assert.equal(
    Object.hasOwn(result.workspaceProjectStructure ?? {}, "representativeFiles"),
    false,
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test tests/task-understanding-node.test.ts
```

Expected: FAIL because `workspaceProjectStructure` still exposes `representativeFiles`.

### Task 3: Remove Representative File Generation and Prompt References

**Files:**
- Modify: `src/types.ts`
- Modify: `src/nodes/taskUnderstandingNode.ts`
- Modify: `src/agent/opencodeTaskUnderstanding.ts`

- [ ] **Step 1: Remove the type field**

In `src/types.ts`, remove:

```ts
  representativeFiles: string[];
```

from `ProjectStructureSummary`.

- [ ] **Step 2: Remove generation**

In `src/nodes/taskUnderstandingNode.ts`, remove the `representativeExtensions` constant and remove this block from `collectProjectStructure()`:

```ts
  const representativeFiles = files
    .filter((file) => representativeExtensions.has(path.extname(file)))
    .slice(0, 80);
```

Then remove `representativeFiles,` from the returned object.

- [ ] **Step 3: Remove retry draft context**

In `src/agent/opencodeTaskUnderstanding.ts`, remove the contextual constraint branch that reads `input.projectStructure.representativeFiles` and emits `代表文件`.

- [ ] **Step 4: Remove first-run prompt wording**

In `src/agent/opencodeTaskUnderstanding.ts`, change:

```ts
"3. contextualConstraints: 从 projectStructure、implementationHints、modulePaths、representativeFiles 提取模块、分层、技术栈和实现边界。",
```

to:

```ts
"3. contextualConstraints: 从 projectStructure、implementationHints、modulePaths 提取模块、分层、技术栈和实现边界。",
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --import tsx --test tests/opencode-task-understanding.test.ts tests/task-understanding-node.test.ts
```

Expected: PASS.

### Task 4: Update Fixtures and Call Sites

**Files:**
- Modify any test fixtures or source call sites that still set `representativeFiles`.

- [ ] **Step 1: Find remaining references**

Run:

```bash
rg -n "representativeFiles|代表文件" src tests
```

Expected: only unrelated downstream uses should remain if they intentionally belong to later scoring stages. No task understanding prompt, type, or node fixture should require the field.

- [ ] **Step 2: Remove stale fixture fields**

Delete `representativeFiles: [...]` from task-understanding fixture objects and from any object typed as `ProjectStructureSummary` after the type removal.

- [ ] **Step 3: Run broader type-adjacent tests**

Run:

```bash
node --import tsx --test tests/opencode-task-understanding.test.ts tests/task-understanding-node.test.ts tests/score-agent.test.ts
```

Expected: PASS.

## Self-Review

Spec coverage: Tasks remove generation, type exposure, first-run prompt transfer, and retry prompt transfer.

Placeholder scan: No placeholder steps remain.

Type consistency: The plan consistently removes `representativeFiles` from `ProjectStructureSummary` and updates callers that construct that type.
