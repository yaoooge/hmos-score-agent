import assert from "node:assert/strict";
import test from "node:test";
import { runOpencodeTaskUnderstanding } from "../src/agents/runners/opencodeTaskUnderstanding.js";
import type { TaskUnderstandingAgentInput } from "../src/types.js";

function input(): TaskUnderstandingAgentInput {
  return {
    caseId: "case-1",
    promptText: "修复登录按钮无响应问题",
    originalProjectPath: "/case/original",
    generatedProjectPath: "/case/generated",
    originalProjectProvided: true,
    taskType: "bug_fix",
    projectStructure: {
      rootPath: "/case/generated",
      topLevelEntries: ["entry"],
      modulePaths: ["entry"],
      implementationHints: ["技术栈: ArkTS/ETS 页面与组件实现"],
      omittedFileCount: 0,
    },
    patchSummary: {
      hasPatch: true,
      changedFiles: ["entry/src/main.ets"],
      affectedRoots: ["entry"],
      addedLines: 4,
      deletedLines: 1,
      changeTypes: ["modified"],
      intrusionLevel: "low",
      rawPatchLength: 120,
    },
  };
}

function inputWithLongPrompt(): TaskUnderstandingAgentInput {
  return {
    ...input(),
    promptText: "LONG_PRODUCT_REQUIREMENT_SHOULD_NOT_APPEAR_IN_RETRY_PROMPT".repeat(50),
  };
}

function notInvolvedCrossDevice() {
  return {
    applicability: "not_involved",
    confidence: "high",
    reasons: ["需求未出现多设备、多屏或设备形态适配要求"],
  };
}

