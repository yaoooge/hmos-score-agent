import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildRubricSnapshot } from "../src/agents/normalization/ruleAssistance.js";
import { ArtifactStore } from "../src/commons/io/artifactStore.js";
import { pruneCompletedCaseArtifacts } from "../src/commons/io/caseArtifactCleanup.js";
import { loadCaseFromPath } from "../src/commons/io/caseLoader.js";
import { persistAndUploadNode } from "../src/workflow/nodes/persistAndUpload/index.js";
import { reportGenerationNode } from "../src/workflow/nodes/reportGeneration/index.js";
import { rubricPreparationNode } from "../src/workflow/nodes/rubricPreparation/index.js";
import { rubricScoringAgentNode } from "../src/workflow/nodes/rubricScoringAgent/index.js";
import { ruleAssessmentAgentNode } from "../src/workflow/nodes/ruleAssessmentAgent/index.js";
import { ruleMergeNode } from "../src/workflow/nodes/ruleMerge/index.js";
import { rulePreparationNode } from "../src/workflow/nodes/rulePreparation/index.js";
import { scoreFusionOrchestrationNode } from "../src/workflow/nodes/scoreFusionOrchestration/index.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import type { CaseInput } from "../src/types.js";

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

function buildOpencodeRubricFinalAnswer(
  rubricSnapshot: ReturnType<typeof buildRubricSnapshot>,
): Record<string, unknown> {
  return {
    summary: {
      overall_assessment: "未发现足够负面证据，按满分保留。",
      overall_confidence: "medium",
    },
    item_scores: rubricSnapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => ({
        dimension_name: dimension.name,
        item_name: item.name,
        score: item.scoring_bands[0].score,
        max_score: item.weight,
        matched_band_score: item.scoring_bands[0].score,
        rationale: "未发现足够负面证据，按满分保留。",
        evidence_used: [],
        confidence: "medium",
        review_required: false,
      })),
    ),
    hard_gate_candidates: [],
    risks: [],
    strengths: ["结构清晰"],
    main_issues: [],
  };
}

function notInvolvedCrossDevice() {
  return {
    applicability: "not_involved",
    confidence: "high",
    reasons: ["需求未出现多设备、多屏或设备形态适配要求"],
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

test("explicit rubric and rule agent nodes are exported", () => {
  assert.equal(typeof rubricPreparationNode, "function");
  assert.equal(typeof rubricScoringAgentNode, "function");
  assert.equal(typeof rulePreparationNode, "function");
  assert.equal(typeof ruleAssessmentAgentNode, "function");
});

test("rubricPreparationNode builds rubric snapshot and opencode scoring payload", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const result = await rubricPreparationNode(
    {
      caseInput: makeState({
        promptText: "请修复餐厅列表页中的 bug",
        patchPath: "/tmp/changes.patch",
      }).caseInput,
      sourceCasePath: "/tmp/case-1",
      effectivePatchPath: "/tmp/changes.patch",
      taskType: "bug_fix",
      taskUnderstanding: {
        explicitConstraints: ["修复餐厅列表页 bug"],
        contextualConstraints: ["保持 ArkTS 工程结构"],
        implicitConstraints: ["存在 patch"],
        classificationHints: ["bug_fix"],
      },
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 1,
        changedFileCount: 2,
        changedFiles: [
          "entry/src/main/ets/pages/Index.ets",
          "entry/src/main/ets/components/Card.ets",
        ],
        hasPatch: true,
      },
    } as never,
    { referenceRoot, logger: undefined },
  );

  assert.equal(result.rubricSnapshot?.task_type, "bug_fix");
  assert.equal(result.rubricScoringPayload?.case_context.task_type, "bug_fix");
  assert.equal("initial_target_files" in (result.rubricScoringPayload ?? {}), false);
  assert.equal("rubricScoringPromptText" in result, false);
  assert.equal(result.rubricScoringPayload?.response_contract.output_language, "zh-CN");
});

