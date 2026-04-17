import type { AgentPromptPayload } from "../types.js";

export interface AgentClient {
  evaluateRules(input: { prompt: string; payload: AgentPromptPayload }): Promise<string>;
}

export interface ChatModelClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface CompletionResponse {
  ok: boolean;
  status: number;
  bodyText: string;
}

export class ChatModelClient implements AgentClient {
  constructor(private readonly options: ChatModelClientOptions) {}

  async evaluateRules(input: { prompt: string; payload: AgentPromptPayload }): Promise<string> {
    const requestBody = {
      model: this.options.model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
      response_format: { type: "json_object" },
    };

    let response = await this.requestCompletion(requestBody);
    if (this.shouldRetryWithoutStructuredOutput(response)) {
      const { response_format: _ignored, ...fallbackBody } = requestBody;
      response = await this.requestCompletion(fallbackBody);
    }

    return this.extractMessageContent(response);
  }

  private async requestCompletion(body: Record<string, unknown>): Promise<CompletionResponse> {
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

  private shouldRetryWithoutStructuredOutput(response: CompletionResponse): boolean {
    if (response.ok || response.status !== 400) {
      return false;
    }

    const normalized = response.bodyText.toLowerCase();
    const mentionsUnsupportedParameter =
      normalized.includes("unknown parameter") || normalized.includes("unsupported parameter");
    const mentionsStructuredOutput =
      normalized.includes("response_format") || normalized.includes("text.format");
    return mentionsUnsupportedParameter && mentionsStructuredOutput;
  }

  private extractMessageContent(response: CompletionResponse): string {
    if (!response.ok) {
      throw new Error(`Agent 调用失败，HTTP ${response.status}，响应：${response.bodyText}`);
    }

    let data: {
      choices?: Array<{
        message?: {
          content?: string | Array<{ type?: string; text?: string }>;
        };
      }>;
    };
    try {
      data = JSON.parse(response.bodyText) as {
        choices?: Array<{
          message?: {
            content?: string | Array<{ type?: string; text?: string }>;
          };
        }>;
      };
    } catch (error) {
      throw new Error(`Agent 返回了无效 JSON，HTTP ${response.status}，响应：${response.bodyText}`, {
        cause: error,
      });
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      const textContent = content
        .filter(
          (item): item is { type: "text" | "output_text"; text: string } =>
            (item.type === "text" || item.type === "output_text") && typeof item.text === "string",
        )
        .map((item) => item.text)
        .join("")
        .trim();

      if (textContent.length > 0) {
        return textContent;
      }
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

  return new ChatModelClient({
    baseUrl: config.modelProviderBaseUrl,
    apiKey: config.modelProviderApiKey,
    model: config.modelProviderModel ?? "gpt-5.4",
  });
}