test("runOpencodeTaskUnderstanding returns ConstraintSummary from opencode output", async () => {
  let prompt = "";
  let requestTag = "";
  let title = "";
  let agent = "";
  let outputFile = "";
  const sandboxRoot = "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox";
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot,
    agentInput: input(),
    runPrompt: async (request) => {
      prompt = request.prompt;
      requestTag = request.requestTag;
      title = request.title ?? "";
      agent = request.agent ?? "";
      outputFile = request.outputFile ?? "";
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify({
          explicitConstraints: ["修复登录按钮无响应问题"],
          contextualConstraints: ["ArkTS 页面实现"],
          implicitConstraints: ["低侵入修改"],
          classificationHints: ["bug_fix", "has_patch"],
          crossDeviceAdaptation: notInvolvedCrossDevice(),
        }),
        elapsedMs: 5,
      };
    },
  });

  assert.equal(prompt.includes("tool" + "_call"), false);
  assert.match(prompt, /执行任务前必须使用 hmos-understanding skill/);
  assert.match(prompt, /该 skill 中的输出契约和自检清单是本次输出的强制要求/);
  assert.match(prompt, /任务理解阶段只能读取用户消息指定的 prompt 文件/);
  assert.match(prompt, /agent_input\.taskType 是上游固定任务类型/);
  assert.match(prompt, /不得重新识别或改写任务类型/);
  assert.match(prompt, /"taskType": "bug_fix"/);
  assert.match(prompt, /只能基于本 prompt 中的 agent_input/);
  assert.match(prompt, /不要调用 glob、grep、list 或任何用于探索工程文件的工具/);
  assert.match(prompt, /不要读取 generated\//);
  assert.match(prompt, /不要读取 original\//);
  assert.match(prompt, /不要读取 patch\//);
  assert.match(prompt, /不要读取 references\//);
  assert.match(prompt, /JSON 字符串中的英文双引号必须转义/);
  assert.match(prompt, /先改写为不含双引号的中文转述/);
  assert.doesNotMatch(prompt, /representativeFiles/);
  assert.doesNotMatch(prompt, /代表文件/);
  assert.match(prompt, /output_file: metadata\/agent-output\/task-understanding\.json/);
  assert.doesNotMatch(prompt, /第一步只读取 patch\/effective\.patch/);
  assert.doesNotMatch(prompt, /第二步只按 patch 和 metadata 指向的相关文件读取上下文/);
  assert.equal(requestTag, "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(title, requestTag);
  assert.equal(agent, "hmos-understanding");
  assert.equal(outputFile, "metadata/agent-output/task-understanding.json");
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.summary?.classificationHints, ["bug_fix", "has_patch"]);
  assert.equal(result.summary?.crossDeviceAdaptation.applicability, "not_involved");
  assert.equal(result.raw_events, "{}\n");
});

test("runOpencodeTaskUnderstanding prompt requires cross-device adaptation judgement", async () => {
  let prompt = "";
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: {
      ...input(),
      promptText: "请适配手机和平板双端展示",
    },
    runPrompt: async (request) => {
      prompt = request.prompt;
      return {
        requestTag: request.requestTag,
        rawEvents: "",
        rawText: JSON.stringify({
          explicitConstraints: ["目标: 适配手机和平板双端展示"],
          contextualConstraints: ["ArkTS 页面实现"],
          implicitConstraints: ["布局适配"],
          classificationHints: ["full_generation", "multi_device_adaptation"],
          crossDeviceAdaptation: {
            applicability: "involved",
            confidence: "high",
            reasons: ["需求明确要求手机和平板布局适配"],
          },
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.match(prompt, /crossDeviceAdaptation/);
  assert.match(prompt, /多设备适配/);
  assert.equal(result.summary?.crossDeviceAdaptation.applicability, "involved");
});

test("runOpencodeTaskUnderstanding rejects invalid constraint summary", async () => {
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/sandbox/case",
    agentInput: input(),
    runPrompt: async (request) => ({
      requestTag: request.requestTag,
      rawEvents: "",
      rawText: JSON.stringify({
        explicitConstraints: ["ok"],
        contextualConstraints: [],
        implicitConstraints: [],
      }),
      elapsedMs: 1,
    }),
  });

  assert.equal(result.outcome, "protocol_error");
  assert.match(result.failure_reason ?? "", /classificationHints/);
});

test("runOpencodeTaskUnderstanding retries once with strict output format after protocol error", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: input(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, title: request.title, prompt: request.prompt });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText:
          calls.length === 1
            ? "我已经理解任务，但这里不是 JSON。"
            : JSON.stringify({
                explicitConstraints: ["修复登录按钮无响应问题"],
                contextualConstraints: ["ArkTS 页面实现"],
                implicitConstraints: ["低侵入修改"],
                classificationHints: ["bug_fix", "has_patch"],
                crossDeviceAdaptation: notInvolvedCrossDevice(),
              }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0]?.requestTag,
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a",
  );
  assert.equal(
    calls[1]?.requestTag,
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  );
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /上一次任务理解输出无效/);
  assert.match(calls[1]?.prompt ?? "", /本次是重试。仍必须使用 hmos-understanding skill/);
  assert.match(calls[1]?.prompt ?? "", /只修正最终输出格式/);
  assert.match(calls[1]?.prompt ?? "", /最终输出不是唯一 JSON object/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /最终答案的第一个非空字符必须是 \{/);
  assert.match(calls[1]?.prompt ?? "", /本次重试禁止读取任何业务文件/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /本次重试禁止读取任何文件/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /agent_input:/);
  assert.match(calls[1]?.prompt ?? "", /只根据 constraint_draft 输出最终 JSON/);
  assert.match(calls[1]?.prompt ?? "", /固定任务类型: bug_fix/);
  assert.match(calls[1]?.prompt ?? "", /explicitConstraints/);
  assert.match(calls[1]?.prompt ?? "", /classificationHints/);
  assert.match(calls[1]?.prompt ?? "", /crossDeviceAdaptation/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /representativeFiles/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /代表文件/);
});

test("runOpencodeTaskUnderstanding succeeds on the second retry after repeated protocol errors", async () => {
  const calls: string[] = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: input(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText:
          calls.length < 3
            ? "不是合法 JSON"
            : JSON.stringify({
                explicitConstraints: ["修复登录按钮无响应问题"],
                contextualConstraints: ["ArkTS 页面实现"],
                implicitConstraints: ["低侵入修改"],
                classificationHints: ["bug_fix", "has_patch"],
                crossDeviceAdaptation: notInvolvedCrossDevice(),
              }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(calls, [
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});

test("runOpencodeTaskUnderstanding retry prompt omits raw agent input", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: inputWithLongPrompt(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, title: request.title, prompt: request.prompt });
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText:
          calls.length === 1
            ? "不是 JSON"
            : JSON.stringify({
                explicitConstraints: ["任务类型: 倾向 bug_fix 或 continuation"],
                contextualConstraints: ["ArkTS 页面实现"],
                implicitConstraints: ["低侵入修改"],
                classificationHints: ["bug_fix", "has_patch"],
                crossDeviceAdaptation: notInvolvedCrossDevice(),
              }),
        elapsedMs: 1,
      };
    },
  });

  const retryPrompt = calls[1]?.prompt ?? "";
  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.doesNotMatch(retryPrompt, /agent_input:/);
  assert.doesNotMatch(retryPrompt, /promptText/);
  assert.doesNotMatch(retryPrompt, /LONG_PRODUCT_REQUIREMENT_SHOULD_NOT_APPEAR_IN_RETRY_PROMPT/);
  assert.doesNotMatch(retryPrompt, /Sandbox 根目录/);
  assert.doesNotMatch(retryPrompt, /stdoutBytes/);
  assert.match(retryPrompt, /constraint_draft/);
  assert.match(retryPrompt, /只根据 constraint_draft 输出最终 JSON/);
  assert.match(retryPrompt, /crossDeviceAdaptation/);
});