test("rubricPreparationNode adds workspace directory summary when changed files are broad", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const changedFiles = Array.from(
    { length: 21 },
    (_, index) => `entry/src/main/ets/pages/Page${index}.ets`,
  );

  const result = await rubricPreparationNode(
    {
      caseInput: makeState({
        promptText: "请修复页面问题",
        patchPath: "/tmp/changes.patch",
      }).caseInput,
      sourceCasePath: "/tmp/case-1",
      effectivePatchPath: "/tmp/case-1/intermediate/effective.patch",
      taskType: "bug_fix",
      taskUnderstanding: {
        explicitConstraints: ["修复页面问题"],
        contextualConstraints: ["保持 ArkTS 工程结构"],
        implicitConstraints: ["存在 patch"],
        classificationHints: ["bug_fix"],
      },
      evidenceSummary: {
        workspaceFileCount: 21,
        originalFileCount: 21,
        changedFileCount: 21,
        changedFiles,
        hasPatch: true,
      },
      workspaceProjectStructure: {
        rootPath: "/tmp/case-1/workspace",
        topLevelEntries: ["AppScope", "entry"],
        modulePaths: ["entry"],
        implementationHints: ["HarmonyOS 模块: entry"],
        omittedFileCount: 5,
      },
    } as never,
    { referenceRoot, logger: undefined },
  );

  assert.equal(result.rubricScoringPayload?.workspace_project_structure?.modulePaths[0], "entry");
  assert.match(
    result.rubricScoringPayload?.workspace_project_structure_note ?? "",
    /当前 changedFiles 共 21 个。请先优先检查 effective_patch_path/,
  );
  assert.equal("rubricScoringPromptText" in result, false);
});

test("rubricScoringAgentNode fails when opencode runtime is missing", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const caseRoot = await makeTempDir(t);

  await assert.rejects(
    () =>
      rubricScoringAgentNode(
        {
          rubricScoringPayload: {
            case_context: {
              case_id: "case-1",
              case_root: caseRoot,
              task_type: "bug_fix",
              original_prompt_summary: "修复页面 bug",
              original_project_path: path.join(caseRoot, "original"),
              generated_project_path: path.join(caseRoot, "workspace"),
            },
            task_understanding: {
              explicitConstraints: ["修复页面 bug"],
              contextualConstraints: ["保持工程结构"],
              implicitConstraints: [],
              classificationHints: ["bug_fix"],
            },
            rubric_summary: rubricSnapshot,
            response_contract: {
              output_language: "zh-CN",
              json_only: true,
            },
          },
        } as never,
        { logger: undefined },
      ),
    /rubric agent 调用失败，请重新执行用例/,
  );
});

test("rubricScoringAgentNode runs opencode rubric scoring", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const caseRoot = await makeTempDir(t);
  const calls: string[] = [];

  const result = await rubricScoringAgentNode(
    {
      caseInput: makeState({
        originalProjectPath: path.join(caseRoot, "original"),
        generatedProjectPath: path.join(caseRoot, "workspace"),
      }).caseInput,
      sourceCasePath: caseRoot,
      rubricScoringPayload: {
        case_context: {
          case_id: "case-1",
          case_root: caseRoot,
          task_type: "bug_fix",
          original_prompt_summary: "修复页面 bug",
          original_project_path: path.join(caseRoot, "original"),
          generated_project_path: path.join(caseRoot, "workspace"),
        },
        task_understanding: {
          explicitConstraints: ["修复页面 bug"],
          contextualConstraints: ["保持工程结构"],
          implicitConstraints: [],
          classificationHints: ["bug_fix"],
        },
        rubric_summary: rubricSnapshot,
        response_contract: {
          output_language: "zh-CN",
          json_only: true,
        },
      },
      rubricSnapshot,
    } as never,
    {
      opencode: {
        sandboxRoot: caseRoot,
        async runPrompt(request) {
          calls.push(request.requestTag);
          return {
            requestTag: request.requestTag,
            rawEvents: "{}\n",
            rawText: JSON.stringify(buildOpencodeRubricFinalAnswer(rubricSnapshot)),
            elapsedMs: 1,
          };
        },
      },
      logger: {
        async info() {},
        async warn() {},
        async error() {},
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? "", /^rubric-scoring-case-1-/);
  assert.equal(result.rubricAgentRunStatus, "success");
  assert.equal(result.rubricAgentRunnerMode, "opencode");
  assert.equal(
    result.rubricScoringResult?.item_scores.length,
    rubricSnapshot.dimension_summaries.flatMap((dimension) => dimension.item_summaries).length,
  );
  assert.equal(result.rubricAgentRunnerResult?.outcome, "success");
});
test("rubricScoringAgentNode fails when opencode final answer is incomplete", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const caseRoot = await makeTempDir(t);
  const finalAnswer = buildOpencodeRubricFinalAnswer(rubricSnapshot) as {
    item_scores: unknown[];
  };
  finalAnswer.item_scores = finalAnswer.item_scores.slice(1);

  await assert.rejects(
    () =>
      rubricScoringAgentNode(
        {
          caseInput: makeState({
            originalProjectPath: path.join(caseRoot, "original"),
            generatedProjectPath: path.join(caseRoot, "workspace"),
          }).caseInput,
          sourceCasePath: caseRoot,
          rubricScoringPayload: {
            case_context: {
              case_id: "case-1",
              case_root: caseRoot,
              task_type: "bug_fix",
              original_prompt_summary: "修复页面 bug",
              original_project_path: path.join(caseRoot, "original"),
              generated_project_path: path.join(caseRoot, "workspace"),
            },
            task_understanding: {
              explicitConstraints: ["修复页面 bug"],
              contextualConstraints: ["保持工程结构"],
              implicitConstraints: [],
              classificationHints: ["bug_fix"],
            },
            rubric_summary: rubricSnapshot,
            response_contract: {
              output_language: "zh-CN",
              json_only: true,
            },
          },
          rubricSnapshot,
        } as never,
        {
          opencode: {
            sandboxRoot: caseRoot,
            async runPrompt(request) {
              return {
                requestTag: request.requestTag,
                rawEvents: "",
                rawText: JSON.stringify(finalAnswer),
                elapsedMs: 1,
              };
            },
          },
          logger: {
            async info() {},
            async warn() {},
            async error() {},
          },
        },
      ),
    /rubric agent 调用失败，请重新执行用例/,
  );
});
test("rulePreparationNode emits one ledger item per rule and preserves source ordering", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await rulePreparationNode(
    {
      caseInput,
      taskType: "full_generation",
      taskUnderstanding: {
        explicitConstraints: ["固定任务类型: full_generation"],
        contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
        implicitConstraints: ["修改范围: 未提供 patch"],
        classificationHints: ["full_generation", "no_patch"],
        crossDeviceAdaptation: notInvolvedCrossDevice(),
      },
    } as never,
    { referenceRoot, logger: undefined },
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
      (item) => item.rule_id === "ARKTS-FORBID-004" && item.result === "不满足",
    ),
    true,
  );
  assert.equal(
    result.deterministicRuleResults?.some(
      (item) => item.rule_id === "ARKTS-FORBID-005" && item.result === "不满足",
    ),
    true,
  );
});

