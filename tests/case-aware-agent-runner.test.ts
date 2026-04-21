import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCaseAwareAgent } from "../src/agent/caseAwareAgentRunner.js";
import { parseCaseAwarePlannerOutput, renderCaseAwareBootstrapPrompt } from "../src/agent/caseAwarePrompt.js";
import type { AgentBootstrapPayload } from "../src/types.js";

const sampleBootstrapPayload: AgentBootstrapPayload = {
  case_context: {
    case_id: "case-1",
    case_root: "/tmp/case-root",
    task_type: "continuation",
    original_prompt_summary: "实现首页本地资讯定位能力",
    original_project_path: "/tmp/case-root/original",
    generated_project_path: "/tmp/case-root/workspace",
    effective_patch_path: "/tmp/case-root/intermediate/effective.patch",
  },
  task_understanding: {
    explicitConstraints: ["首页新增本地资讯入口"],
    contextualConstraints: ["复用现有首页刷新链路"],
    implicitConstraints: ["保持增量改动"],
    classificationHints: ["continuation"],
  },
  rubric_summary: {
    task_type: "continuation",
    evaluation_mode: "auto_precheck_with_human_review",
    scenario: "增量开发需求评分",
    scoring_method: "discrete_band",
    scoring_note: "重点看需求闭环和侵入性",
    common_risks: ["只改文案未接定位能力"],
    report_emphasis: ["需求命中程度"],
    dimension_summaries: [],
    hard_gates: [],
    review_rule_summary: [],
  },
  assisted_rule_candidates: [
    {
      rule_id: "HM-REQ-010-03",
      rule_source: "should_rule",
      why_uncertain: "需要确认是否真的根据定位结果刷新本地资讯",
      local_preliminary_signal: "unknown",
      evidence_files: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
      evidence_snippets: ["updateLocalNews(): void {}"],
    },
  ],
  initial_target_files: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
  tool_contract: {
    allowed_tools: [
      "read_patch",
      "list_dir",
      "read_file",
      "read_file_chunk",
      "grep_in_files",
      "read_json",
    ],
    max_tool_calls: 6,
    max_total_bytes: 61440,
    max_files: 20,
  },
  response_contract: {
    action_enum: ["tool_call", "final_answer"],
    output_language: "zh-CN",
    json_only: true,
  },
};

test("case-aware runner performs a tool_call before emitting final_answer", async (t) => {
  const caseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-aware-runner-"));
  await fs.mkdir(path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "home"), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseRoot, "intermediate"), { recursive: true });
  await fs.writeFile(
    path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "home", "HomePageVM.ets"),
    "export class HomePageVM { updateLocalNews(): void {} }\n",
    "utf-8",
  );
  await fs.writeFile(
    path.join(caseRoot, "intermediate", "effective.patch"),
    "diff --git a/entry/src/main/ets/home/HomePageVM.ets b/entry/src/main/ets/home/HomePageVM.ets\n",
    "utf-8",
  );
  t.after(async () => fs.rm(caseRoot, { recursive: true, force: true }));

  const outputs = [
    JSON.stringify({
      action: "tool_call",
      tool: "read_file",
      args: { path: "workspace/entry/src/main/ets/home/HomePageVM.ets" },
      reason: "需要确认是否更新本地资讯状态",
    }),
    JSON.stringify({
      action: "final_answer",
      summary: {
        assistant_scope: "本次仅辅助候选规则判定",
        overall_confidence: "medium",
      },
      rule_assessments: [
        {
          rule_id: "HM-REQ-010-03",
          decision: "pass",
          confidence: "medium",
          reason: "已看到本地资讯更新逻辑。",
          evidence_used: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
          needs_human_review: false,
        },
      ],
    }),
  ];

  const result = await runCaseAwareAgent({
    caseRoot,
    bootstrapPayload: {
      ...sampleBootstrapPayload,
      case_context: {
        ...sampleBootstrapPayload.case_context,
        case_root: caseRoot,
        original_project_path: path.join(caseRoot, "original"),
        generated_project_path: path.join(caseRoot, "workspace"),
        effective_patch_path: path.join(caseRoot, "intermediate", "effective.patch"),
      },
    },
    completeJsonPrompt: async () => outputs.shift() ?? "",
  });

  assert.equal(result.turns.length, 2);
  assert.equal(result.toolTrace.length, 1);
  assert.equal(result.finalAnswer?.action, "final_answer");
  assert.equal(result.status, "success");
});

