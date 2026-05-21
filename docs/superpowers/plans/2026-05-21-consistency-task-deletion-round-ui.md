# Consistency Task Deletion and Round Detail UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deletion for consistency tasks, add round-level deletion and selection in the task detail view, and keep the detail page grouped by overall multi-round data above and fixed-round data below.

**Architecture:** Keep the current client-owned consistency task snapshot model. Add delete operations to the JSON and sqlite stores, expose one HTTP delete handler for task removal, and add a small set of pure helpers that remove a history round and optionally roll the active analysis back to the latest remaining round. The Vue page should render one task-level header section, one round selector, and one round-specific report region.

**Tech Stack:** TypeScript, Express, Vue 3, Element Plus, node:test, existing sqlite/json stores.

---

### Task 1: Round deletion helpers and store deletion support

**Files:**
- Modify: `web/src/pages/scoreConsistencyAnalysis.ts`
- Modify: `src/api/consistencyTaskStore.ts`
- Modify: `src/storage/sqliteStores.ts`
- Test: `tests/score-consistency-analysis.test.ts`
- Test: `tests/sqlite-storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("removeConsistencyAnalysisHistoryRound deletes one round and rolls back to the latest remaining snapshot", () => {
  const runs = [completedRun(0), completedRun(1, { totalScore: 86 })];
  const firstHistory = appendAnalysisHistorySnapshot([], runs, "2026-05-20T01:00:00.000Z");
  const secondRuns = [completedRun(0, { totalScore: 70 }), completedRun(1, { totalScore: 74 })];
  const history = appendAnalysisHistorySnapshot(firstHistory, secondRuns, "2026-05-20T02:00:00.000Z");

  const removed = removeConsistencyAnalysisHistoryRound(
    {
      runs: secondRuns,
      analysis: analyzeConsistency(secondRuns),
      ruleReport: buildRuleReport(secondRuns),
      riskReport: buildRiskReport(secondRuns),
      analysisHistory: history,
    },
    2,
  );

  assert.equal(removed.analysisHistory.length, 1);
  assert.equal(removed.analysisHistory[0]?.round, 1);
  assert.equal(removed.analysis.averageScore, 84);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts -t "removeConsistencyAnalysisHistoryRound deletes one round and rolls back to the latest remaining snapshot"`
Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function removeConsistencyAnalysisHistoryRound(
  task: ConsistencyTaskSnapshot,
  round: number,
): ConsistencyTaskSnapshot {
  const remainingHistory = task.analysisHistory.filter((item) => item.round !== round);
  const normalizedHistory = remainingHistory.map((item, index) => ({
    ...item,
    round: index + 1,
  }));
  const latestRound = normalizedHistory.at(-1);
  if (!latestRound) {
    return {
      ...task,
      analysisHistory: [],
    };
  }
  return {
    ...task,
    runs: latestRound.runs.map((run) => ({ ...run })),
    analysis: analyzeConsistency(latestRound.runs),
    ruleReport: buildRuleReport(latestRound.runs),
    riskReport: buildRiskReport(latestRound.runs),
    analysisHistory: normalizedHistory,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/score-consistency-analysis.test.ts`
Expected: PASS for the new helper coverage and existing consistency analysis coverage.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/scoreConsistencyAnalysis.ts tests/score-consistency-analysis.test.ts src/api/consistencyTaskStore.ts src/storage/sqliteStores.ts tests/sqlite-storage.test.ts
git commit -m "feat: add consistency task deletion helpers"
```

### Task 2: HTTP task delete endpoint

**Files:**
- Modify: `src/api/app.ts`
- Modify: `src/api/apiDefinitions.ts`
- Test: `tests/remote-network-execution.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("consistency task delete handler removes one persisted record", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const store = createConsistencyTaskStore(localCaseRoot);
  await store.upsert({ id: "C-011", sequence: 11, runs: [] });
  const handler = createDeleteConsistencyTaskHandler(store);
  const { response, responseState } = createResponse();

  await handler({ params: { id: "C-011" } } as never, response as never);

  assert.equal(responseState.statusCode, 200);
  assert.equal(responseState.body?.success, true);
  assert.equal((await store.list()).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/remote-network-execution.test.ts -t "consistency task delete handler removes one persisted record"`
Expected: FAIL because the handler does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createDeleteConsistencyTaskHandler(store: ConsistencyTaskStore) {
  return async (req: Request, res: Response) => {
    const id = req.params.id;
    const deleted = await store.delete(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: "Consistency task not found" });
      return;
    }
    res.json({ success: true });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/remote-network-execution.test.ts`
Expected: PASS for the new delete endpoint coverage.

- [ ] **Step 5: Commit**

```bash
git add src/api/app.ts src/api/apiDefinitions.ts tests/remote-network-execution.test.ts
git commit -m "feat: expose consistency task delete endpoint"
```

### Task 3: Detail page task deletion, round selection, and round deletion controls

**Files:**
- Modify: `web/src/api/scoreConsistency.ts`
- Modify: `web/src/pages/ConsistencyAnalysis.vue`
- Test: `web/src/pages/ConsistencyAnalysis.vue` using the existing web test harness if present

- [ ] **Step 1: Write the failing test**

```ts
test("the detail page can select a history round and render the selected round data", async () => {
  // Mount the page with one task containing two history rounds.
  // Assert the selector defaults to the latest round and changes the visible
  // run table when a different round is selected.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- web/src/pages/ConsistencyAnalysis.vue` or the repo’s existing front-end test command for this page.
Expected: FAIL because the round selector and delete controls are not implemented yet.

- [ ] **Step 3: Write minimal implementation**

```vue
<el-select v-model="selectedRound" size="small">
  <el-option v-for="round in roundOptions" :key="round.value" :label="round.label" :value="round.value" />
</el-select>
<el-button link type="danger" @click="deleteCurrentRound">删除当前轮次</el-button>
<el-button link type="danger" @click="deleteCurrentTask">删除任务</el-button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: page tests and existing consistency analysis tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/api/scoreConsistency.ts web/src/pages/ConsistencyAnalysis.vue
git commit -m "feat: add consistency detail round controls"
```

### Task 4: Verification and cleanup

**Files:**
- Inspect: all touched files

- [ ] **Step 1: Run focused verification**

Run:

```bash
node --import tsx --test tests/score-consistency-analysis.test.ts tests/sqlite-storage.test.ts tests/remote-network-execution.test.ts
```

- [ ] **Step 2: Run front-end checks**

Run:

```bash
npm test
```

- [ ] **Step 3: Confirm the final behavior**

Check that deleting a task removes it from the list, deleting a round reindexes history rounds, and the detail page shows the latest multi-round summary above the fixed-round tables below.