test("rulePreparationNode exposes static results and agent candidates separately", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await rulePreparationNode(
    {
      caseInput,
      taskType: "full_generation",
      taskUnderstanding: {
        explicitConstraints: ["固定任务类型: full_generation"],
        contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
        implicitConstraints: ["修改范围: 未提供 patch"],
        classificationHints: ["full_generation", "no_patch"],
        crossDeviceAdaptation: notInvolvedCrossDevice(),
      },
    } as never,
    { referenceRoot, logger: undefined },
  );

  assert.equal(Array.isArray(result.staticRuleAuditResults), true);
  assert.equal(Array.isArray(result.deterministicRuleResults), true);
  assert.equal(Array.isArray(result.assistedRuleCandidates), true);
  assert.equal((result.assistedRuleCandidates?.length ?? 0) > 0, true);
  assert.equal(
    result.staticRuleAuditResults?.some(
      (item) => item.rule_id === "ARKTS-MUST-003" && item.result === "未接入判定器",
    ),
    true,
  );
});

test("rulePreparationNode excludes cross-device rules when task is not cross-device related", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    workspaceContent: "let x: any = 1;\nvar y = 2;\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await rulePreparationNode(
    {
      caseInput,
      taskType: "full_generation",
      taskUnderstanding: {
        explicitConstraints: ["固定任务类型: full_generation"],
        contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
        implicitConstraints: ["修改范围: 未提供 patch"],
        classificationHints: ["full_generation", "no_patch"],
        crossDeviceAdaptation: notInvolvedCrossDevice(),
      },
    } as never,
    { referenceRoot, logger: undefined },
  );

  assert.equal(
    result.staticRuleAuditResults?.some((item) => item.rule_id === "OM-BREAKPOINT-MUST-01"),
    false,
  );
  assert.deepEqual(result.enabledRulePacks, [
    {
      pack_id: "arkts-language",
      display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
      version: "v1.0.0",
    },
    {
      pack_id: "arkts-performance",
      display_name: "ArkTS 高性能编程实践",
      version: "v1.0.0",
    },
    {
      pack_id: "arkui-extra",
      display_name: "ArkUI 补充工程规则",
      version: "v1.0.0",
    },
  ]);
});

