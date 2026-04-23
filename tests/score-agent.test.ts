import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { ArtifactStore } from "../src/io/artifactStore.js";
import { loadCaseFromPath } from "../src/io/caseLoader.js";
import { inputClassificationNode } from "../src/nodes/inputClassificationNode.js";
import { artifactPostProcessNode } from "../src/nodes/artifactPostProcessNode.js";
import { persistAndUploadNode } from "../src/nodes/persistAndUploadNode.js";
import { reportGenerationNode } from "../src/nodes/reportGenerationNode.js";
import { rubricScoringAgentNode } from "../src/nodes/rubricScoringAgentNode.js";
import { rubricScoringPromptBuilderNode } from "../src/nodes/rubricScoringPromptBuilderNode.js";
import { ruleAgentPromptBuilderNode } from "../src/nodes/ruleAgentPromptBuilderNode.js";
import { ruleAssessmentAgentNode } from "../src/nodes/ruleAssessmentAgentNode.js";
import { ruleAuditNode } from "../src/nodes/ruleAuditNode.js";
import { ruleMergeNode } from "../src/nodes/ruleMergeNode.js";
import { scoreFusionOrchestrationNode } from "../src/nodes/scoreFusionOrchestrationNode.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import { runScoreWorkflow } from "../src/workflow/scoreWorkflow.js";
import type { CaseInput } from "../src/types.js";

const fixtureRoot = path.resolve(process.cwd(), "tests/fixtures");
const schemaPath = path.join(fixtureRoot, "report_result_schema.json");

async function makeTempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hmos-score-agent-"));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

async function writeCaseFixture(
  rootDir: string,
  options: {
    caseId?: string;
    promptText?: string;
    withPatch?: boolean;
    workspaceContent?: string;
    originalContent?: string;
    expectedConstraintsYaml?: string;
  } = {},
): Promise<string> {
  const caseDir = path.join(rootDir, options.caseId ?? "sample-case");
  await fs.mkdir(path.join(caseDir, "original", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseDir, "workspace", "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "input.txt"),
    options.promptText ?? "新增餐厅列表页面",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "original", "entry", "src", "main", "ets", "Index.ets"),
    options.originalContent ?? "let count: number = 1;\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseDir, "workspace", "entry", "src", "main", "ets", "Index.ets"),
    options.workspaceContent ?? "let count: number = 2;\n",
    "utf-8",
  );
  if (options.withPatch) {
    await fs.mkdir(path.join(caseDir, "diff"), { recursive: true });
    await fs.writeFile(
      path.join(caseDir, "diff", "changes.patch"),
      "diff --git a/entry/src/main/ets/Index.ets b/entry/src/main/ets/Index.ets\n@@ -1 +1 @@\n-let count: number = 1;\n+let count: any = 2;\n",
      "utf-8",
    );
  }
  if (options.expectedConstraintsYaml) {
    await fs.writeFile(
      path.join(caseDir, "expected_constraints.yaml"),
      options.expectedConstraintsYaml,
      "utf-8",
    );
  }
  return caseDir;
}

async function createReferenceRoot(_t: test.TestContext): Promise<string> {
  return path.resolve(process.cwd(), "references/scoring");
}

function makeState(input: Partial<CaseInput> = {}): {
  caseInput: CaseInput;
} {
  return {
    caseInput: {
      caseId: "case-1",
      promptText: "新增餐厅列表页面",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
      ...input,
    },
  };
}

test("loadCaseFromPath loads prompt and optional patch path", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    withPatch: true,
    promptText: "修复餐厅页面 bug",
  });

  const caseInput = await loadCaseFromPath(caseDir);

  assert.equal(caseInput.caseId, "sample-case");
  assert.equal(caseInput.promptText, "修复餐厅页面 bug");
  assert.equal(caseInput.originalProjectPath, path.join(caseDir, "original"));
  assert.equal(caseInput.generatedProjectPath, path.join(caseDir, "workspace"));
  assert.equal(caseInput.patchPath, path.join(caseDir, "diff", "changes.patch"));
});

test("loadCaseFromPath leaves patch undefined when diff file is absent", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir);

  const caseInput = await loadCaseFromPath(caseDir);

  assert.equal(caseInput.patchPath, undefined);
});

test("loadCaseFromPath exposes expectedConstraintsPath when YAML exists", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    caseId: "requirement_004",
    expectedConstraintsYaml: `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton 实现华为账号一键登录
    description: 登录页必须使用 Account Kit 提供的 LoginWithHuaweiIDButton 组件作为一键登录入口。
    priority: P0
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: import
            module: '@kit.AccountKit'
        llm: 检查是否从 @kit.AccountKit 导入并使用了 LoginWithHuaweiIDButton 组件
`,
  });

  const caseInput = await loadCaseFromPath(caseDir);

  assert.equal(caseInput.expectedConstraintsPath, path.join(caseDir, "expected_constraints.yaml"));
});

test("loadCaseFromPath creates an empty original directory when original input is absent", async (t) => {
  const rootDir = await makeTempDir(t);
  const caseDir = path.join(rootDir, "workspace-only-case");
  const originalProjectPath = path.join(caseDir, "original");
  const generatedProjectPath = path.join(caseDir, "workspace");

  await fs.mkdir(path.join(generatedProjectPath, "entry", "src", "main", "ets"), {
    recursive: true,
  });
  await fs.writeFile(path.join(caseDir, "input.txt"), "实现商城首页", "utf-8");
  await fs.writeFile(
    path.join(generatedProjectPath, "entry", "src", "main", "ets", "Index.ets"),
    "Text('workspace only')\n",
    "utf-8",
  );

  const caseInput = await loadCaseFromPath(caseDir);
  const reloadedCaseInput = await loadCaseFromPath(caseDir);
  const originalStat = await fs.stat(originalProjectPath);
  const originalEntries = await fs.readdir(originalProjectPath);

  assert.equal(originalStat.isDirectory(), true);
  assert.deepEqual(originalEntries, []);
  assert.equal(caseInput.originalProjectProvided, false);
  assert.equal(reloadedCaseInput.originalProjectProvided, false);
  assert.equal(caseInput.originalProjectPath, originalProjectPath);
});

