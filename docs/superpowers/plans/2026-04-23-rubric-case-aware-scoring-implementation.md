# Rubric Case-Aware 评分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 rubric agent 从一次性长 prompt 调用改造成参考 rule agent 的 case-aware 多轮工具评分模式，在保留现有 `RubricScoringResult` 下游契约的前提下降低 prompt 长度、减少卡顿，并强制扣分项给出代码证据与改进建议。

**Architecture:** 优先复用现有 `caseTools`、工具 schema、严格 JSON 单对象校验思路、turn/tool trace 结构和 repair prompt 模式，只为 rubric 新增自己的 payload、final_answer schema 和 item 全覆盖校验。外层 workflow 节点顺序保持不变，只替换 rubric prompt builder 和 rubric agent node 的内部实现，并继续保留失败时“满分待复核”的降级路径。

**Tech Stack:** TypeScript, Node.js test runner, Zod, existing case-aware tool executor, LangGraph workflow state

---

### Task 1: 抽出可共享的严格 JSON 解析 helper，避免 rubric 再复制一套协议底层逻辑

**Files:**
- Create: `src/agent/jsonProtocol.ts`
- Modify: `src/agent/caseAwareProtocol.ts`
- Test: `tests/case-aware-protocol.test.ts`

- [ ] **Step 1: 写失败测试，锁定当前 case-aware 严格解析行为不能回退**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseCaseAwarePlannerOutputStrict } from "../src/agent/caseAwareProtocol.js";

test("parseCaseAwarePlannerOutputStrict rejects prose around JSON", () => {
  assert.throws(
    () =>
      parseCaseAwarePlannerOutputStrict(
        '说明文字 {"action":"tool_call","tool":"read_patch","args":{}}',
      ),
    /protocol_error/,
  );
});

test("parseCaseAwarePlannerOutputStrict rejects multiple JSON objects", () => {
  assert.throws(
    () =>
      parseCaseAwarePlannerOutputStrict(
        '{"action":"tool_call","tool":"read_patch","args":{}}{"action":"tool_call","tool":"read_patch","args":{}}',
      ),
    /multiple top-level JSON objects/,
  );
});
```

- [ ] **Step 2: 运行测试，确认当前为绿，作为后续抽 helper 的保护网**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts`
Expected: PASS

- [ ] **Step 3: 新增共享 JSON 协议 helper 文件**

```ts
// src/agent/jsonProtocol.ts
import { z } from "zod";

export class StrictJsonProtocolError extends Error {
  constructor(
    public readonly code:
      | "not_single_json_object"
      | "multiple_json_objects"
      | "invalid_json"
      | "schema_validation",
    message: string,
  ) {
    super(`protocol_error: ${message}`);
    this.name = "StrictJsonProtocolError";
  }
}

export function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path
    .map((segment) => {
      const segmentText = String(segment);
      return typeof segment === "number"
        ? `[${segment}]`
        : /^[A-Za-z_][A-Za-z0-9_]*$/.test(segmentText)
          ? segmentText
          : JSON.stringify(segmentText);
    })
    .join(".")
    .replace(/\.\[/g, "[");
}

export function formatSchemaValidationError(error: z.ZodError): string {
  const formattedIssues = error.issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    return `${path}: ${issue.message}`;
  });

  return formattedIssues.join("; ") || z.prettifyError(error);
}

export function findTopLevelJsonObjectEnd(rawText: string): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

export function parseSingleJsonObjectStrict<T>(
  rawText: string,
  schema: z.ZodSchema<T>,
): T {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new StrictJsonProtocolError(
      "not_single_json_object",
      "output must be one top-level JSON object without prose",
    );
  }

  const objectEndIndex = findTopLevelJsonObjectEnd(trimmed);
  if (objectEndIndex >= 0 && objectEndIndex < trimmed.length - 1) {
    throw new StrictJsonProtocolError(
      "multiple_json_objects",
      "received multiple top-level JSON objects in one response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StrictJsonProtocolError("invalid_json", `invalid JSON: ${message}`);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StrictJsonProtocolError(
      "schema_validation",
      formatSchemaValidationError(result.error),
    );
  }

  return result.data;
}
```

- [ ] **Step 4: 改造 case-aware protocol 使用共享 helper**

```ts
// src/agent/caseAwareProtocol.ts
import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";
import {
  StrictJsonProtocolError,
  parseSingleJsonObjectStrict,
} from "./jsonProtocol.js";

export class CaseAwareProtocolError extends StrictJsonProtocolError {}

export function parseCaseAwarePlannerOutputStrict(rawText: string): CaseAwareAgentPlannerOutput {
  try {
    return parseSingleJsonObjectStrict(rawText, caseAwarePlannerOutputSchema);
  } catch (error) {
    if (error instanceof StrictJsonProtocolError) {
      throw new CaseAwareProtocolError(error.code, error.message.replace(/^protocol_error:\s*/, ""));
    }
    throw error;
  }
}
```

