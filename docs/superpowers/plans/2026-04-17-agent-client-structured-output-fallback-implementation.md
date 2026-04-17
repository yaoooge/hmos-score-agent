# Agent Client Structured Output Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-time fallback retry in the chat completions agent client when a provider rejects `response_format`, so scoring can still obtain agent output.

**Architecture:** Keep the existing `/chat/completions` contract and optimistic structured-output request. Detect parameter-compatibility 400 responses in the client, retry once without `response_format`, and leave all other failures unchanged.

**Tech Stack:** TypeScript, Node.js built-in test runner, fetch API

---

### Task 1: Lock fallback behavior with tests

**Files:**
- Modify: `tests/agent-client.test.ts`
- Test: `tests/agent-client.test.ts`

- [ ] **Step 1: Write the failing fallback test**

```ts
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
        choices: [{ message: { content: "{\"ok\":true}" } }],
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

    assert.equal(result, "{\"ok\":true}");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0]?.body.response_format, { type: "json_object" });
    assert.equal("response_format" in (calls[1]?.body ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: FAIL because `ChatModelClient` throws on the first 400 response and never performs the second request

- [ ] **Step 3: Write the non-retriable 400 regression test**

```ts
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

    await assert.rejects(() =>
      client.evaluateRules({
        prompt: "请仅输出 JSON",
        payload: createPayload(),
      }),
    );
    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 4: Run test to verify the suite still has a single focused failure**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: FAIL on the fallback test, while the unrelated-400 test passes

### Task 2: Implement one-time compatibility fallback

**Files:**
- Modify: `src/agent/agentClient.ts`
- Test: `tests/agent-client.test.ts`

- [ ] **Step 1: Add a helper to detect parameter-compatibility 400 responses**

```ts
private shouldRetryWithoutStructuredOutput(response: {
  ok: boolean;
  status: number;
  bodyText: string;
}): boolean {
  if (response.ok || response.status !== 400) {
    return false;
  }

  const normalized = response.bodyText.toLowerCase();
  return (
    normalized.includes("unknown parameter") &&
    (normalized.includes("response_format") || normalized.includes("text.format"))
  );
}
```

- [ ] **Step 2: Retry `evaluateRules` once without `response_format`**

```ts
const requestBody = {
  model: this.options.model,
  temperature: 0,
  messages: [{ role: "user", content: input.prompt }],
  response_format: { type: "json_object" },
};

let response = await this.requestCompletion(requestBody);
if (this.shouldRetryWithoutStructuredOutput(response)) {
  const { response_format: _ignored, ...fallbackBody } = requestBody;
  response = await this.requestCompletion(fallbackBody);
}
```

- [ ] **Step 3: Keep response parsing unchanged**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: PASS

### Task 3: Verify in the real scoring flow

**Files:**
- Modify: `src/agent/agentClient.ts`
- Test: `tests/agent-client.test.ts`

- [ ] **Step 1: Run the focused agent client test suite**

Run: `node --import tsx --test tests/agent-client.test.ts`
Expected: PASS

- [ ] **Step 2: Rerun one scoring round**

Run: `npm run score -- --case init-input`
Expected: agent-assisted node no longer fails with `Unknown parameter: 'text.format.name'`

- [ ] **Step 3: Inspect the latest run output**

Run: `rg -n "agent 调用失败|评分完成|结果目录" .local-cases/*/logs/run.log`
Expected: latest run contains completion logs without the previous parameter-compatibility error