test("ArtifactStore creates case directories and persists json/text artifacts", async (t) => {
  const rootDir = await makeTempDir(t);
  const store = new ArtifactStore(rootDir);

  const caseDir = await store.ensureCaseDir("case-1");
  await store.writeJson(caseDir, "outputs/result.json", { ok: true });
  await store.writeText(caseDir, "logs/run.log", "hello");

  await Promise.all(
    ["inputs", "intermediate", "outputs", "logs"].map(async (dirName) => {
      const stat = await fs.stat(path.join(caseDir, dirName));
      assert.equal(stat.isDirectory(), true);
    }),
  );

  const resultJson = JSON.parse(
    await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"),
  );
  const logText = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");
  assert.deepEqual(resultJson, { ok: true });
  assert.equal(logText, "hello");
});

test("inputClassificationNode prioritizes bug_fix over patch-based continuation", async () => {
  const bugResult = await inputClassificationNode(
    makeState({
      promptText: "请修复餐厅列表页面 bug",
      patchPath: "/tmp/changes.patch",
    }) as never,
  );
  const continuationResult = await inputClassificationNode(
    makeState({
      promptText: "继续完善餐厅列表页面",
      patchPath: "/tmp/changes.patch",
    }) as never,
  );
  const fullGenerationResult = await inputClassificationNode(makeState() as never);

  assert.equal(bugResult.taskType, "bug_fix");
  assert.equal(continuationResult.taskType, "continuation");
  assert.equal(fullGenerationResult.taskType, "full_generation");
});

test("inputClassificationNode keeps workspace-only cases as full_generation even after patch creation", async () => {
  const result = await inputClassificationNode(
    makeState({
      promptText: "实现商城首页",
      patchPath: "/tmp/generated.patch",
      originalProjectProvided: false,
    }) as never,
  );

  assert.equal(result.taskType, "full_generation");
});

test("explicit rubric and rule agent nodes are exported", () => {
  assert.equal(typeof rubricScoringPromptBuilderNode, "function");
  assert.equal(typeof rubricScoringAgentNode, "function");
  assert.equal(typeof ruleAgentPromptBuilderNode, "function");
  assert.equal(typeof ruleAssessmentAgentNode, "function");
});

test("rubricScoringPromptBuilderNode builds rubric item scoring prompt", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const result = await rubricScoringPromptBuilderNode(
    {
      caseInput: makeState({
        promptText: "请修复餐厅列表页中的 bug",
        patchPath: "/tmp/changes.patch",
      }).caseInput,
      sourceCasePath: "/tmp/case-1",
      effectivePatchPath: "/tmp/changes.patch",
      taskType: "bug_fix",
      constraintSummary: {
        explicitConstraints: ["修复餐厅列表页 bug"],
        contextualConstraints: ["保持 ArkTS 工程结构"],
        implicitConstraints: ["存在 patch"],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: buildRubricSnapshot(rubric),
    } as never,
    { logger: undefined },
  );

  assert.ok(result.rubricScoringPromptText?.includes("逐项输出 rubric item"));
  assert.equal(result.rubricScoringPayload?.case_context.task_type, "bug_fix");
});

test("rubricScoringAgentNode skips when agent client is missing", async () => {
  const skipped = await rubricScoringAgentNode(
    {
      rubricScoringPromptText: "请逐项输出 rubric item 的评分",
    } as never,
    { logger: undefined },
  );

  assert.equal(skipped.rubricAgentRunStatus, "skipped");
});

test("rubricScoringAgentNode retries once when rubric output violates schema", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const itemScores = rubricSnapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: `根据 ${item.name} 的评分档位，当前证据满足该档要求。`,
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "medium",
      review_required: false,
    })),
  );
  const prompts: string[] = [];
  const warnings: string[] = [];
  const agentClient = {
    async completeJsonPrompt(prompt: string): Promise<string> {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return JSON.stringify({
          summary: "错误结构",
          item_scores: [{ name: "问题点命中程度", score: 10 }],
          hard_gate_candidates: [],
          risks: [],
          strengths: [],
          main_issues: [],
        });
      }
      return JSON.stringify({
        summary: {
          overall_assessment: "修复重试后输出符合 rubric schema。",
          overall_confidence: "medium",
        },
        item_scores: itemScores,
        hard_gate_candidates: [],
        risks: [],
        strengths: ["结构清晰"],
        main_issues: [],
      });
    },
  };

  const result = await rubricScoringAgentNode(
    {
      rubricScoringPromptText: "请逐项输出 rubric item 的评分",
      rubricSnapshot,
    } as never,
    {
      agentClient,
      logger: {
        async info() {},
        async warn(message: string) {
          warnings.push(message);
        },
        async error() {},
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /rubric 评分协议修复重试/);
  assert.match(prompts[1], /上一轮输出不符合 schema/);
  assert.match(prompts[1], /只能重新输出一个 JSON object/);
  assert.match(prompts[1], /summary\.overall_assessment/);
  assert.equal(result.rubricAgentRunStatus, "success");
  assert.equal(result.rubricScoringResult?.item_scores.length, itemScores.length);
  assert.match(warnings.join("\n"), /rubric agent 输出违反协议，发起一次修复重试/);
});