test("case-aware runner forces finalize after invalid model output retry exhaustion", async () => {
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: sampleBootstrapPayload,
    completeJsonPrompt: async () => "not-json",
  });

  assert.equal(result.status, "invalid_output");
  assert.equal(result.forcedFinalizeReason, "invalid_model_output");
});

test("case-aware runner exposes canonical final answer text for downstream merge", async () => {
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: {
      ...sampleBootstrapPayload,
      assisted_rule_candidates: [
        {
          rule_id: "HM-REQ-010-01",
          rule_source: "must_rule",
          why_uncertain: "需要确认是否真的提供了定位入口",
          local_preliminary_signal: "unknown",
          evidence_files: ["workspace/entry/src/main/ets/home/HomePage.ets"],
          evidence_snippets: ["Text(this.currentCity)"],
        },
      ],
    },
    completeJsonPrompt: async () =>
      '{"action":"final_answer","final_answer":{"confidence":"high","summary":"证据已足够","rule_results":[{"rule_id":"HM-REQ-010-01","result":"fail","evidence":"未发现定位入口"}]}}',
  });

  const downstreamPayload = JSON.parse(result.finalAnswerRawText) as {
    rule_assessments?: Array<{ rule_id: string; decision: string }>;
  };

  assert.equal(result.status, "success");
  assert.equal(downstreamPayload.rule_assessments?.[0]?.rule_id, "HM-REQ-010-01");
  assert.equal(downstreamPayload.rule_assessments?.[0]?.decision, "violation");
});

test("case-aware runner rejects incomplete final_answer and asks the agent to cover every candidate rule", async () => {
  const prompts: string[] = [];
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: {
      ...sampleBootstrapPayload,
      assisted_rule_candidates: [
        {
          rule_id: "HM-REQ-010-01",
          rule_source: "must_rule",
          why_uncertain: "需要确认首页是否展示当前位置",
          local_preliminary_signal: "unknown",
          evidence_files: ["workspace/entry/src/main/ets/home/HomePage.ets"],
          evidence_snippets: ["Text(this.currentCity)"],
        },
        {
          rule_id: "HM-REQ-010-02",
          rule_source: "must_rule",
          why_uncertain: "需要确认是否申请定位权限并调用 Location Kit",
          local_preliminary_signal: "unknown",
          evidence_files: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
          evidence_snippets: ["requestLocationPermission()"],
        },
      ],
    },
    completeJsonPrompt: async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        return JSON.stringify({
          action: "final_answer",
          summary: {
            assistant_scope: "证据已足够，但先只给出一条判断。",
            overall_confidence: "medium",
          },
          rule_assessments: [
            {
              rule_id: "HM-REQ-010-01",
              decision: "pass",
              confidence: "medium",
              reason: "已看到当前位置展示。",
              evidence_used: ["workspace/entry/src/main/ets/home/HomePage.ets"],
              needs_human_review: false,
            },
          ],
        });
      }

      return JSON.stringify({
        action: "final_answer",
        summary: {
          assistant_scope: "证据已足够，现补齐全部候选规则判断。",
          overall_confidence: "medium",
        },
        rule_assessments: [
          {
            rule_id: "HM-REQ-010-01",
            decision: "pass",
            confidence: "medium",
            reason: "已看到当前位置展示。",
            evidence_used: ["workspace/entry/src/main/ets/home/HomePage.ets"],
            needs_human_review: false,
          },
          {
            rule_id: "HM-REQ-010-02",
            decision: "violation",
            confidence: "medium",
            reason: "未发现 Location Kit 调用。",
            evidence_used: ["workspace/entry/src/main/ets/home/HomePageVM.ets"],
            needs_human_review: false,
          },
        ],
      });
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[0]?.action, "final_answer");
  assert.equal(result.turns[0]?.status, "error");
  assert.equal(result.finalAnswer?.rule_assessments.length, 2);
  assert.equal(result.finalAnswer?.rule_assessments[1]?.rule_id, "HM-REQ-010-02");
  assert.match(prompts[1] ?? "", /HM-REQ-010-02/);
  assert.match(prompts[1] ?? "", /必须补齐每一条候选规则/);
  assert.match(prompts[1] ?? "", /请直接重发完整的 final_answer/);
  assert.match(prompts[1] ?? "", /不要再次输出 summary-only/);
});

