import assert from "node:assert/strict";
import test from "node:test";
import { runOpencodeTaskUnderstanding } from "../src/agent/opencodeTaskUnderstanding.js";
import type { TaskUnderstandingAgentInput } from "../src/types.js";

function input(): TaskUnderstandingAgentInput {
  return {
    caseId: "case-1",
    promptText: "修复登录按钮无响应问题",
    originalProjectPath: "/case/original",
    generatedProjectPath: "/case/generated",
    originalProjectProvided: true,
    projectStructure: {
      rootPath: "/case/generated",
      topLevelEntries: ["entry"],
      modulePaths: ["entry"],
      representativeFiles: ["entry/src/main.ets"],
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
        }),
        elapsedMs: 5,
      };
    },
  });

  assert.equal(prompt.includes("tool" + "_call"), false);
  assert.match(prompt, /任务理解阶段只能读取用户消息指定的 prompt 文件/);
  assert.match(prompt, /只能基于本 prompt 中的 agent_input/);
  assert.match(prompt, /不要调用 glob、grep、list 或任何用于探索工程文件的工具/);
  assert.match(prompt, /不要读取 generated\//);
  assert.match(prompt, /不要读取 original\//);
  assert.match(prompt, /不要读取 patch\//);
  assert.match(prompt, /不要读取 references\//);
  assert.match(prompt, /output_file: metadata\/agent-output\/task-understanding\.json/);
  assert.doesNotMatch(prompt, /第一步只读取 patch\/effective\.patch/);
  assert.doesNotMatch(prompt, /第二步只按 patch 和 metadata 指向的相关文件读取上下文/);
  assert.equal(requestTag, "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(title, requestTag);
  assert.equal(agent, "hmos-understanding");
  assert.equal(outputFile, "metadata/agent-output/task-understanding.json");
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.summary?.classificationHints, ["bug_fix", "has_patch"]);
  assert.equal(result.raw_events, "{}\n");
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
              }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.requestTag, "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a");
  assert.equal(calls[1]?.requestTag, "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1");
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /上一次任务理解输出无效/);
  assert.match(calls[1]?.prompt ?? "", /最终输出不是唯一 JSON object/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /最终答案的第一个非空字符必须是 \{/);
  assert.match(calls[1]?.prompt ?? "", /本次重试禁止读取任何业务文件/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /本次重试禁止读取任何文件/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /agent_input:/);
  assert.match(calls[1]?.prompt ?? "", /只根据 constraint_draft 输出最终 JSON/);
  assert.match(calls[1]?.prompt ?? "", /explicitConstraints/);
  assert.match(calls[1]?.prompt ?? "", /classificationHints/);
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
        }),
        elapsedMs: 1,
      };
    },
  });

  assert.equal(result.outcome, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.requestTag, "task-understanding-case-1-20260427T031830_full_generation_8a3c0a1a-retry-1");
  assert.equal(calls[1]?.title, calls[1]?.requestTag);
  assert.match(calls[1]?.prompt ?? "", /上一次任务理解输出无效/);
  assert.match(calls[1]?.prompt ?? "", /缺少 assistant 最终文本/);
  assert.match(calls[1]?.prompt ?? "", /严格遵守 system prompt 中的正确输出格式/);
  assert.match(calls[1]?.prompt ?? "", /本次重试禁止读取任何业务文件/);
  assert.match(calls[1]?.prompt ?? "", /禁止调用 glob、grep、list 或任何用于探索工程文件的工具/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /禁止调用 read、glob、grep、find 或任何工具/);
  assert.doesNotMatch(calls[1]?.prompt ?? "", /agent_input:/);
});
