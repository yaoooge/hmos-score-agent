import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRubricCaseAwarePayload } from "../src/agent/rubricCaseAwarePrompt.js";
import { runRubricCaseAwareAgent } from "../src/agent/rubricCaseAwareRunner.js";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { LoadedRubricSnapshot, RubricScoringResult } from "../src/types.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

async function makeCaseRoot(t: test.TestContext): Promise<string> {
  const caseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubric-case-aware-"));
  t.after(async () => {
    await fs.rm(caseRoot, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(caseRoot, "workspace", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseRoot, "original"), { recursive: true });
  await fs.writeFile(
    path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "Index.ets"),
    "let count: number = 1;\n",
    "utf-8",
  );
  return caseRoot;
}

function buildFullScoreFinalAnswer(snapshot: LoadedRubricSnapshot): RubricScoringResult & {
  action: "final_answer";
} {
  return {
    action: "final_answer",
    summary: {
      overall_assessment: "未发现足够负面证据，保持满分。",
      overall_confidence: "medium",
    },
    item_scores: snapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => ({
        dimension_name: dimension.name,
        item_name: item.name,
        score: item.scoring_bands[0].score,
        max_score: item.weight,
        matched_band_score: item.scoring_bands[0].score,
        rationale: "未发现足够负面证据，按满分保留。",
        evidence_used: [],
        confidence: "medium" as const,
        review_required: false,
      })),
    ),
    hard_gate_candidates: [],
    risks: [],
    strengths: [],
    main_issues: [],
  };
}

test("runRubricCaseAwareAgent executes tools and returns rubric final answer without action", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const finalAnswer = buildFullScoreFinalAnswer(rubricSnapshot);
  const responses = [
    JSON.stringify({
      action: "tool_call",
      tool: "read_file",
      args: { path: "workspace/entry/src/main/ets/Index.ets" },
      reason: "先读取变更文件确认是否存在负面证据。",
    }),
    JSON.stringify(finalAnswer),
  ];
  const payload = buildRubricCaseAwarePayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复页面 bug",
      originalProjectPath: path.join(caseRoot, "original"),
      generatedProjectPath: path.join(caseRoot, "workspace"),
    },
    caseRoot,
    taskType: "bug_fix",
    constraintSummary: {
      explicitConstraints: ["修复页面 bug"],
      contextualConstraints: ["保持工程结构"],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    rubricSnapshot,
    initialTargetFiles: ["workspace/entry/src/main/ets/Index.ets"],
  });

  const result = await runRubricCaseAwareAgent({
    caseRoot,
    bootstrapPayload: payload,
    async completeJsonPrompt() {
      return responses.shift() ?? "";
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(result.turns.length, 2);
  assert.equal(result.tool_trace.length, 1);
  assert.equal(result.tool_trace[0]?.ok, true);
  assert.equal(result.final_answer?.item_scores.length, finalAnswer.item_scores.length);
  assert.equal("action" in (result.final_answer as Record<string, unknown>), false);
});

test("runRubricCaseAwareAgent rejects incomplete rubric final answer", async (t) => {
  const caseRoot = await makeCaseRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const finalAnswer = buildFullScoreFinalAnswer(rubricSnapshot);
  finalAnswer.item_scores = finalAnswer.item_scores.slice(1);
  const payload = buildRubricCaseAwarePayload({
    caseInput: {
      caseId: "case-1",
      promptText: "修复页面 bug",
      originalProjectPath: path.join(caseRoot, "original"),
      generatedProjectPath: path.join(caseRoot, "workspace"),
    },
    caseRoot,
    taskType: "bug_fix",
    constraintSummary: {
      explicitConstraints: ["修复页面 bug"],
      contextualConstraints: ["保持工程结构"],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    rubricSnapshot,
    initialTargetFiles: [],
  });

  const result = await runRubricCaseAwareAgent({
    caseRoot,
    bootstrapPayload: payload,
    async completeJsonPrompt() {
      return JSON.stringify(finalAnswer);
    },
  });

  assert.equal(result.outcome, "protocol_error");
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]?.status, "error");
  assert.match(result.failure_reason ?? "", /missing=/);
});