test("rulePreparationNode enables cross-device rules and preserves assisted candidate metadata", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rootDir = await makeTempDir(t);
  const caseDir = await writeCaseFixture(rootDir, {
    promptText: "实现一多适配响应式布局，按断点适配手机和平板",
    workspaceContent:
      "GridRow({ breakpoints: { value: ['320vp','600vp','840vp','1440vp'] } }) {}\n",
  });
  const caseInput = await loadCaseFromPath(caseDir);

  const result = await rulePreparationNode(
    {
      caseInput,
      taskType: "full_generation",
      taskUnderstanding: {
        explicitConstraints: ["固定任务类型: full_generation", "实现一多适配响应式布局"],
        contextualConstraints: ["技术栈: ArkTS/ETS 页面与组件实现"],
        implicitConstraints: ["修改范围: 未提供 patch"],
        classificationHints: ["full_generation", "no_patch"],
        crossDeviceAdaptation: {
          applicability: "involved",
          confidence: "high",
          reasons: ["需求明确要求一多适配和断点布局"],
        },
      },
    } as never,
    { referenceRoot, logger: undefined },
  );

  assert.equal(
    result.staticRuleAuditResults?.some((item) => item.rule_id === "OM-BREAKPOINT-MUST-01"),
    true,
  );
  assert.equal(
    result.enabledRulePacks?.some((pack) => pack.pack_id === "cross-device-adaptation"),
    true,
  );

  const candidate = result.assistedRuleCandidates?.find(
    (item) => item.rule_id === "OM-BREAKPOINT-MUST-03",
  );
  assert.ok(candidate);
  assert.equal(candidate.rule_source, "must_rule");
  assert.equal(candidate.rule_name, "断点值分发工具类必须覆盖 sm/md/lg/xl 四个断点");
  assert.equal(candidate.priority, "P0");
  assert.deepEqual(candidate.kit, ["ArkUI: WidthBreakpoint"]);
  assert.equal(candidate.is_case_rule, undefined);
  assert.match(candidate.llm_prompt ?? "", /请基于静态证据复核/);
  assert.deepEqual(candidate.target_checks, [
    {
      target: "**/*.ets",
      ast_signals: [],
      llm_prompt:
        "断点值分发工具类必须覆盖 sm/md/lg/xl 四个断点。请基于静态证据复核是否满足该约束。",
    },
  ]);
});