test("rubricScoringAgentNode returns invalid_output after one failed retry", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const prompts: string[] = [];
  const agentClient = {
    async completeJsonPrompt(prompt: string): Promise<string> {
      prompts.push(prompt);
      return JSON.stringify({
        summary: "仍然是错误结构",
        item_scores: [],
        hard_gate_candidates: [],
        risks: [],
        strengths: [],
        main_issues: [],
      });
    },
  };

  const result = await rubricScoringAgentNode(
    {
      rubricScoringPromptText: "请逐项输出 rubric item 的评分",
      rubricSnapshot,
    } as never,
    {
      agentClient,
      logger: {
        async info() {},
        async warn() {},
        async error() {},
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.equal(result.rubricAgentRunStatus, "invalid_output");
  assert.equal(result.rubricScoringResult, undefined);
});

test("rubricScoringAgentNode retries with compact prompt after network-style fetch failure", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const itemScores = rubricSnapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      score: item.scoring_bands[0].score,
      max_score: item.weight,
      matched_band_score: item.scoring_bands[0].score,
      rationale: "证据支持该档评分。",
      evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
      confidence: "medium",
      review_required: false,
    })),
  );
  const prompts: string[] = [];
  const warnings: string[] = [];
  const agentClient = {
    async completeJsonPrompt(prompt: string): Promise<string> {
      prompts.push(prompt);
      if (prompts.length === 1) {
        throw new Error(
          "Agent 网络请求失败 request=rubric_scoring elapsedMs=61000 promptChars=100 promptBytes=120 causeCode=UND_ERR_SOCKET causeMessage=other side closed",
        );
      }
      return JSON.stringify({
        summary: {
          overall_assessment: "compact 重试后完成评分。",
          overall_confidence: "medium",
        },
        item_scores: itemScores,
        hard_gate_candidates: [],
        risks: [],
        strengths: ["结构清晰"],
        main_issues: [],
      });
    },
  };

  const result = await rubricScoringAgentNode(
    {
      rubricScoringPromptText: "请逐项输出 rubric item 的评分",
      rubricScoringPayload: {
        case_context: {
          case_id: "case-1",
          case_root: "/case",
          task_type: "bug_fix",
          original_prompt_summary: "修复页面 bug",
          original_project_path: "/case/original",
          generated_project_path: "/case/workspace",
          effective_patch_path: "/case/diff/changes.patch",
        },
        task_understanding: {
          explicitConstraints: ["修复页面 bug"],
          contextualConstraints: ["保持工程结构"],
          implicitConstraints: ["有 patch"],
          classificationHints: ["bug_fix"],
        },
        rubric_summary: rubricSnapshot,
        response_contract: {
          output_language: "zh-CN",
          json_only: true,
          required_top_level_fields: [
            "summary",
            "item_scores",
            "hard_gate_candidates",
            "risks",
            "strengths",
            "main_issues",
          ],
        },
      },
      rubricSnapshot,
    } as never,
    {
      agentClient,
      logger: {
        async info() {},
        async warn(message: string) {
          warnings.push(message);
        },
        async error() {},
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /compact/);
  assert.match(prompts[1], /输出尽量短/);
  assert.equal(result.rubricAgentRunStatus, "success");
  assert.equal(result.rubricScoringResult?.item_scores.length, itemScores.length);
  assert.match(warnings.join("\n"), /切换 compact prompt 重试/);
});

test("ruleAuditNode emits one ledger item per rule and preserves source ordering", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await ruleAuditNode(
    {
      caseInput,
      taskType: "full_generation",
    } as never,
    { referenceRoot },
  );

  assert.ok((result.ruleViolations?.length ?? 0) >= 1);
  assert.equal("ruleAuditResults" in result, false);
  assert.deepEqual(
    result.staticRuleAuditResults?.slice(0, 4).map((item) => item.rule_id),
    ["ARKTS-MUST-001", "ARKTS-MUST-002", "ARKTS-MUST-003", "ARKTS-MUST-004"],
  );
  assert.deepEqual(
    result.staticRuleAuditResults?.slice(0, 4).map((item) => item.rule_source),
    ["must_rule", "must_rule", "must_rule", "must_rule"],
  );
  assert.equal(
    result.deterministicRuleResults?.some(
      (item) => item.rule_id === "ARKTS-MUST-005" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults?.some(
      (item) => item.rule_id === "ARKTS-MUST-006" && item.result === "不满足",
    ),
    true,
  );
});

test("ruleAuditNode exposes static results and agent candidates separately", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await ruleAuditNode(
    {
      caseInput,
      taskType: "full_generation",
    } as never,
    { referenceRoot },
  );

  assert.equal(Array.isArray(result.staticRuleAuditResults), true);
  assert.equal(Array.isArray(result.deterministicRuleResults), true);
  assert.equal(Array.isArray(result.assistedRuleCandidates), true);
  assert.equal(result.assistedRuleCandidates?.length, 0);
  assert.equal(
    result.deterministicRuleResults?.some(
      (item) => item.rule_id === "ARKTS-MUST-004" && item.result === "不涉及",
    ),
    true,
  );
});

test("ruleMergeNode returns deterministic results directly when there are no assisted candidates", async () => {
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-MUST-001",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "检测到规则命中，文件：entry/src/main/ets/pages/Index.ets",
    },
  ];

  const result = await ruleMergeNode(
    {
      deterministicRuleResults,
      assistedRuleCandidates: [],
    } as never,
    {},
  );

  assert.deepEqual(result.mergedRuleAuditResults, deterministicRuleResults);
  assert.equal(result.ruleAgentAssessmentResult, undefined);
});

test("ruleMergeNode preserves structured agent judgments from canonical runner result", async () => {
  const result = await ruleMergeNode(
    {
      deterministicRuleResults: [
        {
          rule_id: "ARKTS-MUST-001",
          rule_source: "must_rule",
          result: "满足",
          conclusion: "本地静态规则已确定。",
        },
      ],
      assistedRuleCandidates: [
        {
          rule_id: "HM-REQ-010-01",
          rule_source: "must_rule",
          why_uncertain: "需要结合页面上下文判断",
          local_preliminary_signal: "unknown",
          evidence_files: ["features/home/src/main/ets/pages/HomePage.ets"],
          evidence_snippets: ["Text('首页')"],
          rule_name: "首页必须新增当前位置或本地频道展示区，并支持用户主动刷新定位结果",
          is_case_rule: true,
        },
        {
          rule_id: "HM-REQ-010-02",
          rule_source: "must_rule",
          why_uncertain: "需要确认是否真的接入定位能力",
          local_preliminary_signal: "possible_violation",
          evidence_files: ["features/home/src/main/ets/viewModels/HomePageVM.ets"],
          evidence_snippets: ["refreshList()"],
          rule_name: "必须按需申请定位权限并通过 Location Kit 获取设备当前位置",
          is_case_rule: true,
        },
      ],
      ruleAgentRunStatus: "success",
      ruleAgentRunnerResult: {
        outcome: "success",
        final_answer: {
          action: "final_answer",
          summary: {
            assistant_scope: "provider 已产出结构化分条判断",
            overall_confidence: "medium",
          },
          rule_assessments: [
            {
              rule_id: "HM-REQ-010-01",
              decision: "violation",
              confidence: "high",
              reason: "首页未发现当前位置展示区或手动刷新定位入口。",
              evidence_used: ["features/home/src/main/ets/pages/HomePage.ets"],
              needs_human_review: false,
            },
            {
              rule_id: "HM-REQ-010-02",
              decision: "uncertain",
              confidence: "low",
              reason: "仅看到刷新链路，未见 Location Kit 调用。",
              evidence_used: ["features/home/src/main/ets/viewModels/HomePageVM.ets"],
              needs_human_review: true,
            },
          ],
        },
        turns: [],
        tool_trace: [],
      },
    } as never,
    {},
  );

  assert.equal(result.ruleAgentRunStatus, "success");
  assert.equal(result.ruleAgentAssessmentResult?.rule_assessments.length, 2);
  assert.equal(
    result.mergedRuleAuditResults?.find((item) => item.rule_id === "HM-REQ-010-01")?.result,
    "不满足",
  );
  assert.match(
    result.mergedRuleAuditResults?.find((item) => item.rule_id === "HM-REQ-010-01")?.conclusion ??
      "",
    /当前位置展示区/,
  );
  assert.equal(
    result.mergedRuleAuditResults?.find((item) => item.rule_id === "HM-REQ-010-02")?.result,
    "待人工复核",
  );
  assert.match(
    result.mergedRuleAuditResults?.find((item) => item.rule_id === "HM-REQ-010-02")?.conclusion ??
      "",
    /Location Kit 调用/,
  );
});