- [ ] **Step 5: 运行测试，确认抽 helper 后行为不变**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts`
Expected: PASS

- [ ] **Step 6: 提交共享 helper 抽取**

```bash
git add src/agent/jsonProtocol.ts src/agent/caseAwareProtocol.ts tests/case-aware-protocol.test.ts
git commit -m "refactor: extract strict json protocol helpers"
```

### Task 2: 扩展 rubric 类型，支持扣分项改进建议和 case-aware runner 结果

**Files:**
- Modify: `src/types.ts`
- Modify: `src/workflow/state.ts`
- Test: `tests/rubric-scoring.test.ts`

- [ ] **Step 1: 写失败测试，锁定扣分项必须包含改进建议**

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import {
  parseRubricScoringResultStrict,
} from "../src/agent/rubricScoring.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

test("parseRubricScoringResultStrict rejects deducted item without improvement suggestion", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const firstDimension = snapshot.dimension_summaries[0];
  const firstItem = firstDimension.item_summaries[0];
  const lowerBand = firstItem.scoring_bands[1];

  const payload = {
    summary: {
      overall_assessment: "存在单项扣分。",
      overall_confidence: "medium",
    },
    item_scores: snapshot.dimension_summaries.flatMap((dimension) =>
      dimension.item_summaries.map((item) => ({
        dimension_name: dimension.name,
        item_name: item.name,
        score:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? lowerBand.score
            : item.scoring_bands[0].score,
        max_score: item.weight,
        matched_band_score:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? lowerBand.score
            : item.scoring_bands[0].score,
        rationale: "存在明确问题。",
        evidence_used: [],
        confidence: "medium",
        review_required: false,
        deduction_trace:
          dimension.name === firstDimension.name && item.name === firstItem.name
            ? {
                code_locations: ["workspace/entry/src/main/ets/pages/Index.ets:12"],
                impact_scope: "影响页面初始化稳定性",
                rubric_comparison: "未命中更高档，因为存在空值风险；命中当前档，因为主体路径仍可运行",
                deduction_reason: "发现空值未防御。",
              }
            : undefined,
      })),
    ),
    hard_gate_candidates: [],
    risks: [],
    strengths: [],
    main_issues: [],
  };

  assert.throws(
    () => parseRubricScoringResultStrict(JSON.stringify(payload), snapshot),
    /improvement_suggestion/,
  );
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/rubric-scoring.test.ts`
Expected: FAIL，提示解析逻辑尚未要求 `improvement_suggestion`

- [ ] **Step 3: 扩展类型定义**

```ts
// src/types.ts
export interface RubricDeductionTrace {
  code_locations: string[];
  impact_scope: string;
  rubric_comparison: string;
  deduction_reason: string;
  improvement_suggestion: string;
}

export type RubricCaseAwareRunnerOutcome =
  | "success"
  | "request_failed"
  | "protocol_error"
  | "tool_budget_exhausted";

export interface RubricCaseAwareRunnerResult {
  outcome: RubricCaseAwareRunnerOutcome;
  final_answer?: RubricScoringResult;
  final_answer_raw_text?: string;
  failure_reason?: string;
  turns: CaseAwareAgentTurn[];
  tool_trace: CaseToolTraceItem[];
}
```

```ts
// src/workflow/state.ts
  rubricAgentRunnerMode: Annotation<"case_aware">(),
  rubricAgentRunnerResult: Annotation<RubricCaseAwareRunnerResult>(),
  rubricAgentTurns: Annotation<CaseAwareAgentTurn[]>(),
  rubricAgentToolTrace: Annotation<CaseToolTraceItem[]>(),
```

- [ ] **Step 4: 更新 rubric scoring 解析 schema，要求扣分项必须有改进建议**

```ts
// src/agent/rubricScoring.ts
const deductionTraceSchema = z
  .object({
    code_locations: z.array(z.string().min(1)).min(1),
    impact_scope: z.string().min(1),
    rubric_comparison: z.string().min(1),
    deduction_reason: z.string().min(1),
    improvement_suggestion: z.string().min(1),
  })
  .strict();
```

```ts
if (item.score < item.max_score) {
  if (!item.deduction_trace?.improvement_suggestion?.trim()) {
    throw new Error(`deduction_trace.improvement_suggestion required for deducted rubric items: ${key}`);
  }
}
```

- [ ] **Step 5: 运行测试，确认类型与解析已收紧**

Run: `node --import tsx --test tests/rubric-scoring.test.ts`
Expected: PASS

- [ ] **Step 6: 提交类型扩展**