test("case-aware runner preserves partial turns and tool trace when model request fails mid-run", async (t) => {
  const caseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "case-aware-runner-failed-"));
  await fs.mkdir(path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "home"), {
    recursive: true,
  });
  await fs.mkdir(path.join(caseRoot, "intermediate"), { recursive: true });
  await fs.writeFile(
    path.join(caseRoot, "workspace", "entry", "src", "main", "ets", "home", "HomePageVM.ets"),
    "export class HomePageVM { updateLocalNews(): void {} }\n",
    "utf-8",
  );
  t.after(async () => fs.rm(caseRoot, { recursive: true, force: true }));

  let callCount = 0;
  const result = await runCaseAwareAgent({
    caseRoot,
    bootstrapPayload: {
      ...sampleBootstrapPayload,
      case_context: {
        ...sampleBootstrapPayload.case_context,
        case_root: caseRoot,
        original_project_path: path.join(caseRoot, "original"),
        generated_project_path: path.join(caseRoot, "workspace"),
        effective_patch_path: path.join(caseRoot, "intermediate", "effective.patch"),
      },
    },
    completeJsonPrompt: async () => {
      callCount += 1;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool_call",
          tool: "read_file",
          args: { path: "workspace/entry/src/main/ets/home/HomePageVM.ets" },
          reason: "先确认是否存在本地资讯刷新逻辑",
        });
      }
      throw new Error("fetch failed");
    },
  });

  assert.equal(result.status, "failed");
  assert.equal(result.forcedFinalizeReason, "agent_request_failed");
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0]?.action, "tool_call");
  assert.equal(result.turns[0]?.status, "success");
  assert.equal(result.toolTrace.length, 1);
  assert.equal(result.toolTrace[0]?.tool, "read_file");
});

test("parseCaseAwarePlannerOutput keeps the first valid JSON object when model concatenates multiple actions", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"tool_call","tool":"read_patch","args":{"patch_path":"intermediate/effective.patch"},"reason":"先读补丁"}{"action":"final_answer","summary":{"assistant_scope":"x","overall_confidence":"low"},"rule_assessments":[]}',
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "read_patch");
  assert.deepEqual(parsed.args, {
    patch_path: "intermediate/effective.patch",
  });
});

test("parseCaseAwarePlannerOutput skips malformed leading JSON objects and parses the next valid one", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"tool_call","tool_name":"grep_in_files","args":{"root":"workspace","files":["a.ets"]}" }{"action":"tool_call","tool_name":"grep_in_files","args":{"root":"workspace","files":["b.ets"],"patterns":["Location"]}}',
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "grep_in_files");
  assert.deepEqual(parsed.args, {
    root: "workspace",
    files: ["b.ets"],
    patterns: ["Location"],
  });
});