test("scoring and report nodes fall back to deterministic results when merge output is absent", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const staticRuleAuditResults = [
    {
      rule_id: "ARKTS-MUST-004",
      rule_source: "must_rule",
      result: "未接入判定器",
      conclusion: "该规则仍需 agent 辅助判定。",
    },
  ];
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-MUST-005",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "检测到 any 类型使用。",
    },
  ];

  const scoringResult = await scoreFusionOrchestrationNode({
    taskType: "bug_fix",
    staticRuleAuditResults,
    deterministicRuleResults,
    ruleViolations: [],
    constraintSummary: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  } as never);

  assert.equal(
    scoringResult.scoreComputation?.scoreFusionDetails.some((detail) =>
      detail.rule_impacts.some((impact) => impact.rule_id === "ARKTS-MUST-005"),
    ),
    true,
  );

  const reportResult = await reportGenerationNode(
    {
      taskType: "bug_fix",
      caseInput: {
        caseId: "case-1",
        promptText: "请修复餐厅列表页中的 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      staticRuleAuditResults,
      rubricSnapshot: {
        task_type: "bug_fix",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario:
          "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
        scoring_method: "discrete_band",
        scoring_note: "二级指标按离散档位给分。",
        common_risks: ["因顺手优化造成 diff 噪音和误修。"],
        report_emphasis: ["是否命中问题点。"],
        dimension_summaries: [
          {
            name: "改动精准度与最小侵入性",
            weight: 25,
            intent: "评价是否精准修复问题且控制改动范围",
            item_summaries: [
              {
                name: "问题点命中程度",
                weight: 10,
                scoring_bands: [{ score: 10, criteria: "修改直接命中根因或完整故障链路。" }],
              },
            ],
          },
        ],
        hard_gates: [{ id: "G4", score_cap: 59 }],
        review_rule_summary: ["关键分段分数需要人工复核"],
      },
      deterministicRuleResults,
      scoreComputation: scoringResult.scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  assert.deepEqual(reportResult.resultJson?.rule_audit_results, [
    {
      ...deterministicRuleResults[0],
      rule_summary: "禁止使用 var，必须使用 let 或 const。",
    },
  ]);
});

test("reportGenerationNode includes case_rule_results in resultJson", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const scoringResult = await scoreFusionOrchestrationNode({
    taskType: "full_generation",
    deterministicRuleResults: [
      {
        rule_id: "HM-REQ-008-01",
        rule_source: "must_rule",
        result: "不满足",
        conclusion: "未使用 LoginWithHuaweiIDButton",
      },
    ],
    ruleViolations: [],
    constraintSummary: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["full_generation"],
    },
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/LoginPage.ets"],
      hasPatch: true,
    },
    caseRuleDefinitions: [
      {
        pack_id: "case-requirement_004",
        rule_id: "HM-REQ-008-01",
        rule_name: "必须使用 LoginWithHuaweiIDButton",
        rule_source: "must_rule",
        summary: "登录页必须使用 LoginWithHuaweiIDButton",
        priority: "P0",
        detector_kind: "case_constraint",
        detector_config: {
          targetPatterns: ["**/pages/*.ets"],
          astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
          llmPrompt: "检查登录按钮",
        },
        fallback_policy: "agent_assisted",
        is_case_rule: true,
      },
    ],
  } as never);

  const reportResult = await reportGenerationNode(
    {
      taskType: "full_generation",
      caseInput: {
        caseId: "case-1",
        promptText: "实现登录流程",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["full_generation"],
      },
      rubricSnapshot: {
        task_type: "full_generation",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario: "生成登录流程页面",
        scoring_method: "discrete_band",
        scoring_note: "按离散档位给分。",
        common_risks: ["遗漏必达约束。"],
        report_emphasis: ["case rule 必须清晰展示。"],
        dimension_summaries: [
          {
            name: "需求达成度",
            weight: 25,
            intent: "评价需求是否正确落地",
            item_summaries: [
              {
                name: "核心链路达成",
                weight: 10,
                scoring_bands: [{ score: 10, criteria: "核心链路完整。" }],
              },
            ],
          },
        ],
        hard_gates: [{ id: "G1", score_cap: 59 }],
        review_rule_summary: [],
      },
      deterministicRuleResults: [
        {
          rule_id: "HM-REQ-008-01",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "未使用 LoginWithHuaweiIDButton",
        },
      ],
      caseRuleDefinitions: [
        {
          pack_id: "case-requirement_004",
          rule_id: "HM-REQ-008-01",
          rule_name: "必须使用 LoginWithHuaweiIDButton",
          rule_source: "must_rule",
          summary: "登录页必须使用 LoginWithHuaweiIDButton",
          priority: "P0",
          detector_kind: "case_constraint",
          detector_config: {
            targetPatterns: ["**/pages/*.ets"],
            astSignals: [{ type: "call", name: "LoginWithHuaweiIDButton" }],
            llmPrompt: "检查登录按钮",
          },
          fallback_policy: "agent_assisted",
          is_case_rule: true,
        },
      ],
      scoreComputation: scoringResult.scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  assert.deepEqual(reportResult.resultJson?.case_rule_results, [
    {
      rule_id: "HM-REQ-008-01",
      rule_name: "必须使用 LoginWithHuaweiIDButton",
      priority: "P0",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "未使用 LoginWithHuaweiIDButton",
      hard_gate_triggered: true,
    },
  ]);
  assert.deepEqual(reportResult.resultJson?.bound_rule_packs, [
    {
      pack_id: "arkts-language",
      display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
    },
    {
      pack_id: "arkts-performance",
      display_name: "ArkTS 高性能编程实践",
    },
    {
      pack_id: "case-requirement_004",
      display_name: "用例 requirement_004 约束规则",
    },
  ]);
});

