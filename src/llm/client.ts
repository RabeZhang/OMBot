import type { LlmClient, LlmConfig, LlmGenerateTextInput, LlmGenerateTextResult } from "./types";

interface OpenAiCompatibleMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAiCompatibleChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBaseUrl}/chat/completions`;
}

export class OpenAiCompatibleLlmClient implements LlmClient {
  private readonly config: LlmConfig;

  constructor(config: LlmConfig) {
    this.config = config;
  }

  getConfig(): LlmConfig {
    return this.config;
  }

  async generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult> {
    // Phase 1 先走最小的 OpenAI-compatible chat completions 协议，后续再扩展 tool use / streaming。
    const response = await fetch(buildChatCompletionsUrl(this.config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        messages: input.messages satisfies OpenAiCompatibleMessage[],
        temperature: this.config.temperature,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    const payload = (await response.json()) as OpenAiCompatibleChatCompletionResponse;

    if (!response.ok) {
      const message = payload.error?.message ?? `LLM 请求失败，状态码: ${response.status}`;
      throw new Error(message);
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("LLM 返回内容为空");
    }

    return {
      content,
    };
  }
}

export function createLlmClient(config: LlmConfig): LlmClient {
  return new OpenAiCompatibleLlmClient(config);
}