test("renderCaseAwareBootstrapPrompt documents exact tool arg schemas and single-action contract", () => {
  const prompt = renderCaseAwareBootstrapPrompt(sampleBootstrapPayload);

  assert.match(prompt, /一次只允许输出一个 JSON object/);
  assert.match(prompt, /必须逐条覆盖 assisted_rule_candidates/);
  assert.match(prompt, /read_patch: args 可为空，或仅允许 path/);
  assert.match(prompt, /list_dir: args = \{ path \}/);
  assert.match(prompt, /read_file_chunk: args = \{ path, startLine, lineCount \}/);
  assert.match(prompt, /grep_in_files: args = \{ pattern, path, limit \}/);
  assert.match(prompt, /不要输出多个 JSON object/);
});

test("parseCaseAwarePlannerOutput accepts tool_call without explicit reason", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"tool_call","tool":"grep_in_files","args":{"root":"workspace","paths":["entry/src/main/ets/home/HomePageVM.ets"],"pattern":"refreshLocalNews"}}',
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "grep_in_files");
  assert.deepEqual(parsed.args, {
    root: "workspace",
    paths: ["entry/src/main/ets/home/HomePageVM.ets"],
    pattern: "refreshLocalNews",
  });
});

test("parseCaseAwarePlannerOutput accepts tool_name alias from current model output", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"tool_call","tool_name":"grep_in_files","args":{"root":"workspace","patterns":["getCurrentLocation","Location"],"files":["entry/src/main/ets/home/HomePageVM.ets"]}}',
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "grep_in_files");
  assert.deepEqual(parsed.args, {
    root: "workspace",
    patterns: ["getCurrentLocation", "Location"],
    files: ["entry/src/main/ets/home/HomePageVM.ets"],
  });
});

test("parseCaseAwarePlannerOutput accepts nested final_answer payloads from current model output", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"final_answer","final_answer":{"summary":"证据已足够","requirement_judgement":{"fulfilled":false,"confidence":"high"},"case_rule_verdicts":[{"rule_id":"HM-REQ-010-01","passed":false,"confidence":"high","evidence":["未发现定位入口"]}]}}',
  );

  assert.equal(parsed.action, "final_answer");
  assert.equal(parsed.summary.overall_confidence, "high");
  assert.equal(parsed.rule_assessments[0]?.rule_id, "HM-REQ-010-01");
  assert.equal(parsed.rule_assessments[0]?.decision, "violation");
});

test("parseCaseAwarePlannerOutput accepts nested rule_results final_answer payloads", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"final_answer","final_answer":{"confidence":"high","summary":"证据已足够","rule_results":[{"rule_id":"HM-REQ-010-02","result":"fail","evidence":"未发现 Location Kit 调用"}]}}',
  );

  assert.equal(parsed.action, "final_answer");
  assert.equal(parsed.summary.overall_confidence, "high");
  assert.equal(parsed.rule_assessments[0]?.rule_id, "HM-REQ-010-02");
  assert.equal(parsed.rule_assessments[0]?.decision, "violation");
  assert.equal(parsed.rule_assessments[0]?.reason, "未发现 Location Kit 调用");
});

test("parseCaseAwarePlannerOutput normalizes current model nested final_answer output", () => {
  const parsed = parseCaseAwarePlannerOutput(
    '{"action":"final_answer","final_answer":{"score":42,"confidence":"medium-high","summary":"本次生成结果对原工程进行了大范围重构和多模块扩展，但几乎没有真正实现需求核心的定位闭环。","case_rule_results":[{"rule_id":"HM-REQ-010-01","rule_name":"首页必须新增当前位置或本地频道展示区，并支持用户主动刷新定位结果","result":"fail","evidence":"未发现当前位置展示区或手动刷新定位入口。"},{"rule_id":"HM-REQ-010-02","rule_name":"必须按需申请定位权限并通过 Location Kit 获取设备当前位置","result":"fail","evidence":"未发现 Location Kit 调用。"}]}}',
  );

  assert.equal(parsed.action, "final_answer");
  assert.equal(parsed.summary.overall_confidence, "medium");
  assert.match(parsed.summary.assistant_scope, /定位闭环/);
  assert.equal(parsed.rule_assessments[0]?.rule_id, "HM-REQ-010-01");
  assert.equal(parsed.rule_assessments[0]?.decision, "violation");
  assert.equal(parsed.rule_assessments[0]?.reason, "未发现当前位置展示区或手动刷新定位入口。");
  assert.equal(parsed.rule_assessments[1]?.rule_id, "HM-REQ-010-02");
  assert.equal(parsed.rule_assessments[1]?.decision, "violation");
  assert.equal(parsed.rule_assessments[1]?.reason, "未发现 Location Kit 调用。");
});