test("reportGenerationNode only returns schema-valid resultJson without html report", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const scoringResult = await scoreFusionOrchestrationNode({
    taskType: "bug_fix",
    staticRuleAuditResults: [],
    deterministicRuleResults: [],
    ruleViolations: [],
    constraintSummary: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/Index.ets"],
      hasPatch: true,
    },
  } as never);

  const reportResult = await reportGenerationNode(
    {
      taskType: "bug_fix",
      caseInput: {
        caseId: "case-1",
        promptText: "请修复餐厅列表页中的 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: {
        task_type: "bug_fix",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario:
          "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
        scoring_method: "discrete_band",
        scoring_note: "二级指标按离散档位给分。",
        common_risks: ["因顺手优化造成 diff 噪音和误修。"],
        report_emphasis: ["是否命中问题点。"],
        dimension_summaries: [
          {
            name: "改动精准度与最小侵入性",
            weight: 25,
            intent: "评价是否精准修复问题且控制改动范围",
            item_summaries: [
              {
                name: "问题点命中程度",
                weight: 10,
                scoring_bands: [{ score: 10, criteria: "修改直接命中根因或完整故障链路。" }],
              },
            ],
          },
        ],
        hard_gates: [{ id: "G4", score_cap: 59 }],
        review_rule_summary: ["关键分段分数需要人工复核"],
      },
      deterministicRuleResults: [],
      scoreComputation: scoringResult.scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  assert.ok(reportResult.resultJson);
  assert.equal(reportResult.htmlReport, undefined);
});

test("reportGenerationNode assigns matched bands for computed submetric scores", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-MUST-006",
      rule_source: "must_rule" as const,
      result: "不满足" as const,
      conclusion: "matched any",
    },
  ];
  const scoringResult = await scoreFusionOrchestrationNode({
    taskType: "bug_fix",
    deterministicRuleResults,
    ruleViolations: [],
    constraintSummary: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["bug_fix"],
    },
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
  } as never);

  const reportResult = await reportGenerationNode(
    {
      taskType: "bug_fix",
      caseInput: {
        caseId: "case-1",
        promptText: "请修复餐厅列表页中的 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: buildRubricSnapshot(rubric),
      deterministicRuleResults,
      scoreComputation: scoringResult.scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  const dimensionResults = Array.isArray(reportResult.resultJson?.dimension_results)
    ? reportResult.resultJson.dimension_results
    : [];
  for (const dimension of dimensionResults) {
    const itemResults =
      typeof dimension === "object" && dimension !== null && Array.isArray(dimension.item_results)
        ? dimension.item_results
        : [];
    for (const item of itemResults) {
      assert.notEqual(
        typeof item === "object" && item !== null ? item.matched_band : null,
        null,
        "expected every scored item to resolve a matched scoring band",
      );
    }
  }
});

test("reportGenerationNode emits agent evaluation and rule impact details for each scored item", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const reportResult = await reportGenerationNode(
    {
      taskType: "bug_fix",
      caseInput: {
        caseId: "case-1",
        promptText: "请修复餐厅列表页中的 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: {
        task_type: "bug_fix",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario: "修复餐厅列表问题",
        scoring_method: "discrete_band",
        scoring_note: "二级指标按离散档位给分。",
        common_risks: [],
        report_emphasis: [],
        dimension_summaries: [
          {
            name: "改动精准度与最小侵入性",
            weight: 25,
            intent: "评价是否精准修复问题且控制改动范围",
            item_summaries: [
              {
                name: "问题点命中程度",
                weight: 10,
                scoring_bands: [
                  { score: 10, criteria: "直接命中根因。" },
                  { score: 8, criteria: "基本命中问题点。" },
                ],
              },
            ],
          },
        ],
        hard_gates: [],
        review_rule_summary: [],
      },
      deterministicRuleResults: [
        {
          rule_id: "ARKTS-SHOULD-001",
          rule_source: "should_rule",
          result: "不满足",
          conclusion: "状态组织存在轻微风险。",
        },
      ],
      scoreComputation: {
        totalScore: 8,
        hardGateTriggered: false,
        hardGateReason: "",
        overallConclusion: {
          total_score: 8,
          hard_gate_triggered: false,
          summary: "已完成评分。",
        },
        dimensionScores: [
          {
            dimension_name: "改动精准度与最小侵入性",
            score: 8,
            max_score: 25,
            comment: "包含规则修正项。",
          },
        ],
        submetricDetails: [
          {
            dimension_name: "改动精准度与最小侵入性",
            metric_name: "问题点命中程度",
            score: 8,
            confidence: "medium",
            review_required: false,
            rationale: "rubric 基础分 10，规则修正 -2，最终 8。",
            evidence: "workspace/entry/src/main/ets/pages/Index.ets",
          },
        ],
        scoreFusionDetails: [
          {
            dimension_name: "改动精准度与最小侵入性",
            item_name: "问题点命中程度",
            agent_evaluation: {
              base_score: 10,
              matched_band_score: 10,
              matched_criteria: "直接命中根因。",
              logic: "rubric agent 认为修复直接命中根因。",
              evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets"],
              confidence: "medium",
            },
            rule_impacts: [
              {
                rule_id: "ARKTS-SHOULD-001",
                rule_source: "should_rule",
                result: "不满足",
                severity: "light",
                score_delta: -2,
                reason: "状态组织存在轻微风险。",
                evidence: "状态组织存在轻微风险。",
                agent_assisted: false,
                needs_human_review: false,
              },
            ],
            score_fusion: {
              base_score: 10,
              rule_delta: -2,
              final_score: 8,
              fusion_logic: "rubric 基础分 10，规则修正 -2，最终 8。",
            },
          },
        ],
        risks: [],
        humanReviewItems: [],
        strengths: [],
        mainIssues: [],
        finalRecommendation: [],
      },
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  const dimensionResults = reportResult.resultJson?.dimension_results as Array<
    Record<string, unknown>
  >;
  const firstDimension = dimensionResults[0];
  assert.ok(firstDimension.agent_evaluation_summary);
  assert.ok(firstDimension.rule_violation_summary);

  const firstItem = (firstDimension.item_results as Array<Record<string, unknown>>)[0];
  assert.ok(firstItem.agent_evaluation);
  assert.ok(firstItem.rule_impacts);
  assert.ok(firstItem.score_fusion);
  assert.equal("rationale" in firstItem, false);
  assert.equal("evidence" in firstItem, false);
});

test("artifactPostProcessNode generates layered html report from resultJson", async () => {
  const postProcessResult = await artifactPostProcessNode({
    resultJson: {
      basic_info: {
        task_type: "bug_fix",
      },
      overall_conclusion: {
        total_score: 97.6,
        hard_gate_triggered: false,
        summary: "整体质量较高，建议优先复核低置信度项。",
      },
      dimension_results: [
        {
          dimension_name: "改动精准度与最小侵入性",
          dimension_intent: "评价是否精准修复问题且控制改动范围",
          score: 22,
          max_score: 25,
          comment: "整体较好",
          item_results: [],
        },
      ],
      risks: [],
      strengths: ["命中主要问题点"],
      main_issues: ["存在 1 条待人工复核规则"],
      human_review_items: [],
      final_recommendation: ["优先复核低置信度指标"],
      rule_audit_results: [
        {
          rule_id: "ARKTS-MUST-005",
          rule_source: "must_rule",
          result: "不满足",
          conclusion: "检测到 any 类型使用。",
        },
      ],
      report_meta: {
        unit_name: "case-1",
        generated_at: "2026-04-17T04:00:00.000Z",
      },
    },
  } as never);

  assert.match(postProcessResult.htmlReport ?? "", /维度得分概览/);
  assert.match(postProcessResult.htmlReport ?? "", /待人工复核/);
  assert.match(postProcessResult.htmlReport ?? "", /规则审计结果/);
  assert.doesNotMatch(postProcessResult.htmlReport ?? "", /<pre>\s*\{/);
});

test("persistAndUploadNode writes deterministic rule audit artifacts and falls back merged output to deterministic results", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-MUST-005",
      rule_source: "must_rule",
      result: "不满足",
      conclusion: "检测到 any 类型使用。",
    },
  ];

  await persistAndUploadNode(
    {
      caseDir,
      caseInput: {
        caseId: "case-1",
        promptText: "请修复餐厅列表页中的 bug",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      rubricScoringPromptText: "",
      rubricScoringPayload: {},
      ruleAgentPromptText: "",
      ruleAgentBootstrapPayload: {},
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: {},
      deterministicRuleResults,
      assistedRuleCandidates: [],
      rubricAgentRunStatus: "not_enabled",
      ruleAgentRunStatus: "not_enabled",
      resultJson: { ok: true },
      htmlReport: "<html></html>",
    } as never,
    { artifactStore },
  );

  const storedRuleAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit.json"), "utf-8"),
  );
  const storedMergedAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit-merged.json"), "utf-8"),
  );

  assert.deepEqual(storedRuleAudit, deterministicRuleResults);
  assert.deepEqual(storedMergedAudit, deterministicRuleResults);
  await assert.rejects(fs.readFile(path.join(caseDir, "inputs", "original-prompt.txt"), "utf-8"));
  assert.equal(
    await fs.readFile(path.join(caseDir, "inputs", "rule-agent-prompt.txt"), "utf-8"),
    "",
  );
});