test("ruleMergeNode returns deterministic results directly when there are no assisted candidates", async () => {
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-FORBID-001",
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

test("ruleMergeNode merges official linter rule results with deterministic results", async () => {
  const result = await ruleMergeNode(
    {
      deterministicRuleResults: [
        {
          rule_id: "ARKTS-SHOULD-001",
          rule_source: "should_rule",
          result: "不满足",
          conclusion: "internal",
        },
      ],
      officialLinterRuleResults: [
        {
          rule_id: "OFFICIAL-LINTER:@performance/foreach-args-check",
          rule_source: "should_rule",
          result: "不满足",
          conclusion: "official",
        },
      ],
      assistedRuleCandidates: [],
    } as never,
    {},
  );

  assert.deepEqual(
    result.mergedRuleAuditResults?.map((item) => item.rule_id),
    ["ARKTS-SHOULD-001", "OFFICIAL-LINTER:@performance/foreach-args-check"],
  );
});

test("ruleMergeNode preserves structured agent judgments from canonical runner result", async () => {
  const result = await ruleMergeNode(
    {
      deterministicRuleResults: [
        {
          rule_id: "ARKTS-FORBID-001",
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

test("ruleAssessmentAgentNode fails when opencode runtime is missing for agent candidates", async () => {
  await assert.rejects(
    () =>
      ruleAssessmentAgentNode(
        {
          assistedRuleCandidates: [
            {
              rule_id: "ARKTS-SHOULD-001",
              rule_source: "should_rule",
              why_uncertain: "需要结合上下文判定。",
              local_preliminary_signal: "unknown",
              evidence_files: [],
              evidence_snippets: [],
            },
          ],
        } as never,
        { logger: undefined },
      ),
    /rule agent 调用失败，请重新执行用例/,
  );
});

test("scoring and report nodes fall back to deterministic results when merge output is absent", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const staticRuleAuditResults = [
    {
      rule_id: "ARKTS-MUST-001",
      rule_source: "must_rule",
      result: "未接入判定器",
      conclusion: "该规则仍需 agent 辅助判定。",
    },
  ];
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-FORBID-004",
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
      detail.rule_impacts.some((impact) => impact.rule_id === "ARKTS-FORBID-004"),
    ),
    true,
  );

  assert.deepEqual(
    scoringResult.scoreComputation?.risks.map((risk) => risk.id),
    [1],
  );
  assert.deepEqual(
    scoringResult.scoreComputation?.humanReviewItems.map((item) => item.id),
    [1, 2],
  );
  assert.equal(scoringResult.scoreComputation?.humanReviewItems[1]?.item, "硬门槛复核");

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
      version: "1.0.0",
      rule_set: "arkts-language@1.0.0",
    },
    {
      pack_id: "arkts-performance",
      display_name: "ArkTS 高性能编程实践",
      version: "1.0.0",
      rule_set: "arkts-performance@1.0.0",
    },
    {
      pack_id: "arkui-extra",
      display_name: "ArkUI 补充工程规则",
      version: "1.0.0",
      rule_set: "arkui-extra@1.0.0",
    },
    {
      pack_id: "case-requirement_004",
      display_name: "用例 requirement_004 约束规则",
    },
  ]);
});

test("reportGenerationNode includes cross-device pack only as enabled built-in pack", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const scoringResult = await scoreFusionOrchestrationNode({
    taskType: "full_generation",
    rubricSnapshot: {
      task_type: "full_generation",
      evaluation_mode: "auto_precheck_with_human_review",
      scenario: "生成响应式页面",
      scoring_method: "discrete_band",
      scoring_note: "按离散档位给分。",
      common_risks: [],
      report_emphasis: [],
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
      hard_gates: [],
      review_rule_summary: [],
    },
    deterministicRuleResults: [
      {
        rule_id: "OM-BREAKPOINT-MUST-01",
        rule_source: "must_rule",
        result: "满足",
        conclusion: "断点符合系统推荐值",
      },
    ],
    mergedRuleAuditResults: [
      {
        rule_id: "OM-BREAKPOINT-MUST-01",
        rule_source: "must_rule",
        result: "满足",
        conclusion: "断点符合系统推荐值",
      },
    ],
    ruleViolations: [],
    constraintSummary: {
      explicitConstraints: ["实现一多适配响应式布局"],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["full_generation"],
      crossDeviceAdaptation: {
        applicability: "involved",
        confidence: "high",
        reasons: ["需求明确要求一多适配"],
      },
    },
    evidenceSummary: {
      workspaceFileCount: 1,
      originalFileCount: 1,
      changedFileCount: 1,
      changedFiles: ["entry/src/main/ets/pages/Index.ets"],
      hasPatch: true,
    },
    caseRuleDefinitions: [],
  } as never);

  const reportResult = await reportGenerationNode(
    {
      taskType: "full_generation",
      caseInput: {
        caseId: "case-cross-device",
        promptText: "实现一多适配响应式布局",
        originalProjectPath: "/tmp/original",
        generatedProjectPath: "/tmp/workspace",
      },
      constraintSummary: {
        explicitConstraints: ["实现一多适配响应式布局"],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["full_generation"],
        crossDeviceAdaptation: {
          applicability: "involved",
          confidence: "high",
          reasons: ["需求明确要求一多适配"],
        },
      },
      enabledRulePacks: [
        {
          pack_id: "arkts-language",
          display_name: "从 TypeScript 到 ArkTS 的适配规则与 ArkTS 编程规范",
        },
        {
          pack_id: "arkts-performance",
          display_name: "ArkTS 高性能编程实践",
        },
        {
          pack_id: "cross-device-adaptation",
          display_name: "HarmonyOS 一多适配通用规则",
        },
      ],
      rubricSnapshot: {
        task_type: "full_generation",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario: "生成响应式页面",
        scoring_method: "discrete_band",
        scoring_note: "按离散档位给分。",
        common_risks: [],
        report_emphasis: [],
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
        hard_gates: [],
        review_rule_summary: [],
      },
      mergedRuleAuditResults: [
        {
          rule_id: "OM-BREAKPOINT-MUST-01",
          rule_source: "must_rule",
          result: "满足",
          conclusion: "断点符合系统推荐值",
        },
      ],
      caseRuleDefinitions: [],
      scoreComputation: scoringResult.scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

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
      pack_id: "cross-device-adaptation",
      display_name: "HarmonyOS 一多适配通用规则",
    },
  ]);
  assert.deepEqual(reportResult.resultJson?.case_rule_results, []);
});

