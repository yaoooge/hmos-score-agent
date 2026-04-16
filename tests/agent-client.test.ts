import assert from "node:assert/strict";
import test from "node:test";
import { CompatibleChatModelClient, createDefaultAgentClient } from "../src/agent/agentClient.js";

test("CompatibleChatModelClient retries without response_format when compatible endpoint rejects it", async () => {
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
            message:
              'Request failed with status 400: {\n  "error": {\n    "message": "Unknown parameter: \'text.format.name\'.",\n    "type": "invalid_request_error"\n  }\n}',
            type: "invalid_request_error",
          },
          type: "error",
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
    const client = new CompatibleChatModelClient({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-5.4",
    });

    const result = await client.evaluateRules({
      prompt: "请仅输出 JSON",
      payload: {
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
        },
      },
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.body.response_format !== undefined, true);
    assert.equal(calls[1]?.body.response_format, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createDefaultAgentClient reads provider-neutral config keys only", () => {
  const client = createDefaultAgentClient({
    modelProviderBaseUrl: "https://provider.example/v1",
    modelProviderApiKey: "provider-key",
    modelProviderModel: "gpt-5.4",
  });

  assert.ok(client);
  assert.equal(
    createDefaultAgentClient({
      modelProviderBaseUrl: undefined,
      modelProviderApiKey: "provider-key",
      modelProviderModel: "gpt-5.4",
    }),
    undefined,
  );
});