test("runScoreWorkflow writes artifacts and produces schema-valid result json", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  const resultJsonPath = path.join(caseDir, "outputs", "result.json");
  const reportHtmlPath = path.join(caseDir, "outputs", "report.html");
  const storedRuleAuditPath = path.join(caseDir, "intermediate", "rule-audit.json");
  const resultJson = JSON.parse(await fs.readFile(resultJsonPath, "utf-8"));
  const ruleAuditJson = JSON.parse(await fs.readFile(storedRuleAuditPath, "utf-8"));
  const reportHtml = await fs.readFile(reportHtmlPath, "utf-8");
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(schema);

  assert.equal(validate(resultJson), true, ajv.errorsText(validate.errors));
  assert.equal(result.uploadMessage, undefined);
  assert.equal(resultJson.basic_info.task_type, "bug_fix");
  assert.ok(resultJson.dimension_results.length > 0);
  assert.ok(resultJson.dimension_results[0].item_results.length > 0);
  assert.equal("submetric_details" in resultJson, false);
  assert.ok(resultJson.overall_conclusion.total_score <= 69);
  assert.ok(ruleAuditJson.length > 10);
  assert.ok(ruleAuditJson.some((item: { result: string }) => item.result === "不满足"));
  assert.match(reportHtml, /评分报告/);
  assert.match(reportHtml, /维度得分概览/);
  assert.match(reportHtml, /规则审计结果/);
  assert.doesNotMatch(reportHtml, /<pre>\s*\{/);
});

test("runScoreWorkflow includes case_rule_results and generated patch output", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    caseId: "requirement_004",
    promptText: "实现登录流程",
    withPatch: false,
    workspaceContent: "let x: number = 2;\n",
    originalContent: "let x: number = 1;\n",
    expectedConstraintsYaml: `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton
    description: 登录页必须使用 LoginWithHuaweiIDButton
    priority: P0
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: call
            name: LoginWithHuaweiIDButton
        llm: 检查登录按钮
`,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  const resultJson = result.resultJson as Record<string, unknown>;
  const generatedPatchText = await fs.readFile(
    path.join(caseDir, "intermediate", "generated.patch"),
    "utf-8",
  );

  assert.equal(Array.isArray(resultJson.case_rule_results), true);
  assert.deepEqual(resultJson.bound_rule_packs, [
    {
      pack_id: "arkts-language",
      display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
    },
    {
      pack_id: "arkts-performance",
      display_name: "ArkTS 高性能编程实践",
    },
    {
      pack_id: "case-case-1",
      display_name: "用例 case-1 约束规则",
    },
  ]);
  assert.match(generatedPatchText, /diff --git/);
});

test("runScoreWorkflow feeds generated patch into incremental scoring instead of reporting patch context missing", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    caseId: "bug_fix_generated_patch",
    promptText: "修复首页定位展示异常",
    withPatch: false,
    originalContent: "let count: number = 1;\n",
    workspaceContent: "let count: number = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
  });

  const resultJson = result.resultJson as {
    human_review_items?: Array<{ item?: string }>;
  };
  const generatedPatchPath = path.join(caseDir, "intermediate", "generated.patch");
  const generatedPatchText = await fs.readFile(generatedPatchPath, "utf-8");

  assert.match(generatedPatchText, /diff --git/);
  assert.equal(
    resultJson.human_review_items?.some((item) => item.item === "Patch 上下文缺失"),
    false,
  );
});

