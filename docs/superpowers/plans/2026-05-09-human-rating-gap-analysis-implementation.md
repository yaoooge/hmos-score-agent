# Human Rating Gap Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual-rating API that stores L1-L6 human ratings, runs gap analysis for L1/L2 high-score disagreements, keeps `outputs/result.json` unchanged, and appends cross-task summaries to the human-review JSONL dataset directory.

**Architecture:** Keep the new manual-rating flow separate from the existing `human-review` recalculation flow. Store per-task artifacts under `caseDir/human-rating/`, append cross-task summaries to `humanReviewEvidenceRoot/datasets/human_rating_gap_analyses.jsonl`, and run a dedicated opencode agent only when the configured L1/L2 thresholds are met.

**Tech Stack:** TypeScript, Node test runner, Express, Zod, existing opencode runner/config/skill patterns, existing `RemoteTaskRegistry`, existing human review evidence root.

---

## File Structure

- Create `src/humanRating/humanRatingTypes.ts`
  - Owns manual-rating request, normalized record, gap analysis result, summary JSONL row, and dependency-facing types.
- Create `src/humanRating/humanRatingGapRules.ts`
  - Maps automatic scores to L2-L6 and decides whether a manual rating qualifies for analysis.
- Create `src/humanRating/humanRatingArtifactStore.ts`
  - Writes `caseDir/human-rating/manual-rating.json`, `analysis.json`, and `analysis-skipped.json`; cross-case history is written only to the evidence store JSONL dataset.
- Create `src/agent/opencodeHumanRatingGapAnalysis.ts`
  - Renders prompts, invokes `hmos-human-rating-gap-analysis`, validates output with Zod, and returns a normalized analysis result.
- Create `src/nodes/humanRatingGapAnalysisNode.ts`
  - Thin orchestration wrapper around the agent runner.
- Create `src/api/manualRatingHandler.ts`
  - Validates request, reads completed task result, applies gap rules, writes artifacts, runs node if needed, appends JSONL dataset row, and responds.
- Modify `src/humanReview/humanReviewTypes.ts`
  - Add `human_rating_gap_analysis` dataset type.
- Modify `src/humanReview/humanReviewEvidenceStore.ts`
  - Map `human_rating_gap_analysis` to `human_rating_gap_analyses.jsonl`.
- Modify `src/api/apiDefinitions.ts`
  - Add `API_PATHS.manualRating` and API docs.
- Modify `src/api/app.ts`
  - Register `POST /score/remote-tasks/:taskId/manual-rating`.
- Modify `src/opencode/opencodeConfig.ts`
  - Add `hmos-human-rating-gap-analysis` to required skill files.
- Modify `.opencode/opencode.template.json`
  - Add the new agent with read/list/grep/glob access, output-only edit permissions, matching skill permission.
- Create `.opencode/prompts/hmos-human-rating-gap-analysis-system.md`
  - Thin system prompt requiring the matching skill and output-file protocol.
- Create `.opencode/skills/hmos-human-rating-gap-analysis/SKILL.md`
  - Role contract, L1-L6 criteria, evidence boundaries, output schema, self-check.
- Create `tests/human-rating-gap-rules.test.ts`
  - Unit tests for score mapping and threshold decisions.
- Create `tests/human-rating-manual-api.test.ts`
  - Handler-level tests for artifacts, JSONL summary append, skip behavior, validation, and `result.json` immutability.
- Create `tests/opencode-human-rating-gap-analysis.test.ts`
  - Runner tests for prompt, agent, output file, schema success/failure.
- Modify `tests/opencode-config.test.ts`
  - Assert new agent, prompt, skill, and required skill file.
- Modify `tests/human-review-ingestion.test.ts`
  - Add dataset filename coverage for `human_rating_gap_analysis`.

## Task 1: Gap Rules

