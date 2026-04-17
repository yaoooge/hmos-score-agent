import assert from "node:assert/strict";
import test from "node:test";
import { ChatModelClient, createDefaultAgentClient } from "../src/agent/agentClient.js";

function createPayload() {
  return {
    case_context: {
      case_id: "case-1",
      task_type: "bug_fix",
      original_prompt_summary: "修复页面问题",
      has_patch: true,
      project_paths: {
        original_project_path: "/tmp/original",
        generated_project_path: "/tmp/workspace",
      },
    },
    task_understanding: {
      explicitConstraints: [],
      contextualConstraints: [],
      implicitConstraints: [],
      classificationHints: [],
    },
    rubric_summary: {
      task_type: "bug_fix",
      evaluation_mode: "auto_precheck_with_human_review",
      scenario: "用户提供 Bug 修复 diff、修复前后代码、问题描述与修复结果，目标是评价修复是否命中问题且控制侵入范围。",
      scoring_method: "discrete_band",
      scoring_note: "二级指标按离散档位给分。",
      common_risks: [],
      report_emphasis: [],
      dimension_summaries: [],
      hard_gates: [],
      review_rule_summary: [],
    },
    deterministic_rule_results: [],
    assisted_rule_candidates: [],
    response_contract: {
      output_language: "zh-CN",
      json_only: true,
      fallback_rule: "不确定时必须返回 needs_human_review=true",
      required_top_level_fields: ["summary", "rule_assessments"],
      summary_schema: {
        assistant_scope: "string",
        overall_confidence: ["high", "medium", "low"],
      },
      rule_assessment_schema: {
        required_fields: ["rule_id", "decision", "confidence", "reason", "evidence_used", "needs_human_review"],
        decision_enum: ["violation", "pass", "not_applicable", "uncertain"],
        confidence_enum: ["high", "medium", "low"],
      },
    },
  };
}

test("ChatModelClient sends one request with response_format and returns the first response body", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    calls.push({ url: String(url), body });

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"ok":true}',
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const result = await client.evaluateRules({
      prompt: "请仅输出 JSON",
      payload: createPayload(),
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.body.response_format, { type: "json_object" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatModelClient retries once without response_format when provider rejects structured output parameters", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    calls.push({ url: String(url), body });

    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          error: {
            message: "Unknown parameter: 'text.format.name'.",
            type: "invalid_request_error",
            param: "text.format.name",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{"ok":true}',
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const result = await client.evaluateRules({
      prompt: "请仅输出 JSON",
      payload: createPayload(),
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]?.body.response_format, { type: "json_object" });
    assert.equal("response_format" in (calls[1]?.body ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatModelClient does not retry unrelated 400 responses", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response(
      JSON.stringify({
        error: {
          message: "Invalid request body.",
          type: "invalid_request_error",
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    await assert.rejects(
      () =>
        client.evaluateRules({
          prompt: "请仅输出 JSON",
          payload: createPayload(),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid request body/);
        return true;
      },
    );
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatModelClient extracts only text-bearing content parts from array-form responses", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                { type: "reasoning", text: "internal-thought" },
                { type: "output_text", text: '{"ok":' },
                { type: "output_text", text: "true}" },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const result = await client.evaluateRules({
      prompt: "请仅输出 JSON",
      payload: createPayload(),
    });

    assert.equal(result, '{"ok":true}');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatModelClient fails when array-form content has no text-bearing parts", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [{ type: "reasoning", text: "internal-thought" }],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    await assert.rejects(
      () =>
        client.evaluateRules({
          prompt: "请仅输出 JSON",
          payload: createPayload(),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Agent 返回内容缺失/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ChatModelClient includes HTTP status and body when a 200 response contains malformed JSON", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

  try {
    const client = new ChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    await assert.rejects(
      () =>
        client.evaluateRules({
          prompt: "请仅输出 JSON",
          payload: createPayload(),
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /HTTP 200/);
        assert.match(error.message, /not-json/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createDefaultAgentClient constructs ChatModelClient", () => {
  const client = createDefaultAgentClient({
    modelProviderBaseUrl: "https://provider.example/v1",
    modelProviderApiKey: "provider-key",
    modelProviderModel: "gpt-5.4",
  });

  assert.ok(client instanceof ChatModelClient);
});