test("reportGenerationNode stores official linter findings on rule_audit_results", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const reportResult = await reportGenerationNode(
    {
      taskType: "full_generation",
      caseInput: {
        caseId: "case-1",
        promptText: "实现首页",
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
        scenario: "生成首页",
        scoring_method: "discrete_band",
        scoring_note: "按离散档位给分。",
        common_risks: [],
        report_emphasis: [],
        dimension_summaries: [],
        hard_gates: [],
        review_rule_summary: [],
      },
      deterministicRuleResults: [],
      mergedRuleAuditResults: [
        {
          rule_id: "OFFICIAL-LINTER:@security/no-commented-code",
          rule_summary: "官方 Code Linter：@security/no-commented-code",
          rule_source: "forbidden_pattern",
          result: "不满足",
          conclusion: "官方 Code Linter @security/no-commented-code 命中 1 处。",
          official_linter_severity: "warn",
        },
      ],
      officialLinterSummary: {
        configuredRuleSets: ["plugin:@security/recommended"],
        effectiveFindingCount: 1,
        runStatus: "success",
        durationMs: 50,
      },
      officialLinterFindings: [
        {
          rule_id: "@security/no-commented-code",
          message: "Delete the related code completely when it is invalid.",
          severity: "warn",
          file: "entry/src/main/ets/components/HomeTab.ets",
          line: 58,
          column: 27,
          source_rule_set: "plugin:@security/recommended",
        },
      ],
      scoreComputation: {
        overallConclusion: {
          total_score: 98.8,
          hard_gate_triggered: false,
          summary: "官方 linter 发现安全规范问题。",
        },
        dimensionScores: [],
        submetricDetails: [],
        scoreFusionDetails: [
          {
            dimension_name: "代码质量",
            item_name: "安全与规范",
            agent_evaluation: {
              base_score: 10,
              matched_band_score: 10,
              matched_criteria: "",
              logic: "",
              evidence_used: [],
              confidence: "medium",
              deduction_trace: null,
            },
            rule_impacts: [
              {
                rule_id: "OFFICIAL-LINTER:@security/no-commented-code",
                rule_source: "forbidden_pattern",
                result: "不满足",
                severity: "light",
                score_delta: -1.2,
                agent_assisted: false,
                needs_human_review: false,
              },
            ],
            score_fusion: {
              base_score: 10,
              rule_delta: -1.2,
              final_score: 8.8,
              fusion_logic: "官方 linter 规则轻扣 1.2 分。",
            },
          },
        ],
        risks: [],
        strengths: [],
        mainIssues: [],
        humanReviewItems: [],
        finalRecommendation: [],
      },
      ruleViolations: [],
      caseRuleDefinitions: [],
    } as never,
    { referenceRoot },
  );

  assert.equal(
    "official_linter_severity" in
      ((reportResult.resultJson?.rule_audit_results as Array<Record<string, unknown>>)[0] ?? {}),
    false,
  );
  assert.equal("official_linter_results" in (reportResult.resultJson ?? {}), false);
  assert.deepEqual(reportResult.resultJson?.rule_audit_results, [
    {
      rule_id: "OFFICIAL-LINTER:@security/no-commented-code",
      rule_summary: "官方 Code Linter：@security/no-commented-code",
      rule_source: "forbidden_pattern",
      result: "不满足",
      conclusion: "官方 Code Linter @security/no-commented-code 命中 1 处。",
      finding_count: 1,
      findings: [
        {
          file: "entry/src/main/ets/components/HomeTab.ets",
          line: 58,
          column: 27,
          severity: "warn",
          message: "Delete the related code completely when it is invalid.",
        },
      ],
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
      hvigorBuildCheckSummary: {
        enabled: true,
        status: "failed",
        buildCheckSource: "remote",
        checkedModules: ["remote"],
        moduleResults: [
          {
            modulePath: ".",
            moduleName: "remote",
            command: "assembleApp",
            status: "failed",
            durationMs: 0,
            diagnostics: "远端平台构建失败。",
          },
        ],
        hardGateTriggered: true,
        scoreCap: 59,
        diagnostics: "远端平台构建失败，已跳过本地 hvigor 编译复验。",
        durationMs: 0,
        cleanup: {
          attempted: false,
          removedPaths: [],
          failedPaths: [],
        },
      },
    } as never,
    { referenceRoot },
  );

  assert.ok(reportResult.resultJson);
  assert.equal(
    (reportResult.resultJson.build_check_summary as Record<string, unknown>).build_check_source,
    "remote",
  );
  assert.equal(reportResult.htmlReport, undefined);
});

test("reportGenerationNode assigns matched bands for computed submetric scores", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-FORBID-005",
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
              deduction_trace: null,
              confidence: "medium",
            },
            rule_impacts: [
              {
                rule_id: "ARKTS-SHOULD-001",
                rule_source: "should_rule",
                result: "不满足",
                severity: "light",
                score_delta: -2,
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
  assert.equal(
    "reason" in ((firstItem.rule_impacts as Array<Record<string, unknown>>)[0] ?? {}),
    false,
  );
});

