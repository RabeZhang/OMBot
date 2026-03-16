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

    it("includes prior session history for user messages", () => {
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

        const promptText = (adapter as any).buildPromptText({
            session: {
                sessionId: "sess_1",
                type: "interactive",
                status: "active",
                hostId: "local-test",
                channel: "cli",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            },
            runId: "run_1",
            input: {
                kind: "user_message",
                content: "请继续处理",
            },
            promptContext: {
                systemPrompt: "你是 OMBot",
                sessionHistory: "[当前会话历史上下文]\napproval: denied tool=write reason=写入配置文件 resolvedBy=cli",
            },
        });

        expect(promptText).toContain("[当前会话历史上下文]");
        expect(promptText).toContain("approval: denied");
        expect(promptText).toContain("请继续处理");
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