test("runOpencodeTaskUnderstanding retries once with strict output format after request failure", async () => {
  const calls: Array<{ requestTag: string; title?: string; prompt: string }> = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: input(),
    runPrompt: async (request) => {
      calls.push({ requestTag: request.requestTag, title: request.title, prompt: request.prompt });
      if (calls.length === 1) {
        throw new Error("opencode 输出中缺少 assistant 最终文本");
      }
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify({
          explicitConstraints: ["修复登录按钮无响应问题"],
          contextualConstraints: ["ArkTS 页面实现"],
          implicitConstraints: ["低侵入修改"],
          classificationHints: ["bug_fix", "has_patch"],
          crossDeviceAdaptation: notInvolvedCrossDevice(),
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1]?.requestTag,
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  );
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /上一次任务理解输出无效/);
  assert.match(calls[1]?.prompt ?? "", /本次是重试。仍必须使用 hmos-understanding skill/);
  assert.match(calls[1]?.prompt ?? "", /缺少 assistant 最终文本/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.match(calls[1]?.prompt ?? "", /本次重试禁止读取任何业务文件/);
  assert.match(calls[1]?.prompt ?? "", /禁止调用 glob、grep、list 或任何用于探索工程文件的工具/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /禁止调用 read、glob、grep、find 或任何工具/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /agent_input:/);
});

test("runOpencodeTaskUnderstanding retries once after initial opencode timeout", async () => {
  const calls: string[] = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: input(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      if (calls.length === 1) {
        throw new Error(`opencode 调用超时 request=${request.requestTag}`);
      }
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify({
          explicitConstraints: ["修复登录按钮无响应问题"],
          contextualConstraints: ["ArkTS 页面实现"],
          implicitConstraints: ["低侵入修改"],
          classificationHints: ["bug_fix", "has_patch"],
          crossDeviceAdaptation: notInvolvedCrossDevice(),
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(calls, [
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
  ]);
});

test("runOpencodeTaskUnderstanding succeeds on the second retry after an initial timeout", async () => {
  const calls: string[] = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: input(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      if (calls.length < 3) {
        throw new Error(`opencode 调用超时 request=${request.requestTag}`);
      }
      return {
        requestTag: request.requestTag,
        rawEvents: "{}\n",
        rawText: JSON.stringify({
          explicitConstraints: ["修复登录按钮无响应问题"],
          contextualConstraints: ["ArkTS 页面实现"],
          implicitConstraints: ["低侵入修改"],
          classificationHints: ["bug_fix", "has_patch"],
          crossDeviceAdaptation: notInvolvedCrossDevice(),
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.deepEqual(calls, [
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});

test("runOpencodeTaskUnderstanding fails when both retries also time out", async () => {
  const calls: string[] = [];
  const result = await runOpencodeTaskUnderstanding({
    sandboxRoot: "/runs/20260427T031830_full_generation_8a3c0a1a/opencode-sandbox",
    agentInput: input(),
    runPrompt: async (request) => {
      calls.push(request.requestTag);
      throw new Error(`opencode 调用超时 request=${request.requestTag}`);
    },
  });

  assert.equal(result.outcome, "request_failed");
  assert.match(result.failure_reason ?? "", /opencode 调用超时/);
  assert.deepEqual(calls, [
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1",
    "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-2",
  ]);
});