test("reportGenerationNode writes deduction_trace for deducted rubric items only", async (t) => {
  const referenceRoot = await createReferenceRoot(t);
  const rubric = await loadRubricForTaskType("bug_fix", referenceRoot);
  const rubricSnapshot = buildRubricSnapshot(rubric);
  const firstDimension = rubricSnapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];
  const deductedBand = firstItem.scoring_bands[1];
  assert.ok(deductedBand);

  const scoreFusionDetails = rubricSnapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => ({
      dimension_name: dimension.name,
      item_name: item.name,
      agent_evaluation: {
        base_score:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? deductedBand.score
            : item.scoring_bands[0].score,
        matched_band_score:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? deductedBand.score
            : item.scoring_bands[0].score,
        matched_criteria: "评分档位说明",
        logic: "评分理由",
        evidence_used: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
        confidence: "medium" as const,
        deduction_trace:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? {
                code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
                impact_scope: "影响页面初始化稳定性",
                rubric_comparison: "未命中高分档；命中当前档。",
                deduction_reason: "存在空值未防御。",
                improvement_suggestion: "在访问前增加空值校验并补充异常路径处理。",
              }
            : null,
      },
      rule_impacts: [],
      score_fusion: {
        base_score: item.scoring_bands[0].score,
        rule_delta: 0,
        final_score:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? deductedBand.score
            : item.scoring_bands[0].score,
        fusion_logic: "无规则修正",
      },
    })),
  );

  const scoreComputation = {
    totalScore: scoreFusionDetails.reduce(
      (sum, detail) => sum + detail.score_fusion.final_score,
      0,
    ),
    hardGateTriggered: false,
    hardGateReason: "",
    overallConclusion: {
      total_score: scoreFusionDetails.reduce(
        (sum, detail) => sum + detail.score_fusion.final_score,
        0,
      ),
      hard_gate_triggered: false,
      summary: "已完成评分。",
    },
    dimensionScores: rubricSnapshot.dimension_summaries.map((dimension) => ({
      dimension_name: dimension.name,
      score: scoreFusionDetails
        .filter((detail) => detail.dimension_name === dimension.name)
        .reduce((sum, detail) => sum + detail.score_fusion.final_score, 0),
      max_score: dimension.weight,
      comment: "测试数据",
    })),
    submetricDetails: scoreFusionDetails.map((detail) => ({
      dimension_name: detail.dimension_name,
      metric_name: detail.item_name,
      score: detail.score_fusion.final_score,
      confidence: detail.agent_evaluation.confidence,
      review_required: false,
      rationale: detail.score_fusion.fusion_logic,
      evidence: detail.agent_evaluation.evidence_used.join(" "),
    })),
    scoreFusionDetails,
    risks: [],
    humanReviewItems: [],
    strengths: [],
    mainIssues: [],
    finalRecommendation: [],
  };

  const result = await reportGenerationNode(
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
      rubricSnapshot,
      deterministicRuleResults: [],
      scoreComputation,
      ruleViolations: [],
    } as never,
    { referenceRoot },
  );

  const dimensionResults = result.resultJson?.dimension_results as Array<Record<string, unknown>>;
  const deductedDimension = dimensionResults.find(
    (dimension) => dimension.dimension_name === firstDimension.name,
  );
  const deductedItem = (deductedDimension?.item_results as Array<Record<string, unknown>>).find(
    (item) => item.item_name === firstItem.name,
  ) as Record<string, unknown>;
  const deductedAgentEvaluation = deductedItem.agent_evaluation as Record<string, unknown>;
  assert.notEqual(deductedAgentEvaluation.deduction_trace, null);

  const untouchedItem = (deductedDimension?.item_results as Array<Record<string, unknown>>).find(
    (item) => item.item_name !== firstItem.name,
  ) as Record<string, unknown>;
  const untouchedAgentEvaluation = untouchedItem.agent_evaluation as Record<string, unknown>;
  assert.equal(untouchedAgentEvaluation.deduction_trace, null);
});

