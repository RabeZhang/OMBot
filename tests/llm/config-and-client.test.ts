import http from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { createLlmClient } from "../../src/llm/client";
import { loadLlmConfigFromEnv } from "../../src/llm/config";
import { ConfigError } from "../../src/shared/errors";

afterEach(() => {
  delete process.env.LLM_MODEL_NAME;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_TEMPERATURE;
  delete process.env.LLM_TIMEOUT_MS;
});

describe("loadLlmConfigFromEnv", () => {
  it("loads llm config from environment variables", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL_NAME = "gpt-4o-mini";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_TEMPERATURE = "0.3";
    process.env.LLM_TIMEOUT_MS = "45000";

    const config = loadLlmConfigFromEnv();

    expect(config.provider).toBe("openai");
    expect(config.modelName).toBe("gpt-4o-mini");
    expect(config.apiKey).toBe("test-key");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.temperature).toBe(0.3);
    expect(config.timeoutMs).toBe(45000);
  });

  it("uses defaults for optional llm settings", () => {
    process.env.LLM_MODEL_NAME = "gpt-4o";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";

    const config = loadLlmConfigFromEnv();

    expect(config.provider).toBe("openai");
    expect(config.temperature).toBe(0.1);
    expect(config.timeoutMs).toBe(120000);
  });

  it("throws when required llm env vars are missing", () => {
    expect(() => loadLlmConfigFromEnv()).toThrow(ConfigError);
    expect(() => loadLlmConfigFromEnv()).toThrow("LLM 环境配置校验失败");
  });
});

describe("createLlmClient", () => {
  it("creates a client that exposes normalized config", () => {
    const client = createLlmClient({
      provider: "openai",
      modelName: "gpt-4o",
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0.1,
      timeoutMs: 120000,
    });

    expect(client.getConfig().modelName).toBe("gpt-4o");
  });

  it("sends chat completion request to openai-compatible endpoint", async () => {
    let receivedAuth = "";
    let receivedBody = "";

    const server = http.createServer(async (request, response) => {
      receivedAuth = request.headers.authorization ?? "";

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      receivedBody = Buffer.concat(chunks).toString("utf8");

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "这是 mock LLM 的返回",
              },
            },
          ],
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const client = createLlmClient({
        provider: "openai",
        modelName: "gpt-4o-mini",
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${port}`,
        temperature: 0.2,
        timeoutMs: 120000,
      });

      const result = await client.generateText({
        messages: [
          { role: "system", content: "你是测试助手" },
          { role: "user", content: "你好" },
        ],
      });

      expect(result.content).toBe("这是 mock LLM 的返回");
      expect(receivedAuth).toBe("Bearer test-key");
      expect(receivedBody).toContain('"model":"gpt-4o-mini"');
      expect(receivedBody).toContain('"stream":false');
      expect(receivedBody).toContain('"content":"你好"');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
