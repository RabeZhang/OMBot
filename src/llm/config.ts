import { z } from "zod";

import { ConfigError } from "../shared/errors";
import type { LlmConfig } from "./types";

const llmEnvSchema = z.object({
  LLM_PROVIDER: z.literal("openai").default("openai"),
  LLM_MODEL_NAME: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url(),
  LLM_TEMPERATURE: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? 0.1 : Number(value)))
    .pipe(z.number().min(0).max(2)),
  LLM_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? 120000 : Number(value)))
    .pipe(z.number().int().positive()),
});

export function loadLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  // LLM 连接信息统一从环境变量读取，避免把敏感信息和模型路由写进业务配置文件。
  const result = llmEnvSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`LLM 环境配置校验失败: ${details}`);
  }

  return {
    provider: result.data.LLM_PROVIDER,
    modelName: result.data.LLM_MODEL_NAME,
    apiKey: result.data.LLM_API_KEY,
    baseUrl: result.data.LLM_BASE_URL,
    temperature: result.data.LLM_TEMPERATURE,
    timeoutMs: result.data.LLM_TIMEOUT_MS,
  };
}