test("persistAndUploadNode writes deterministic rule assessment artifacts and falls back merged output to deterministic results", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-1");
  const deterministicRuleResults = [
    {
      rule_id: "ARKTS-FORBID-004",
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
      rubricScoringPayload: {},
      ruleAgentBootstrapPayload: {},
      taskUnderstanding: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["bug_fix"],
      },
      rubricSnapshot: {},
      deterministicRuleResults,
      assistedRuleCandidates: [],
      rubricAgentRunStatus: "not_enabled",
      rubricAgentRunnerResult: {
        outcome: "request_failed",
        failure_reason: "opencode unavailable",
      },
      ruleAgentRunStatus: "not_enabled",
      resultJson: { ok: true },
    } as never,
    { artifactStore },
  );

  const storedRuleAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit.json"), "utf-8"),
  );
  const storedMergedAudit = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rule-audit-merged.json"), "utf-8"),
  );
  const storedRubricAgentResult = JSON.parse(
    await fs.readFile(path.join(caseDir, "intermediate", "rubric-agent-result.json"), "utf-8"),
  );

  assert.deepEqual(storedRuleAudit, deterministicRuleResults);
  assert.deepEqual(storedMergedAudit, deterministicRuleResults);
  assert.equal(storedRubricAgentResult.runner_result.outcome, "request_failed");
  assert.equal(storedRubricAgentResult.runner_result.failure_reason, "opencode unavailable");
  await assert.rejects(
    fs.readFile(path.join(caseDir, "intermediate", "rubric-agent-turns.json"), "utf-8"),
  );
  await assert.rejects(
    fs.readFile(path.join(caseDir, "intermediate", "rubric-agent-tool-trace.json"), "utf-8"),
  );
  await assert.rejects(fs.readFile(path.join(caseDir, "inputs", "original-prompt.txt"), "utf-8"));
  await assert.rejects(
    fs.readFile(path.join(caseDir, "inputs", "rubric-scoring-prompt.txt"), "utf-8"),
  );
  await assert.rejects(fs.readFile(path.join(caseDir, "inputs", "rule-agent-prompt.txt"), "utf-8"));
  await assert.rejects(fs.readFile(path.join(caseDir, "outputs", "report.html"), "utf-8"));
});

test("pruneCompletedCaseArtifacts preserves only code-linter and hvigor result files when requested", async (t) => {
  const localCaseRoot = await makeTempDir(t);
  const artifactStore = new ArtifactStore(localCaseRoot);
  const caseDir = await artifactStore.ensureCaseDir("case-keep-code-linter");
  await fs.mkdir(path.join(caseDir, "intermediate", "code-linter", "workspace", "entry"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "workspace", "entry", "Index.ets"),
    "let value: number = 1;\n",
  );
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "hvigor-summary.json"),
    '{"status":"failed"}\n',
  );
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "summary.json"),
    '{"runStatus":"success"}\n',
  );
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "findings.effective.json"),
    "[]\n",
  );
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "code-linter.json5"),
    "{}\n",
  );
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "stdout.sanitized.txt"),
    "out\n",
  );
  await fs.writeFile(
    path.join(caseDir, "intermediate", "code-linter", "stderr.sanitized.txt"),
    "err\n",
  );
  await fs.writeFile(path.join(caseDir, "intermediate", "code-linter", "exit-code.txt"), "0\n");
  await fs.writeFile(path.join(caseDir, "intermediate", "temporary.json"), "{}\n");

  await pruneCompletedCaseArtifacts(caseDir, { keepCodeLinterDiagnostics: true });

  await fs.access(path.join(caseDir, "intermediate", "code-linter", "summary.json"));
  await fs.access(path.join(caseDir, "intermediate", "code-linter", "findings.effective.json"));
  await fs.access(path.join(caseDir, "intermediate", "code-linter", "hvigor-summary.json"));
  await assert.rejects(
    () => fs.access(path.join(caseDir, "intermediate", "code-linter", "workspace")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "intermediate", "code-linter", "code-linter.json5")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "intermediate", "code-linter", "stdout.sanitized.txt")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "intermediate", "code-linter", "stderr.sanitized.txt")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "intermediate", "code-linter", "exit-code.txt")),
    /ENOENT/,
  );
  await assert.rejects(
    () => fs.access(path.join(caseDir, "intermediate", "temporary.json")),
    /ENOENT/,
  );
});

test("workflow cleanup keeps code-linter result files when linter or hvigor produced results", async () => {
  const scoreWorkflowModule = (await import("../src/workflow/graph/scoreWorkflow.js")) as {
    shouldKeepCodeLinterResults?: (result: Record<string, unknown>) => boolean;
  };

  assert.equal(typeof scoreWorkflowModule.shouldKeepCodeLinterResults, "function");
  assert.equal(
    scoreWorkflowModule.shouldKeepCodeLinterResults?.({
      officialLinterRunStatus: "success",
      hvigorBuildCheckStatus: "success",
    }),
    true,
  );
  assert.equal(
    scoreWorkflowModule.shouldKeepCodeLinterResults?.({
      officialLinterRunStatus: "not_enabled",
      hvigorBuildCheckStatus: "success",
    }),
    true,
  );
  assert.equal(scoreWorkflowModule.shouldKeepCodeLinterResults?.({}), false);
});