test("runScoreWorkflow emits Chinese descriptive text in result.json and report.html", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  const resultJson = JSON.parse(
    await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"),
  );
  const reportHtml = await fs.readFile(path.join(caseDir, "outputs", "report.html"), "utf-8");

  assert.equal(resultJson.basic_info.target_description, "HarmonyOS 生成工程评分");
  assert.match(resultJson.overall_conclusion.summary, /触发|未触发|评分/);
  assert.equal(
    resultJson.rule_audit_results.some((item: { conclusion: string }) =>
      /当前版本未接入对应判定器。|未发现该规则的命中证据。|检测到规则命中，文件：/.test(
        item.conclusion,
      ),
    ),
    true,
  );
  assert.match(reportHtml, /评分报告/);
  assert.doesNotMatch(reportHtml, /Score Report/);
});

test("runScoreWorkflow skips agent assistance when unsupported rules have no direct evidence", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);
  let invoked = false;
  const agentClient = {
    async completeJsonPrompt(): Promise<string> {
      invoked = true;
      return '{"action":"final_answer","summary":{"assistant_scope":"本次仅辅助候选规则判定","overall_confidence":"medium"},"rule_assessments":[]}';
    },
  };

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient,
  } as never);

  assert.equal(invoked, true);
  assert.equal(result.ruleAgentRunStatus, "not_enabled");
  assert.equal(Array.isArray(result.mergedRuleAuditResults), true);
  assert.equal(
    (result.mergedRuleAuditResults as Array<{ rule_id: string; result: string }>).some(
      (item) => item.rule_id === "ARKTS-SHOULD-002" && item.result === "不涉及",
    ),
    true,
  );
  assert.equal(result.ruleAgentAssessmentResult, undefined);
});

test("runScoreWorkflow persists skipped agent artifacts when unsupported rules have no direct evidence", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);
  let invoked = false;
  const agentClient = {
    async completeJsonPrompt(): Promise<string> {
      invoked = true;
      return "not-json";
    },
  };

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient,
  } as never);

  const ruleAgentPromptText = await fs.readFile(
    path.join(caseDir, "inputs", "rule-agent-prompt.txt"),
    "utf-8",
  );
  const agentPromptPayload = JSON.parse(
    await fs.readFile(path.join(caseDir, "inputs", "rule-agent-bootstrap-payload.json"), "utf-8"),
  );
  const mergedAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit-merged.json"), "utf-8"),
  );
  const agentResult = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-result.json"), "utf-8"),
  );

  assert.equal(invoked, true);
  assert.equal(result.ruleAgentRunStatus, "not_enabled");
  assert.match(ruleAgentPromptText, /当前判定上下文如下/);
  assert.doesNotMatch(ruleAgentPromptText, /你只能返回 tool_call 或 final_answer/);
  assert.equal(Array.isArray(agentPromptPayload.assisted_rule_candidates), true);
  assert.equal(agentPromptPayload.assisted_rule_candidates.length, 0);
  assert.equal(Array.isArray(agentPromptPayload.tool_contract.allowed_tools), true);
  assert.equal(Array.isArray(mergedAudit), true);
  assert.equal(agentResult.outcome, "not_enabled");
  await assert.rejects(
    fs.readFile(path.join(caseDir, "intermediate", "agent-assisted-rule-result.json"), "utf-8"),
  );
});

test("runScoreWorkflow invokes rubric scoring and rule assessment agents concurrently", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    caseId: "requirement_004",
    promptText: "实现登录流程",
    withPatch: false,
    workspaceContent: "let x: number = 2;\n",
    originalContent: "let x: number = 1;\n",
    expectedConstraintsYaml: `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton
    description: 登录页必须使用 LoginWithHuaweiIDButton
    priority: P0
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: call
            name: LoginWithHuaweiIDButton
        llm: 检查登录按钮
`,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const agentClient = {
    async completeJsonPrompt(prompt: string): Promise<string> {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await delay(40);
      activeCalls -= 1;
      if (prompt.includes("rubric 主评分 agent")) {
        return "{}";
      }
      return JSON.stringify({
        action: "final_answer",
        summary: {
          assistant_scope: "本次仅辅助候选规则判定",
          overall_confidence: "medium",
        },
        rule_assessments: [
          {
            rule_id: "HM-REQ-008-01",
            decision: "violation",
            confidence: "medium",
            reason: "未发现 LoginWithHuaweiIDButton 调用。",
            evidence_used: [],
            needs_human_review: false,
          },
        ],
      });
    },
  };

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient,
  } as never);

  assert.equal(maxActiveCalls, 2);
});

test("runScoreWorkflow persists case-aware runner turns, tool trace and lifecycle logs", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    caseId: "requirement_004",
    promptText: "实现登录流程",
    withPatch: false,
    workspaceContent: "let x: number = 2;\n",
    originalContent: "let x: number = 1;\n",
    expectedConstraintsYaml: `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton
    description: 登录页必须使用 LoginWithHuaweiIDButton
    priority: P0
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: call
            name: LoginWithHuaweiIDButton
        llm: 检查登录按钮
`,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);
  const outputs = [
    JSON.stringify({
      action: "tool_call",
      tool: "read_file",
      args: { path: "workspace/entry/src/main/ets/Index.ets" },
      reason: "需要确认是否存在登录按钮调用",
    }),
    JSON.stringify({
      action: "final_answer",
      summary: {
        assistant_scope: "本次仅辅助候选规则判定",
        overall_confidence: "medium",
      },
      rule_assessments: [
        {
          rule_id: "HM-REQ-008-01",
          decision: "not_applicable",
          confidence: "high",
          reason: "当前文件中未看到登录按钮实现，规则暂不涉及。",
          evidence_used: ["workspace/entry/src/main/ets/Index.ets"],
          needs_human_review: false,
        },
      ],
    }),
  ];
  const agentClient = {
    async completeJsonPrompt(prompt: string): Promise<string> {
      if (prompt.includes("rubric 主评分 agent")) {
        return "{}";
      }
      return outputs.shift() ?? "";
    },
  };

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient,
  } as never);

  const bootstrapPayload = JSON.parse(
    await fs.readFile(path.join(caseDir, "inputs", "rule-agent-bootstrap-payload.json"), "utf-8"),
  );
  const turns = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-turns.json"), "utf-8"),
  );
  const toolTrace = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-tool-trace.json"), "utf-8"),
  );
  const agentResult = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-result.json"), "utf-8"),
  );
  const runLog = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");

  assert.equal(result.ruleAgentRunStatus, "success");
  assert.equal(result.ruleAgentRunnerMode, "case_aware");
  assert.equal(bootstrapPayload.tool_contract.allowed_tools.includes("read_file"), true);
  assert.equal(Array.isArray(turns), true);
  assert.equal(turns.length, 2);
  assert.equal(Array.isArray(toolTrace), true);
  assert.equal(toolTrace.length, 1);
  assert.equal(agentResult.outcome, "success");
  assert.equal(agentResult.turns.length, 2);
  assert.equal(agentResult.tool_trace.length, 1);
  assert.match(runLog, /case-aware agent 判定开始/);
  assert.match(runLog, /case-aware 工具执行/);
  assert.match(runLog, /case-aware 判定完成/);
});

