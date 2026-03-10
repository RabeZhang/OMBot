import type { Model } from "@mariozechner/pi-ai";

import type { LlmConfig } from "./types";

/**
 * 根据 OMBot 的 LlmConfig 构造 pi-ai Model 对象。
 *
 * deepseek-chat 走 OpenAI-compatible completions 协议，
 * 对应 pi-ai 的 "openai-completions" api type。
 */
export function createPiModel(config: LlmConfig): Model<"openai-completions"> {
  return {
    id: config.modelName,
    name: config.modelName,
    api: "openai-completions",
    provider: config.provider,
    baseUrl: config.baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64000,
    maxTokens: 8192,
  };
}