test("parseCaseAwarePlannerOutput normalizes singular rule_assessment outputs with passed booleans and numeric confidence", () => {
  const parsed = parseCaseAwarePlannerOutput(
    JSON.stringify({
      action: "final_answer",
      final_answer: {
        summary_judgement: "首页本地资讯闭环未完成。",
        rule_assessment: [
          {
            rule_id: "HM-REQ-010-01",
            passed: false,
            confidence: 0.92,
            evidence: [
              {
                file: "workspace/features/home/src/main/ets/components/HomeContentView.ets",
                detail: "未发现当前位置展示区或手动刷新定位入口。",
              },
            ],
            reasoning: "首页仍然只有通用新闻流。",
          },
          {
            rule_id: "HM-REQ-010-02",
            passed: false,
            confidence: 0.9,
            evidence: [
              {
                file: "workspace/features/home/src/main/ets/viewModels/HomePageVM.ets",
                detail: "未发现 Location Kit 调用。",
              },
            ],
            reasoning: "未接入定位权限与位置获取链路。",
          },
        ],
      },
    }),
  );

  assert.equal(parsed.action, "final_answer");
  assert.match(parsed.summary.assistant_scope, /闭环未完成/);
  assert.equal(parsed.summary.overall_confidence, "high");
  assert.equal(parsed.rule_assessments.length, 2);
  assert.equal(parsed.rule_assessments[0]?.rule_id, "HM-REQ-010-01");
  assert.equal(parsed.rule_assessments[0]?.decision, "violation");
  assert.equal(parsed.rule_assessments[0]?.reason, "首页仍然只有通用新闻流。");
  assert.deepEqual(parsed.rule_assessments[0]?.evidence_used, [
    "workspace/features/home/src/main/ets/components/HomeContentView.ets",
  ]);
  assert.equal(parsed.rule_assessments[1]?.rule_id, "HM-REQ-010-02");
  assert.equal(parsed.rule_assessments[1]?.decision, "violation");
  assert.equal(parsed.rule_assessments[1]?.reason, "未接入定位权限与位置获取链路。");
});

test("case-aware runner accepts nested final_answer variants that use singular rule_assessment fields", async () => {
  const result = await runCaseAwareAgent({
    caseRoot: "/tmp/case-root",
    bootstrapPayload: sampleBootstrapPayload,
    completeJsonPrompt: async () =>
      JSON.stringify({
        action: "final_answer",
        final_answer: {
          summary_judgement: "当前实现未满足本地资讯定位闭环要求。",
          rule_assessment: [
            {
              rule_id: "HM-REQ-010-03",
              assessment: "not_met",
              confidence: "high",
              evidence: [
                {
                  file: "workspace/entry/src/main/ets/home/HomePageVM.ets",
                  detail: "未发现当前位置展示区。",
                },
              ],
              reasoning: "首页缺少位置展示与刷新入口。",
            },
          ],
        },
      }),
  });

  assert.equal(result.status, "success");
  assert.equal(result.finalAnswer?.rule_assessments.length, 1);
  assert.equal(result.finalAnswer?.rule_assessments[0]?.rule_id, "HM-REQ-010-03");
  assert.equal(result.finalAnswer?.rule_assessments[0]?.decision, "violation");
});