```bash
git add src/types.ts src/workflow/state.ts src/agent/rubricScoring.ts tests/rubric-scoring.test.ts
git commit -m "feat: require improvement suggestions for deducted rubric items"
```

### Task 3: 新增 rubric case-aware 协议模块，复用共享 helper 和工具 schema

**Files:**
- Create: `src/agent/rubricCaseAwareProtocol.ts`
- Test: `tests/rubric-case-aware-protocol.test.ts`

- [ ] **Step 1: 写失败测试，锁定 rubric protocol 的严格行为**

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import {
  parseRubricCaseAwarePlannerOutputStrict,
  validateRubricFinalAnswerAgainstSnapshot,
} from "../src/agent/rubricCaseAwareProtocol.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

test("parseRubricCaseAwarePlannerOutputStrict accepts one tool_call object", () => {
  const parsed = parseRubricCaseAwarePlannerOutputStrict(
    JSON.stringify({ action: "tool_call", tool: "read_patch", args: {} }),
  );

  assert.equal(parsed.action, "tool_call");
  assert.equal(parsed.tool, "read_patch");
});

test("validateRubricFinalAnswerAgainstSnapshot reports missing rubric items", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const validation = validateRubricFinalAnswerAgainstSnapshot(
    {
      action: "final_answer",
      summary: { overall_assessment: "test", overall_confidence: "medium" },
      item_scores: [],
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    },
    snapshot,
  );

  assert.equal(validation.ok, false);
  assert.ok(validation.missing_item_keys.length > 0);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/rubric-case-aware-protocol.test.ts`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 实现 rubric protocol**

```ts
// src/agent/rubricCaseAwareProtocol.ts
import { z } from "zod";
import { caseToolNameSchema } from "./caseToolSchemas.js";
import {
  StrictJsonProtocolError,
  parseSingleJsonObjectStrict,
} from "./jsonProtocol.js";
import type {
  LoadedRubricSnapshot,
  RubricScoringResult,
} from "../types.js";

export class RubricCaseAwareProtocolError extends StrictJsonProtocolError {}

export const rubricCaseAwareToolCallSchema = z
  .object({
    action: z.literal("tool_call"),
    tool: caseToolNameSchema,
    args: z.record(z.string(), z.unknown()),
    reason: z.string().optional(),
  })
  .strict();

export const rubricCaseAwareFinalAnswerSchema = z
  .object({
    action: z.literal("final_answer"),
    summary: z
      .object({
        overall_assessment: z.string().min(1),
        overall_confidence: z.enum(["high", "medium", "low"]),
      })
      .strict(),
    item_scores: z.array(z.record(z.string(), z.unknown())).min(1),
    hard_gate_candidates: z.array(z.record(z.string(), z.unknown())),
    risks: z.array(z.record(z.string(), z.unknown())),
    strengths: z.array(z.string()),
    main_issues: z.array(z.string()),
  })
  .strict();

export const rubricCaseAwarePlannerOutputSchema = z.discriminatedUnion("action", [
  rubricCaseAwareToolCallSchema,
  rubricCaseAwareFinalAnswerSchema,
]);

export function parseRubricCaseAwarePlannerOutputStrict(rawText: string) {
  try {
    return parseSingleJsonObjectStrict(rawText, rubricCaseAwarePlannerOutputSchema);
  } catch (error) {
    if (error instanceof StrictJsonProtocolError) {
      throw new RubricCaseAwareProtocolError(error.code, error.message.replace(/^protocol_error:\s*/, ""));
    }
    throw error;
  }
}

export function validateRubricFinalAnswerAgainstSnapshot(
  finalAnswer: { item_scores: RubricScoringResult["item_scores"] },
  snapshot: LoadedRubricSnapshot,
) {
  const expectedItemKeys = snapshot.dimension_summaries.flatMap((dimension) =>
    dimension.item_summaries.map((item) => `${dimension.name}::${item.name}`),
  );
  const expected = new Set(expectedItemKeys);
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  const unexpected = new Set<string>();

  for (const item of finalAnswer.item_scores) {
    const key = `${item.dimension_name}::${item.item_name}`;
    if (seen.has(key)) {
      duplicate.add(key);
    }
    seen.add(key);
    if (!expected.has(key)) {
      unexpected.add(key);
    }
  }

  return {
    ok:
      expectedItemKeys.every((key) => seen.has(key)) &&
      duplicate.size === 0 &&
      unexpected.size === 0,
    missing_item_keys: expectedItemKeys.filter((key) => !seen.has(key)),
    duplicate_item_keys: Array.from(duplicate),
    unexpected_item_keys: Array.from(unexpected),
  };
}
```

- [ ] **Step 4: 运行测试，确认协议模块可用**

Run: `node --import tsx --test tests/rubric-case-aware-protocol.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 rubric protocol**

```bash
git add src/agent/rubricCaseAwareProtocol.ts tests/rubric-case-aware-protocol.test.ts
git commit -m "feat: add rubric case-aware protocol"
```

### Task 4: 新增 rubric case-aware prompt，复用现有 repair prompt 模式并压缩首轮上下文

**Files:**
- Create: `src/agent/rubricCaseAwarePrompt.ts`
- Modify: `src/agent/rubricScoring.ts`
- Test: `tests/rubric-scoring.test.ts`

- [ ] **Step 1: 写失败测试，锁定 bootstrap prompt 必须瘦身且包含工具协议**

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildRubricSnapshot } from "../src/agent/ruleAssistance.js";
import { loadRubricForTaskType } from "../src/scoring/rubricLoader.js";
import {
  buildRubricCaseAwarePayload,
  renderRubricCaseAwareBootstrapPrompt,
} from "../src/agent/rubricCaseAwarePrompt.js";