test("runScoreWorkflow preserves partial agent traces when provider fails after earlier turns", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    caseId: "requirement_004",
    promptText: "实现登录流程",
    withPatch: false,
    workspaceContent: "let x: number = 2;\n",
    originalContent: "let x: number = 1;\n",
    expectedConstraintsYaml: `constraints:
  - id: HM-REQ-008-01
    name: 必须使用 LoginWithHuaweiIDButton
    description: 登录页必须使用 LoginWithHuaweiIDButton
    priority: P0
    rules:
      - target: '**/pages/*.ets'
        ast:
          - type: call
            name: LoginWithHuaweiIDButton
        llm: 检查登录按钮
`,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);
  let callCount = 0;
  const agentClient = {
    async completeJsonPrompt(prompt: string): Promise<string> {
      if (prompt.includes("rubric 主评分 agent")) {
        return "{}";
      }
      callCount += 1;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool_call",
          tool: "read_file",
          args: { path: "workspace/entry/src/main/ets/Index.ets" },
          reason: "需要确认是否存在登录按钮调用",
        });
      }
      throw new Error("fetch failed");
    },
  };

  const result = await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient,
  } as never);

  const turns = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-turns.json"), "utf-8"),
  );
  const toolTrace = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-tool-trace.json"), "utf-8"),
  );
  const agentResult = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-agent-result.json"), "utf-8"),
  );
  const runLog = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");

  assert.equal(result.ruleAgentRunStatus, "invalid_output");
  assert.equal(Array.isArray(turns), true);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.action, "tool_call");
  assert.equal(Array.isArray(toolTrace), true);
  assert.equal(toolTrace.length, 1);
  assert.equal(agentResult.outcome, "request_failed");
  assert.equal(agentResult.turns.length, 1);
  assert.equal(agentResult.tool_trace.length, 1);
  assert.match(agentResult.failure_reason, /fetch failed/);
  assert.match(runLog, /case-aware 工具执行/);
  assert.match(runLog, /case-aware 模型调用失败/);
});

test("runScoreWorkflow streams node lifecycle logs into run.log", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  const logText = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");

  assert.match(logText, /\[任务理解taskUnderstandingNode\] 节点开始/);
  assert.match(logText, /\[规则审计ruleAuditNode\] 节点开始/);
  assert.match(logText, /\[Rubric Agent 评分rubricScoringAgentNode\] 节点开始/);
  assert.match(logText, /\[规则 Agent 判定ruleAssessmentAgentNode\] 节点开始/);
  assert.match(logText, /\[评分融合scoreFusionOrchestrationNode\] 节点开始/);
  assert.match(logText, /\[产物后处理artifactPostProcessNode\] 节点开始/);
  assert.match(logText, /\[结果落盘persistAndUploadNode\] 节点开始/);
  assert.doesNotMatch(logText, /featureExtractionNode/);
  assert.match(
    logText,
    /\[任务分类inputClassificationNode\] 节点完成 summary=taskType=bug_fix/,
  );
  assert.match(
    logText,
    /\[评分融合scoreFusionOrchestrationNode\] 节点完成 summary=totalScore=/,
  );
  assert.match(
    logText,
    /\[产物后处理artifactPostProcessNode\] 节点完成 summary=htmlLength=/,
  );
});

test("runScoreWorkflow writes warning logs when agent assistance is skipped", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  const logText = await fs.readFile(path.join(caseDir, "logs", "run.log"), "utf-8");

  assert.match(logText, /\[WARN\] rule agent 判定跳过 reason=无候选规则/);
  assert.doesNotMatch(logText, /\[INFO\] rule agent 判定跳过 reason=无候选规则/);
});

test("runScoreWorkflow keeps 未接入判定器 inside static layer only", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  const mergedAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit-merged.json"), "utf-8"),
  );

  assert.equal(
    mergedAudit.some((item: { result: string }) => item.result === "未接入判定器"),
    false,
  );
});

test("runScoreWorkflow keeps unsupported rules without direct evidence out of agent candidates", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  const agentPromptPayload = JSON.parse(
    await fs.readFile(path.join(caseDir, "inputs", "rule-agent-bootstrap-payload.json"), "utf-8"),
  );

  assert.deepEqual(agentPromptPayload.assisted_rule_candidates, []);
  assert.equal(agentPromptPayload.tool_contract.allowed_tools.includes("read_file"), true);
});

test("runScoreWorkflow does not send unsupported should rules without direct evidence to agent review", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const caseRootDir = await makeTempDir(t);
  const fixtureCaseDir = await writeCaseFixture(caseRootDir, {
    promptText: "请修复餐厅列表页中的 bug",
    withPatch: true,
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(fixtureCaseDir);

  await runScoreWorkflow({
    caseInput: { ...caseInput, caseId: "case-1" },
    caseDir,
    referenceRoot,
    artifactStore,
    agentClient: undefined,
  });

  const resultJson = JSON.parse(
    await fs.readFile(path.join(caseDir, "outputs", "result.json"), "utf-8"),
  );

  assert.equal(
    resultJson.rule_audit_results.some(
      (item: { rule_source: string; result: string }) =>
        item.rule_source === "should_rule" && item.result === "待人工复核",
    ),
    false,
  );
});
