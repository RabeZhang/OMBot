import { describe, expect, it } from "vitest";

import { PiAgentRuntimeAdapter } from "../../src/agent/pi-runtime";
import type { AgentRuntimeEvent } from "../../src/agent/types";
import { createPiModel } from "../../src/llm/pi-model";

describe("PiAgentRuntimeAdapter", () => {
    it("can be constructed with model, tools, and apiKey", () => {
        const model = createPiModel({
            provider: "openai",
            modelName: "test-model",
            apiKey: "test-key",
            baseUrl: "https://example.invalid/v1",
            temperature: 0.1,
            timeoutMs: 120000,
        });

        const adapter = new PiAgentRuntimeAdapter({
            model,
            tools: [],
            apiKey: "test-key",
        });

        expect(adapter).toBeDefined();
        expect(adapter.run).toBeDefined();
        expect(typeof adapter.run).toBe("function");
    });
});

describe("createPiModel", () => {
    it("creates a Model with openai-completions api type", () => {
        const model = createPiModel({
            provider: "openai",
            modelName: "deepseek-chat",
            apiKey: "test-key",
            baseUrl: "https://api.deepseek.com/v1",
            temperature: 0.1,
            timeoutMs: 120000,
        });

        expect(model.id).toBe("deepseek-chat");
        expect(model.name).toBe("deepseek-chat");
        expect(model.api).toBe("openai-completions");
        expect(model.provider).toBe("openai");
        expect(model.baseUrl).toBe("https://api.deepseek.com/v1");
        expect(model.reasoning).toBe(false);
        expect(model.input).toContain("text");
    });
});