const referenceRoot = path.resolve(process.cwd(), "references/scoring");

test("renderRubricCaseAwareBootstrapPrompt includes tool protocol and default-full-score rules", async () => {
  const rubric = await loadRubricForTaskType("full_generation", referenceRoot);
  const snapshot = buildRubricSnapshot(rubric);
  const payload = buildRubricCaseAwarePayload({
    caseInput: {
      caseId: "demo",
      promptText: "build demo",
      originalProjectPath: "/tmp/original",
      generatedProjectPath: "/tmp/workspace",
    },
    caseRoot: "/tmp/case",
    effectivePatchPath: "/tmp/case/intermediate/effective.patch",
    taskType: "full_generation",
    constraintSummary: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: ["full_generation"],
    },
    rubricSnapshot: snapshot,
    initialTargetFiles: ["workspace/entry/src/main/ets/pages/Index.ets"],
  });

  const prompt = renderRubricCaseAwareBootstrapPrompt(payload);
  assert.match(prompt, /tool_call|final_answer/);
  assert.match(prompt, /证据不足.*保持满分/);
  assert.match(prompt, /improvement_suggestion/);
  assert.doesNotMatch(prompt, /diff --git/);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/rubric-scoring.test.ts`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 实现 prompt 与 payload builder**

```ts
// src/agent/rubricCaseAwarePrompt.ts
import type {
  CaseInput,
  CaseToolName,
  ConstraintSummary,
  LoadedRubricSnapshot,
  TaskType,
} from "../types.js";

export type RubricCaseAwarePayload = {
  case_context: {
    case_id: string;
    case_root: string;
    task_type: TaskType;
    original_prompt_summary: string;
    original_project_path: string;
    generated_project_path: string;
    effective_patch_path?: string;
  };
  task_understanding: ConstraintSummary;
  rubric_summary: LoadedRubricSnapshot;
  initial_target_files: string[];
  tool_contract: {
    allowed_tools: CaseToolName[];
    max_tool_calls: number;
    max_total_bytes: number;
    max_files: number;
  };
  response_contract: {
    action_enum: ["tool_call", "final_answer"];
    output_language: "zh-CN";
    json_only: true;
  };
};

export function buildRubricCaseAwarePayload(input: {
  caseInput: CaseInput;
  caseRoot: string;
  effectivePatchPath?: string;
  taskType: TaskType;
  constraintSummary: ConstraintSummary;
  rubricSnapshot: LoadedRubricSnapshot;
  initialTargetFiles: string[];
}): RubricCaseAwarePayload {
  return {
    case_context: {
      case_id: input.caseInput.caseId,
      case_root: input.caseRoot,
      task_type: input.taskType,
      original_prompt_summary: input.caseInput.promptText,
      original_project_path: input.caseInput.originalProjectPath,
      generated_project_path: input.caseInput.generatedProjectPath,
      effective_patch_path: input.effectivePatchPath,
    },
    task_understanding: input.constraintSummary,
    rubric_summary: input.rubricSnapshot,
    initial_target_files: input.initialTargetFiles,
    tool_contract: {
      allowed_tools: [
        "read_patch",
        "list_dir",
        "read_file",
        "read_file_chunk",
        "grep_in_files",
        "read_json",
      ],
      max_tool_calls: 4,
      max_total_bytes: 40960,
      max_files: 12,
    },
    response_contract: {
      action_enum: ["tool_call", "final_answer"],
      output_language: "zh-CN",
      json_only: true,
    },
  };
}

export function renderRubricCaseAwareBootstrapPrompt(payload: RubricCaseAwarePayload): string {
  return [
    "你是评分工作流中的 rubric case-aware 主评分 agent。",
    "你只能输出 tool_call 或 final_answer 两种 JSON action。",
    "一次只能输出一个 JSON object，禁止 markdown、代码块和额外解释。",
    "每个 rubric item 默认满分；只有读取到明确负面证据时才允许扣分。",
    "证据不足时必须保持满分，不得保守扣分。",
    "扣分项必须提供 deduction_trace，且必须包含 code_locations、impact_scope、rubric_comparison、deduction_reason、improvement_suggestion。",
    "improvement_suggestion 必须给出针对当前问题的最小修复建议。",
    "请优先从 initial_target_files 和 effective_patch_path 开始补查。",
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}
```

- [ ] **Step 4: 运行测试，确认 prompt builder 行为符合预期**

Run: `node --import tsx --test tests/rubric-scoring.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 rubric case-aware prompt**

```bash
git add src/agent/rubricCaseAwarePrompt.ts src/agent/rubricScoring.ts tests/rubric-scoring.test.ts
git commit -m "feat: add rubric case-aware prompt builder"
```

### Task 5: 新增 rubric case-aware runner，复用 caseTools 和 turn/tool trace 结构

**Files:**
- Create: `src/agent/rubricCaseAwareRunner.ts`
- Test: `tests/rubric-case-aware-runner.test.ts`

- [ ] **Step 1: 写失败测试，锁定 runner 的核心交互**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRubricCaseAwareAgent } from "../src/agent/rubricCaseAwareRunner.js";

test("runRubricCaseAwareAgent executes one tool_call then accepts final_answer", async () => {
  const caseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rubric-runner-"));
  await fs.mkdir(path.join(caseRoot, "intermediate"), { recursive: true });
  await fs.writeFile(
    path.join(caseRoot, "intermediate", "effective.patch"),
    "diff --git a/a b/b\n",
    "utf-8",
  );

  const responses = [
    JSON.stringify({ action: "tool_call", tool: "read_patch", args: {} }),
    JSON.stringify({
      action: "final_answer",
      summary: { overall_assessment: "未发现充分负面证据。", overall_confidence: "medium" },
      item_scores: [
        {
          dimension_name: "风险控制与稳定性",
          item_name: "安全与边界意识",
          score: 3,
          max_score: 3,
          matched_band_score: 3,
          rationale: "证据不足，按满分保留。",
          evidence_used: [],
          confidence: "medium",
          review_required: false,
        },
      ],
      hard_gate_candidates: [],
      risks: [],
      strengths: [],
      main_issues: [],
    }),
  ];

  let callIndex = 0;
  const result = await runRubricCaseAwareAgent({
    caseRoot,
    bootstrapPayload: {} as never,
    completeJsonPrompt: async () => responses[callIndex++] ?? responses.at(-1)!,
  });

  assert.equal(result.outcome, "success");
  assert.ok(result.final_answer);
  assert.equal(result.tool_trace.length, 1);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/rubric-case-aware-runner.test.ts`
Expected: FAIL，提示模块不存在

- [ ] **Step 3: 实现 runner**

```ts
// src/agent/rubricCaseAwareRunner.ts
import {
  renderRubricCaseAwareBootstrapPrompt,
} from "./rubricCaseAwarePrompt.js";
import {
  parseRubricCaseAwarePlannerOutputStrict,
  validateRubricFinalAnswerAgainstSnapshot,
} from "./rubricCaseAwareProtocol.js";
import { createCaseToolExecutor } from "./caseTools.js";
import type {
  CaseAwareAgentTurn,
  CaseToolTraceItem,
  LoadedRubricSnapshot,
  RubricCaseAwareRunnerResult,
  RubricScoringResult,
} from "../types.js";

export async function runRubricCaseAwareAgent(input: {
  caseRoot: string;
  bootstrapPayload: {
    rubric_summary: LoadedRubricSnapshot;
    tool_contract: {
      max_tool_calls: number;
      max_total_bytes: number;
      max_files: number;
    };
  } & Record<string, unknown>;
  completeJsonPrompt: (prompt: string, options?: { requestTag?: string }) => Promise<string>;
  logger?: {
    info(message: string): Promise<void>;
    warn(message: string): Promise<void>;
    error(message: string): Promise<void>;
  };
}): Promise<RubricCaseAwareRunnerResult> {
  const executor = createCaseToolExecutor({
    caseRoot: input.caseRoot,
    effectivePatchPath:
      typeof input.bootstrapPayload.case_context === "object" &&
      input.bootstrapPayload.case_context &&
      "effective_patch_path" in input.bootstrapPayload.case_context
        ? String((input.bootstrapPayload.case_context as { effective_patch_path?: string }).effective_patch_path ?? "")
        : undefined,
    maxToolCalls: input.bootstrapPayload.tool_contract.max_tool_calls,
    maxTotalBytes: input.bootstrapPayload.tool_contract.max_total_bytes,
    maxFiles: input.bootstrapPayload.tool_contract.max_files,
  });

  const turns: CaseAwareAgentTurn[] = [];
  const tool_trace: CaseToolTraceItem[] = [];
  let latestObservation = "";
  let prompt = renderRubricCaseAwareBootstrapPrompt(input.bootstrapPayload as never);

  for (let turn = 1; turn <= input.bootstrapPayload.tool_contract.max_tool_calls + 1; turn += 1) {
    const rawText = await input.completeJsonPrompt(prompt, {
      requestTag: `rubric_case_aware_turn_${turn}`,
    });
    const decision = parseRubricCaseAwarePlannerOutputStrict(rawText);

    if (decision.action === "final_answer") {
      const validation = validateRubricFinalAnswerAgainstSnapshot(
        decision as { item_scores: RubricScoringResult["item_scores"] },
        input.bootstrapPayload.rubric_summary,
      );
      if (!validation.ok) {
        return {
          outcome: "protocol_error",
          final_answer_raw_text: rawText,
          failure_reason: JSON.stringify(validation),
          turns,
          tool_trace,
        };
      }
      turns.push({
        turn,
        action: "final_answer",
        status: "success",
        raw_output_text: rawText,
      });
      return {
        outcome: "success",
        final_answer: decision as RubricScoringResult,
        final_answer_raw_text: rawText,
        turns,
        tool_trace,
      };
    }

    const toolResult = await executor.execute({
      tool: decision.tool,
      args: decision.args,
    });
    tool_trace.push({
      turn,
      tool: decision.tool,
      args: decision.args,
      ok: toolResult.ok,
      error_code: toolResult.ok ? undefined : toolResult.error.code,
      error_message: toolResult.ok ? undefined : toolResult.error.message,
      paths_read: toolResult.pathsRead,
      bytes_returned: toolResult.bytesReturned,
      truncated: Boolean(toolResult.ok ? toolResult.result.truncated : false),
      budget_after_call: toolResult.budget,
    });
    turns.push({
      turn,
      action: "tool_call",
      status: toolResult.ok ? "success" : "error",
      raw_output_text: rawText,
      tool: decision.tool,
      args: decision.args,
      ...(decision.reason ? { reason: decision.reason } : {}),
    });

    latestObservation = JSON.stringify({
      tool: decision.tool,
      ok: toolResult.ok,
      result: toolResult.ok ? toolResult.result : undefined,
      error: toolResult.ok ? undefined : toolResult.error,
      budget: toolResult.budget,
    });
    prompt = [
      "继续同一个 rubric case-aware 评分任务。",
      "如果证据已经足够，请直接输出 final_answer。",
      "如果仍需补查，请继续输出一个合法 tool_call。",
      latestObservation,
    ].join("\n");
  }

  return {
    outcome: "tool_budget_exhausted",
    failure_reason: "tool_budget_exceeded",
    turns,
    tool_trace,
  };
}
```

- [ ] **Step 4: 运行测试，确认 runner 核心链路跑通**

Run: `node --import tsx --test tests/rubric-case-aware-runner.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 rubric runner**

```bash
git add src/agent/rubricCaseAwareRunner.ts tests/rubric-case-aware-runner.test.ts
git commit -m "feat: add rubric case-aware runner"
```

### Task 6: 改造 rubric prompt builder，使用 case-aware payload 和初始目标文件

**Files:**
- Modify: `src/nodes/rubricScoringPromptBuilderNode.ts`
- Modify: `src/agent/rubricScoring.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 builder 会生成 initial_target_files 且 prompt 更短**

```ts
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { rubricScoringPromptBuilderNode } from "../src/nodes/rubricScoringPromptBuilderNode.js";

test("rubricScoringPromptBuilderNode builds case-aware payload from changed files", async () => {
  const result = await rubricScoringPromptBuilderNode(
    {
      sourceCasePath: "/tmp/case",
      caseInput: {
        caseId: "demo",
        promptText: "build demo",
        originalProjectPath: "/tmp/case/original",
        generatedProjectPath: "/tmp/case/workspace",
      },
      effectivePatchPath: "/tmp/case/intermediate/effective.patch",
      taskType: "full_generation",
      constraintSummary: {
        explicitConstraints: [],
        contextualConstraints: [],
        implicitConstraints: [],
        classificationHints: ["full_generation"],
      },
      rubricSnapshot: {
        task_type: "full_generation",
        evaluation_mode: "auto_precheck_with_human_review",
        scenario: "",
        scoring_method: "discrete_band",
        scoring_note: "",
        common_risks: [],
        report_emphasis: [],
        dimension_summaries: [],
        hard_gates: [],
        review_rule_summary: [],
      },
      evidenceSummary: {
        workspaceFileCount: 1,
        originalFileCount: 1,
        changedFileCount: 1,
        changedFiles: ["entry/src/main/ets/pages/Index.ets"],
        hasPatch: true,
      },
    } as never,
    {},
  );

  assert.deepEqual(result.rubricScoringPayload?.initial_target_files, [
    "workspace/entry/src/main/ets/pages/Index.ets",
  ]);
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: FAIL，提示 payload 尚未包含 `initial_target_files`

- [ ] **Step 3: 改造 builder**

```ts
// src/nodes/rubricScoringPromptBuilderNode.ts
import path from "node:path";
import { buildRubricCaseAwarePayload, renderRubricCaseAwareBootstrapPrompt } from "../agent/rubricCaseAwarePrompt.js";

function normalizeTargetFiles(changedFiles: string[]): string[] {
  return Array.from(new Set(changedFiles.map((file) => `workspace/${file.replace(/^workspace\//, "")}`))).slice(0, 20);
}

export async function rubricScoringPromptBuilderNode(...) {
  const caseRoot = state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath);
  const initialTargetFiles =
    (state.evidenceSummary?.changedFiles?.length ?? 0) > 0
      ? normalizeTargetFiles(state.evidenceSummary?.changedFiles ?? [])
      : [];
  const payload = buildRubricCaseAwarePayload({
    caseInput: state.caseInput,
    caseRoot,
    effectivePatchPath: state.effectivePatchPath,
    taskType: state.taskType,
    constraintSummary: state.constraintSummary,
    rubricSnapshot: state.rubricSnapshot,
    initialTargetFiles,
  });
  const prompt = renderRubricCaseAwareBootstrapPrompt(payload);
  return {
    rubricScoringPayload: payload,
    rubricScoringPromptText: prompt,
  };
}
```

- [ ] **Step 4: 运行测试，确认 builder 已切换**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 builder 改造**

```bash
git add src/nodes/rubricScoringPromptBuilderNode.ts src/agent/rubricScoring.ts tests/score-agent.test.ts
git commit -m "feat: build rubric case-aware bootstrap payload"
```

### Task 7: 改造 rubric agent node，接入 runner 并保留失败降级

**Files:**
- Modify: `src/nodes/rubricScoringAgentNode.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 rubric agent node 会保存 turns 和 tool trace**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { rubricScoringAgentNode } from "../src/nodes/rubricScoringAgentNode.js";

test("rubricScoringAgentNode stores runner traces on success", async () => {
  const result = await rubricScoringAgentNode(
    {
      sourceCasePath: "/tmp/case",
      caseInput: {
        caseId: "demo",
        promptText: "build demo",
        originalProjectPath: "/tmp/case/original",
        generatedProjectPath: "/tmp/case/workspace",
      },
      rubricScoringPromptText: "bootstrap",
      rubricScoringPayload: {
        rubric_summary: {
          task_type: "full_generation",
          evaluation_mode: "auto_precheck_with_human_review",
          scenario: "",
          scoring_method: "discrete_band",
          scoring_note: "",
          common_risks: [],
          report_emphasis: [],
          dimension_summaries: [],
          hard_gates: [],
          review_rule_summary: [],
        },
        tool_contract: {
          max_tool_calls: 4,
          max_total_bytes: 40960,
          max_files: 12,
        },
      },
    } as never,
    {
      agentClient: {
        completeJsonPrompt: async () =>
          JSON.stringify({
            action: "final_answer",
            summary: { overall_assessment: "ok", overall_confidence: "medium" },
            item_scores: [],
            hard_gate_candidates: [],
            risks: [],
            strengths: [],
            main_issues: [],
          }),
      },
    },
  );

  assert.equal(result.rubricAgentRunStatus, "success");
  assert.ok(Array.isArray(result.rubricAgentTurns));
  assert.ok(Array.isArray(result.rubricAgentToolTrace));
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: FAIL，提示 node 尚未写入 runner traces

- [ ] **Step 3: 改造 rubric agent node**

```ts
// src/nodes/rubricScoringAgentNode.ts
import path from "node:path";
import { runRubricCaseAwareAgent } from "../agent/rubricCaseAwareRunner.js";

export async function rubricScoringAgentNode(...) {
  if (!deps.agentClient) {
    return {
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentTurns: [],
      rubricAgentToolTrace: [],
    };
  }

  if (!state.rubricScoringPayload) {
    return {
      rubricAgentRunStatus: "skipped",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentTurns: [],
      rubricAgentToolTrace: [],
    };
  }

  try {
    const runnerResult = await runRubricCaseAwareAgent({
      caseRoot: state.sourceCasePath ?? path.dirname(state.caseInput.originalProjectPath),
      bootstrapPayload: state.rubricScoringPayload,
      completeJsonPrompt: (prompt, options) =>
        deps.agentClient!.completeJsonPrompt(prompt, options),
      logger: deps.logger,
    });

    return {
      rubricAgentRunnerMode: "case_aware",
      rubricAgentRunnerResult: runnerResult,
      rubricAgentTurns: runnerResult.turns,
      rubricAgentToolTrace: runnerResult.tool_trace,
      rubricAgentRunStatus: runnerResult.final_answer ? "success" : "invalid_output",
      rubricAgentRawText: runnerResult.final_answer_raw_text ?? "",
      rubricScoringResult: runnerResult.final_answer,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger?.error(`rubric agent 评分失败 error=${message}`);
    return {
      rubricAgentRunnerMode: "case_aware",
      rubricAgentRunStatus: "failed",
      rubricAgentRawText: "",
      rubricScoringResult: undefined,
      rubricAgentTurns: [],
      rubricAgentToolTrace: [],
      rubricAgentRunnerResult: {
        outcome: "request_failed",
        failure_reason: message,
        turns: [],
        tool_trace: [],
      },
    };
  }
}
```

- [ ] **Step 4: 运行测试，确认 node 已接入 runner**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: 提交 node 改造**

```bash
git add src/nodes/rubricScoringAgentNode.ts tests/score-agent.test.ts
git commit -m "feat: run rubric scoring through case-aware runner"
```

### Task 8: 扩展中间产物落盘，保留 rubric runner 调试轨迹

**Files:**
- Modify: `src/nodes/persistAndUploadNode.ts`
- Test: `tests/score-agent.test.ts`

- [ ] **Step 1: 写失败测试，锁定 rubric turns/tool trace 会落盘**

```ts
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("persistAndUploadNode writes rubric runner trace artifacts", async () => {
  const caseDir = "/tmp/case";
  const turnsPath = path.join(caseDir, "intermediate", "rubric-agent-turns.json");
  const toolTracePath = path.join(caseDir, "intermediate", "rubric-agent-tool-trace.json");
  const resultPath = path.join(caseDir, "intermediate", "rubric-agent-result.json");

  assert.ok(await fs.readFile(turnsPath, "utf-8"));
  assert.ok(await fs.readFile(toolTracePath, "utf-8"));
  assert.ok(await fs.readFile(resultPath, "utf-8"));
});
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: FAIL，提示文件不存在

- [ ] **Step 3: 扩展落盘**

```ts
// src/nodes/persistAndUploadNode.ts
await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/rubric-agent-result.json",
  {
    status: state.rubricAgentRunStatus ?? "skipped",
    raw_text: state.rubricAgentRawText ?? "",
    result: state.rubricScoringResult ?? null,
    runner_result: state.rubricAgentRunnerResult ?? null,
  },
);

await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/rubric-agent-turns.json",
  state.rubricAgentTurns ?? [],
);

await deps.artifactStore.writeJson(
  state.caseDir,
  "intermediate/rubric-agent-tool-trace.json",
  state.rubricAgentToolTrace ?? [],
);
```

- [ ] **Step 4: 运行测试，确认中间产物齐全**

Run: `node --import tsx --test tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 5: 提交持久化扩展**

```bash
git add src/nodes/persistAndUploadNode.ts tests/score-agent.test.ts
git commit -m "feat: persist rubric runner trace artifacts"
```

### Task 9: 全量验证和收口

**Files:**
- Modify: `docs/superpowers/specs/2026-04-23-rubric-case-aware-scoring-design.md`
- Modify: `docs/superpowers/plans/2026-04-23-rubric-case-aware-scoring-implementation.md`

- [ ] **Step 1: 运行协议与 runner 相关测试**

Run: `node --import tsx --test tests/case-aware-protocol.test.ts tests/rubric-scoring.test.ts tests/rubric-case-aware-protocol.test.ts tests/rubric-case-aware-runner.test.ts tests/score-agent.test.ts`
Expected: PASS

- [ ] **Step 2: 运行构建验证**

Run: `npm run build`
Expected: exit code 0

- [ ] **Step 3: 运行全量测试**

Run: `npm test`
Expected: PASS，0 fail

- [ ] **Step 4: 自检 spec 与计划是否需要回填实现偏差**

检查项：
- 实现是否按 spec 直接复用了 `caseTools`、工具 schema、严格 JSON helper 和 repair 模式
- `deduction_trace.improvement_suggestion` 是否已进入协议、解析和测试
- 失败降级是否仍保持“满分待复核”

- [ ] **Step 5: 提交最终收口**

```bash
git add docs/superpowers/specs/2026-04-23-rubric-case-aware-scoring-design.md docs/superpowers/plans/2026-04-23-rubric-case-aware-scoring-implementation.md src tests
git commit -m "feat: add rubric case-aware scoring flow"
```
