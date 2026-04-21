import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCaseAwareAgent } from "../src/agent/caseAwareAgentRunner.js";
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
