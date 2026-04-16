# Interactive Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an executable launcher that prompts for `baseURL` and `apiKey`, persists them to `.env`, runs the `init-input` scoring flow, and stores artifacts under `.local-cases/<timestamp>_<task_type>_<unique_id>`.

**Architecture:** Extract pure helpers for `.env` updates and run-directory naming, then wrap them with a readline-based launcher that calls the existing scoring service. Keep the interactive shell thin so the important behavior stays covered by tests.

**Tech Stack:** TypeScript, Node.js readline/promises, Node.js built-in test runner

---

### Task 1: Add `.env` Persistence Helper

**Files:**
- Create: `src/io/envFile.ts`
- Create: `tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("upsertEnvVars updates existing keys and appends missing ones", async (t) => {
  const envPath = await createTempEnv(t, "MODEL_PROVIDER_BASE_URL=https://old\nMODEL_PROVIDER_MODEL=gpt-4o-mini\n");
  await upsertEnvVars(envPath, {
    MODEL_PROVIDER_BASE_URL: "https://new.example/v1",
    MODEL_PROVIDER_API_KEY: "sk-test",
  });

  const text = await fs.readFile(envPath, "utf-8");
  assert.match(text, /MODEL_PROVIDER_BASE_URL=https:\/\/new\.example\/v1/);
  assert.match(text, /MODEL_PROVIDER_API_KEY=sk-test/);
  assert.match(text, /MODEL_PROVIDER_MODEL=gpt-4o-mini/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: FAIL because `envFile.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export async function upsertEnvVars(envPath: string, updates: Record<string, string>): Promise<void> {
  // read current file if present
  // replace known keys, append missing keys
  // preserve unrelated lines
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/io/envFile.ts tests/interactive-launcher.test.ts
git commit -m "feat: add env file persistence helper"
```

### Task 2: Add Run Directory Naming

**Files:**
- Create: `src/service/runCaseId.ts`
- Modify: `src/service.ts`
- Test: `tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("buildRunCaseId formats timestamp, task_type and unique id", () => {
  const result = buildRunCaseId({
    now: new Date("2026-04-16T11:22:33.000Z"),
    taskType: "bug_fix",
    uniqueId: "abc12345",
  });

  assert.equal(result, "20260416T112233_bug_fix_abc12345");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: FAIL because `runCaseId.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildRunCaseId(...) {
  // format UTC timestamp as YYYYMMDDTHHmmss
  // join with taskType and unique id
}
```

Update `runSingleCase()` to classify the input before creating the case directory, then call `ArtifactStore.ensureCaseDir()` with the generated run id.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/service/runCaseId.ts src/service.ts tests/interactive-launcher.test.ts
git commit -m "feat: name case artifacts by timestamp and task type"
```

### Task 3: Add Interactive Launcher

**Files:**
- Create: `src/tools/runInteractiveScore.ts`
- Modify: `package.json`
- Modify: `README.md`
- Test: `tests/interactive-launcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("resolveLauncherConfig uses prompted values when input is blank or provided", async () => {
  const result = normalizeLauncherAnswers({
    baseURL: "https://api.example/v1",
    apiKey: "sk-test",
  });
  assert.equal(result.baseURL, "https://api.example/v1");
  assert.equal(result.apiKey, "sk-test");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: FAIL because launcher helpers do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
async function main(): Promise<void> {
  // prompt for baseURL/apiKey
  // write .env
  // set process.env for current process
  // run init-input scoring
  // print caseDir and upload message
}
```

Add a script:

```json
"launch:score": "node --import tsx src/tools/runInteractiveScore.ts"
```

Update README with the new command.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json README.md src/tools/runInteractiveScore.ts tests/interactive-launcher.test.ts
git commit -m "feat: add interactive scoring launcher"
```

### Task 4: Full Verification

**Files:**
- Test: `tests/interactive-launcher.test.ts`

- [ ] **Step 1: Run targeted tests**

Run: `node --import tsx --test tests/interactive-launcher.test.ts`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Verify repo status**

Run: `git status --short`
Expected: only intended changes remain

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add interactive scoring bootstrap"
```
