/**
 * 直接测试 pi-agent-core + deepseek-chat 的 function calling 能力。
 * 用法: npx tsx /tmp/test-tool-call.ts
 */
import { loadProjectEnv } from "../src/config/dotenv";
loadProjectEnv(process.cwd());

import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { Model } from "@mariozechner/pi-ai";

const model: Model<"openai-completions"> = {
    id: process.env.LLM_MODEL_NAME!,
    name: process.env.LLM_MODEL_NAME!,
    api: "openai-completions",
    provider: "openai",
    baseUrl: process.env.LLM_BASE_URL!,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 64000,
    maxTokens: 8192,
};

const testTool: AgentTool = {
    name: "get_cpu_usage",
    label: "获取 CPU 使用率",
    description: "获取当前系统的 CPU 负载和估算占用率",
    parameters: Type.Object({}),
    async execute(_toolCallId: string, _params: any) {
        console.log("[TOOL CALLED] get_cpu_usage was invoked!");
        return {
            content: [{ type: "text" as const, text: JSON.stringify({ coreCount: 8, loadAverage1m: 1.9, estimatedUsagePercent: 23.8 }) }],
            details: {},
        };
    },
};

const agent = new Agent({
    initialState: {
        systemPrompt: "你是 OMBot，一个服务器运维监控助手。当用户询问系统相关信息时，你必须使用提供的工具来获取实时数据，不要凭空编造。",
        model,
        tools: [testTool],
    },
    convertToLlm: (messages: any) => messages.filter(
        (m: any) => "role" in m && ["user", "assistant", "toolResult"].includes(m.role),
    ),
    getApiKey: async () => process.env.LLM_API_KEY!,
});

agent.subscribe((event: AgentEvent) => {
    if (event.type === "tool_execution_start") {
        console.log(`[EVENT] tool_execution_start: ${event.toolName}`);
    } else if (event.type === "tool_execution_end") {
        console.log(`[EVENT] tool_execution_end: ${event.toolName} isError=${event.isError}`);
    } else if (event.type === "message_end") {
        const msg = event.message as any;
        if (msg?.role === "assistant") {
            const text = (msg.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
            const toolCalls = (msg.content ?? []).filter((c: any) => c.type === "toolCall");
            console.log(`[EVENT] assistant message_end: text="${text.slice(0, 100)}" toolCalls=${toolCalls.length}`);
        }
    } else {
        console.log(`[EVENT] ${event.type}`);
    }
});

async function main() {
    console.log("--- Model:", model.id, "API:", model.api, "---");
    console.log("--- Prompting: 帮我看看 CPU 使用情况 ---\n");
    await agent.prompt("帮我看看 CPU 使用情况");
    await agent.waitForIdle();
    console.log("\n--- Done. Messages:", agent.state.messages.length, "---");
}

main().catch(console.error);
