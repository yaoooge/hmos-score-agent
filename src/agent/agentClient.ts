import type { AgentPromptPayload } from "../types.js";

export interface AgentClient {
  evaluateRules(input: { prompt: string; payload: AgentPromptPayload }): Promise<string>;
}

export interface CompatibleChatModelClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// CompatibleChatModelClient 负责调用兼容 chat completions 的模型服务接口。
export class CompatibleChatModelClient implements AgentClient {
  constructor(private readonly options: CompatibleChatModelClientOptions) {}

  async evaluateRules(input: { prompt: string; payload: AgentPromptPayload }): Promise<string> {
    const baseRequest = {
      model: this.options.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
    };

    const firstAttempt = await this.requestCompletion({
      ...baseRequest,
      response_format: { type: "json_object" },
    });
    if (!firstAttempt.ok && this.shouldRetryWithoutResponseFormat(firstAttempt.bodyText)) {
      const fallbackAttempt = await this.requestCompletion(baseRequest);
      return this.extractMessageContent(fallbackAttempt);
    }

    return this.extractMessageContent(firstAttempt);
  }

  private async requestCompletion(body: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    bodyText: string;
  }> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      bodyText: await response.text(),
    };
  }

  private shouldRetryWithoutResponseFormat(bodyText: string): boolean {
    return /Unknown parameter: 'text\.format\.name'/.test(bodyText) || /response_format/i.test(bodyText);
  }

  private extractMessageContent(response: { ok: boolean; status: number; bodyText: string }): string {
    if (!response.ok) {
      throw new Error(`Agent 调用失败，HTTP ${response.status}，响应：${response.bodyText}`);
    }

    const data = JSON.parse(response.bodyText) as {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((item) => (typeof item.text === "string" ? item.text : ""))
        .join("")
        .trim();
    }
    throw new Error("Agent 返回内容缺失。");
  }
}

export function createDefaultAgentClient(config: {
  modelProviderBaseUrl?: string;
  modelProviderApiKey?: string;
  modelProviderModel?: string;
}): AgentClient | undefined {
  if (!config.modelProviderBaseUrl || !config.modelProviderApiKey) {
    return undefined;
  }

  return new CompatibleChatModelClient({
    baseUrl: config.modelProviderBaseUrl,
    apiKey: config.modelProviderApiKey,
    model: config.modelProviderModel ?? "gpt-5.4",
  });
}