**Files:**
- Create: `src/humanRating/humanRatingTypes.ts`
- Create: `src/humanRating/humanRatingGapRules.ts`
- Test: `tests/human-rating-gap-rules.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/human-rating-gap-rules.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { decideHumanRatingGap, mapAutoScoreToRating } from "../src/humanRating/humanRatingGapRules.js";

test("mapAutoScoreToRating maps scoring thresholds", () => {
  assert.equal(mapAutoScoreToRating(100), "L6");
  assert.equal(mapAutoScoreToRating(99), "L5");
  assert.equal(mapAutoScoreToRating(90), "L5");
  assert.equal(mapAutoScoreToRating(89.9), "L4");
  assert.equal(mapAutoScoreToRating(80), "L4");
  assert.equal(mapAutoScoreToRating(79.9), "L3");
  assert.equal(mapAutoScoreToRating(60), "L3");
  assert.equal(mapAutoScoreToRating(59.9), "L2");
});

test("decideHumanRatingGap only qualifies L1 >=70 and L2 >=80", () => {
  assert.deepEqual(decideHumanRatingGap("L1", 70), {
    autoRating: "L3",
    gapQualified: true,
    gapRule: "manual=L1 autoScore>=70",
  });
  assert.equal(decideHumanRatingGap("L1", 69.99).gapQualified, false);
  assert.deepEqual(decideHumanRatingGap("L2", 80), {
    autoRating: "L4",
    gapQualified: true,
    gapRule: "manual=L2 autoScore>=80",
  });
  assert.equal(decideHumanRatingGap("L2", 79.99).gapQualified, false);
  assert.equal(decideHumanRatingGap("L3", 100).gapQualified, false);
  assert.equal(decideHumanRatingGap("L6", 100).gapQualified, false);
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/human-rating-gap-rules.test.ts`

Expected: FAIL because `src/humanRating/humanRatingGapRules.ts` does not exist.

- [ ] **Step 3: Implement minimal types and rules**

Create `src/humanRating/humanRatingTypes.ts`:

```ts
export type HumanManualRating = "L1" | "L2" | "L3" | "L4" | "L5" | "L6";

export type HumanRatingGapDecision = {
  autoRating: HumanManualRating;
  gapQualified: boolean;
  gapRule?: string;
};
```

Create `src/humanRating/humanRatingGapRules.ts`:

```ts
import type { HumanManualRating, HumanRatingGapDecision } from "./humanRatingTypes.js";

export function mapAutoScoreToRating(score: number): HumanManualRating {
  if (score === 100) return "L6";
  if (score >= 90) return "L5";
  if (score >= 80) return "L4";
  if (score >= 60) return "L3";
  return "L2";
}

export function decideHumanRatingGap(
  manualRating: HumanManualRating,
  autoScore: number,
): HumanRatingGapDecision {
  const autoRating = mapAutoScoreToRating(autoScore);
  if (manualRating === "L1" && autoScore >= 70) {
    return { autoRating, gapQualified: true, gapRule: "manual=L1 autoScore>=70" };
  }
  if (manualRating === "L2" && autoScore >= 80) {
    return { autoRating, gapQualified: true, gapRule: "manual=L2 autoScore>=80" };
  }
  return { autoRating, gapQualified: false };
}
```

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/human-rating-gap-rules.test.ts`

Expected: PASS.

## Task 2: JSONL Dataset Type

**Files:**
- Modify: `src/humanReview/humanReviewTypes.ts`
- Modify: `src/humanReview/humanReviewEvidenceStore.ts`
- Test: `tests/human-review-ingestion.test.ts`

- [ ] **Step 1: Write failing test**

Append to `tests/human-review-ingestion.test.ts` near existing evidence store tests:

```ts
test("human review evidence store writes human rating gap analysis dataset", async (t) => {
  const root = await makeTempDir(t);
  const store = createHumanReviewEvidenceStore(root);

  await store.appendDatasetSample("human_rating_gap_analysis", {
    type: "human_rating_gap_analysis",
    taskId: 88,
    manualRating: "L1",
    autoScore: 92,
    primaryConclusion: "scoring_system_needs_improvement",
  });

  const datasetLines = (
    await fs.readFile(path.join(root, "datasets", "human_rating_gap_analyses.jsonl"), "utf-8")
  )
    .trim()
    .split("\n");
  const sample = JSON.parse(datasetLines[0] ?? "{}") as Record<string, unknown>;
  assert.equal(datasetLines.length, 1);
  assert.equal(sample.type, "human_rating_gap_analysis");
  assert.equal(sample.taskId, 88);
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/human-review-ingestion.test.ts`

Expected: FAIL because `human_rating_gap_analysis` is not assignable/mapped.

- [ ] **Step 3: Add dataset type and filename**

Modify `src/humanReview/humanReviewTypes.ts`:

```ts
export type HumanReviewDatasetType =
  | "item_review_calibration"
  | "risk_review_calibration"
  | "human_rating_gap_analysis";
```

Modify `src/humanReview/humanReviewEvidenceStore.ts`:

```ts
const DATASET_FILE_NAMES: Record<HumanReviewDatasetType, string> = {
  item_review_calibration: "item_review_calibrations.jsonl",
  risk_review_calibration: "risk_review_calibrations.jsonl",
  human_rating_gap_analysis: "human_rating_gap_analyses.jsonl",
};
```

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/human-review-ingestion.test.ts`

Expected: PASS.

## Task 3: Manual Rating Artifacts

**Files:**
- Extend: `src/humanRating/humanRatingTypes.ts`
- Create: `src/humanRating/humanRatingArtifactStore.ts`
- Test: `tests/human-rating-manual-api.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Create `tests/human-rating-manual-api.test.ts` with a focused store test:

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeHumanRatingAnalysis, writeHumanRatingRecord, writeHumanRatingSkipped } from "../src/humanRating/humanRatingArtifactStore.js";

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "human-rating-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("human rating artifact store writes latest records and history", async (t) => {
  const caseDir = await makeTempDir(t);
  const record = {
    taskId: 88,
    testCaseId: 188,
    reviewedAt: "2026-05-09T02:30:00.000Z",
    reviewer: "alice",
    manualRating: "L1" as const,
    basis: "无法编译运行。",
    autoScore: 92,
    autoRating: "L5" as const,
    gapQualified: true,
    gapRule: "manual=L1 autoScore>=70",
  };

  await writeHumanRatingRecord(caseDir, record);
  await writeHumanRatingSkipped(caseDir, { ...record, gapQualified: false, gapRule: undefined }, "未达到差异分析阈值。");
  await writeHumanRatingAnalysis(caseDir, {
    ...record,
    analysis: {
      primaryConclusion: "scoring_system_needs_improvement",
      confidence: "medium",
      reasonSummary: "自动评分漏判编译失败。",
      humanRatingReview: { needsImprovement: false, reason: "人工依据充分。" },
      scoringSystemReview: { needsImprovement: true, reason: "缺少 hard gate。" },
      evidence: ["outputs/result.json"],
      recommendedActions: ["补充 hard gate。"],
    },
  });

  const latest = JSON.parse(await fs.readFile(path.join(caseDir, "human-rating", "manual-rating.json"), "utf-8")) as Record<string, unknown>;
  await fs.access(path.join(caseDir, "human-rating", "analysis-skipped.json"));
  await fs.access(path.join(caseDir, "human-rating", "analysis.json"));

  assert.equal(latest.taskId, 88);
  await assert.rejects(() => fs.access(path.join(caseDir, "human-rating", "manual-rating-history.jsonl")), /ENOENT/);
  await assert.rejects(() => fs.access(path.join(caseDir, "human-rating", "analysis-history.jsonl")), /ENOENT/);
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/human-rating-manual-api.test.ts`

Expected: FAIL because artifact store does not exist.

- [ ] **Step 3: Implement artifact store**

Create `src/humanRating/humanRatingArtifactStore.ts` with `writeJson`, `appendJsonl`, and the three exported functions used by the test. Use `fs.mkdir(path.dirname(filePath), { recursive: true })`, `JSON.stringify(value, null, 2)` for latest JSON, and single-line `JSON.stringify(value)` for JSONL.

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/human-rating-manual-api.test.ts`

Expected: PASS.

## Task 4: Agent Runner and Skill Contract

**Files:**
- Create: `src/agent/opencodeHumanRatingGapAnalysis.ts`
- Create: `tests/opencode-human-rating-gap-analysis.test.ts`
- Create: `.opencode/prompts/hmos-human-rating-gap-analysis-system.md`
- Create: `.opencode/skills/hmos-human-rating-gap-analysis/SKILL.md`

- [ ] **Step 1: Write failing runner tests**

Create tests that call `runOpencodeHumanRatingGapAnalysis` with a stub `runPrompt`, assert agent name `hmos-human-rating-gap-analysis`, output file `metadata/agent-output/human-rating-gap-analysis.json`, prompt requires the matching skill, and valid JSON returns `outcome: "success"`. Add a second test where raw text is missing required fields and assert `outcome: "protocol_error"`.

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/opencode-human-rating-gap-analysis.test.ts`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement runner**

Mirror the established pattern from `src/agent/opencodeRuleAssessment.ts`:

- Define Zod enum for `primaryConclusion`.
- Define `confidence` enum.
- Validate `reasonSummary`, nested reviews, non-empty `evidence`, non-empty `recommendedActions`.
- Render prompt with sandbox root, manual rating record, result summary, output file, and strict file-output instructions.
- Call `extractFinalJsonObject`.
- Return `{ outcome: "success", final_answer, raw_events }` or protocol/request failure.

- [ ] **Step 4: Add prompt and skill**

Create `.opencode/prompts/hmos-human-rating-gap-analysis-system.md` with the same output-file protocol wording used by the existing system prompts.

Create `.opencode/skills/hmos-human-rating-gap-analysis/SKILL.md` with sections:

- `职责边界`
- `人工评级标准`
- `差异分析规则`
- `证据边界`
- `强制输出格式`
- `文件输出协议`
- `自检清单`
- `References`

- [ ] **Step 5: Verify green**

Run: `npm test -- tests/opencode-human-rating-gap-analysis.test.ts`

Expected: PASS.

## Task 5: Manual Rating Handler

**Files:**
- Create: `src/api/manualRatingHandler.ts`
- Create: `src/nodes/humanRatingGapAnalysisNode.ts`
- Extend: `tests/human-rating-manual-api.test.ts`

- [ ] **Step 1: Write failing handler tests**

Extend `tests/human-rating-manual-api.test.ts` with handler tests that:

- Create a completed remote task with `outputs/result.json`.
- Submit `{ reviewer: "alice", manualRating: "L1", basis: "无法编译运行。" }`.
- Inject a fake analyzer returning `scoring_system_needs_improvement`.
- Assert response success and `analysisStatus: "completed"`.
- Assert `outputs/result.json` bytes are unchanged.
- Assert `human-rating/manual-rating.json` and `human-rating/analysis.json` exist.
- Assert `datasets/human_rating_gap_analyses.jsonl` gets one row.
- Add skip tests for L1 `<70`, L2 `<80`, and L3 `100`.
- Add invalid body/status/result-score tests.

- [ ] **Step 2: Run red tests**

Run: `npm test -- tests/human-rating-manual-api.test.ts`

Expected: FAIL because `manualRatingHandler` does not exist.

- [ ] **Step 3: Implement handler**

Implement `createSubmitManualRatingHandler(deps)` with deps:

```ts
{
  registry: RemoteTaskRegistry;
  store: HumanReviewEvidenceStore;
  analyzeGap?: typeof humanRatingGapAnalysisNode;
}
```

Rules:

- Request body must be object.
- `manualRating` must be L1-L6.
- `basis` must be a non-empty string.
- `reviewer` is optional string.
- Task must exist and be completed.
- Read `outputs/result.json`.
- Read finite `overall_conclusion.total_score`, else 409.
- Write manual rating artifact before optional analysis.
- If not qualified, write skipped artifact and do not call analyzer.
- If qualified, call analyzer, write analysis artifact, append one `human_rating_gap_analysis` dataset sample.
- Never write `outputs/result.json`.

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/human-rating-manual-api.test.ts`

Expected: PASS.

## Task 6: API and App Wiring

**Files:**
- Modify: `src/api/apiDefinitions.ts`
- Modify: `src/api/app.ts`
- Modify: `tests/human-rating-manual-api.test.ts`

- [ ] **Step 1: Write failing API definition/app tests**

Add tests asserting:

- `API_PATHS.manualRating === "/score/remote-tasks/:taskId/manual-rating"`.
- `API_DEFINITIONS` contains that path.
- `createApp` registers the route by using an Express integration-style request if an existing pattern exists; otherwise verify exported handler is imported and route constant is documented.

- [ ] **Step 2: Run red tests**

Run: `npm test -- tests/human-rating-manual-api.test.ts`

Expected: FAIL because API path/route is missing.

- [ ] **Step 3: Wire path and route**

Add `manualRating` to `API_PATHS`, add API definition body/response docs, import `createSubmitManualRatingHandler` in `src/api/app.ts`, and register:

```ts
app.post(
  API_PATHS.manualRating,
  createSubmitManualRatingHandler({ registry, store: humanReviewEvidenceStore }),
);
```

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/human-rating-manual-api.test.ts`

Expected: PASS.

## Task 7: Opencode Config Wiring

**Files:**
- Modify: `src/opencode/opencodeConfig.ts`
- Modify: `.opencode/opencode.template.json`
- Modify: `tests/opencode-config.test.ts`

- [ ] **Step 1: Write failing config tests**

Modify `tests/opencode-config.test.ts` to include `hmos-human-rating-gap-analysis` wherever the three existing project agents are asserted, and add expected skill output file `metadata/agent-output/human-rating-gap-analysis.json`.

- [ ] **Step 2: Run red tests**

Run: `npm test -- tests/opencode-config.test.ts`

Expected: FAIL because config and skill requirement are missing.

- [ ] **Step 3: Wire config**

Add `hmos-human-rating-gap-analysis` to `REQUIRED_SKILL_NAMES`.

Add agent config to `.opencode/opencode.template.json` with:

- prompt `.opencode/prompts/hmos-human-rating-gap-analysis-system.md`
- read/write allowed
- glob/grep/list allowed
- edit only `metadata/agent-output/*.json`
- bash/task/lsp/web/search/question/external_directory denied
- skill permission only `hmos-human-rating-gap-analysis`

- [ ] **Step 4: Verify green**

Run: `npm test -- tests/opencode-config.test.ts`

Expected: PASS.

## Task 8: Full Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/human-rating-gap-rules.test.ts tests/human-rating-manual-api.test.ts tests/opencode-human-rating-gap-analysis.test.ts tests/opencode-config.test.ts tests/human-review-ingestion.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full build and tests**

Run:

```bash
npm run build
npm test
```

Expected: both commands exit 0.

- [ ] **Step 3: Inspect diff for forbidden behavior**

Run:

```bash
git diff -- src tests .opencode docs/superpowers/specs/2026-05-09-human-rating-gap-analysis-design.md docs/superpowers/plans/2026-05-09-human-rating-gap-analysis-implementation.md
```

Expected:

- No code path writes `outputs/result.json` in manual-rating flow.
- No `rating-gap-summary.csv` remains.
- JSONL summary path is under `humanReviewEvidenceRoot/datasets/human_rating_gap_analyses.jsonl`.
- Manual L1/L2 thresholds match the spec.

## Self-Review

- Spec coverage: The tasks cover the manual-rating API, L1/L2 thresholds, no `result.json` mutation, dedicated agent/skill, caseDir single-task artifacts, and human-review-root JSONL summary.
- Placeholder scan: No task uses TBD/TODO placeholders; implementation details name exact files and commands.
- Type consistency: Manual rating uses `manualRating`, `basis`, optional string `reviewer`, and JSONL dataset type `human_rating_gap_analysis` consistently.
