export interface LlmConfig {
  provider: "openai";
  modelName: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  timeoutMs: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmGenerateTextInput {
  messages: LlmMessage[];
}

export interface LlmGenerateTextResult {
  content: string;
}

// LLM 能力后续无论换 provider 还是换 Agent Runtime，都通过这层接口解耦。
export interface LlmClient {
  getConfig(): LlmConfig;
  generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult>;
}
