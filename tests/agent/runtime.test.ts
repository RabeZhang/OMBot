import { describe, expect, it } from "vitest";

import { LlmAgentRuntimeAdapter } from "../../src/agent/runtime";
import type { AgentRuntimeEvent } from "../../src/agent/types";
import type { LlmClient } from "../../src/llm/types";
import { ConfigDrivenToolPolicy } from "../../src/tools/policy";
import { InMemoryToolRegistry } from "../../src/tools/registry";

async function collectEvents(stream: AsyncIterable<AgentRuntimeEvent>) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("LlmAgentRuntimeAdapter", () => {
  it("emits agent events based on llm response", async () => {
    const llmClient: LlmClient = {
      getConfig() {
        return {
          provider: "openai",
          modelName: "gpt-4o-mini",
          apiKey: "test-key",
          baseUrl: "https://example.invalid",
          temperature: 0.1,
          timeoutMs: 120000,
        };
      },
      async generateText(input) {
        expect(input.messages[0]?.role).toBe("system");
        expect(input.messages[0]?.content).toContain("你是 OMBot。");
        expect(input.messages.at(-1)?.content).toContain("现在服务器状态怎么样？");
        return {
          content: "当前服务运行正常。",
        };
      },
    };

    const runtime = new LlmAgentRuntimeAdapter(
      llmClient,
      new InMemoryToolRegistry(),
      new ConfigDrivenToolPolicy({
        profiles: {
          readonly: {
            defaultAction: "deny",
          },
        },
      }),
    );

    const events = await collectEvents(
      runtime.run({
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
        promptContext: {
          systemPrompt: "你是 OMBot。",
        },
        input: {
          kind: "user_message",
          content: "现在服务器状态怎么样？",
        },
        toolProfile: "readonly",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.start",
      "agent.message_update",
      "agent.summary",
      "agent.end",
    ]);
    expect(events[1]).toMatchObject({
      type: "agent.message_update",
      content: "当前服务运行正常。",
    });
  });

  it("calls readonly tools before asking llm when message matches heuristics", async () => {
    const registry = new InMemoryToolRegistry();
    registry.register({
      name: "get_cpu_usage",
      description: "Read CPU usage",
      riskLevel: "readonly",
      parametersSchema: {},
      async execute() {
        return {
          estimatedUsagePercent: 12,
        };
      },
    });
    registry.register({
      name: "get_memory_usage",
      description: "Read memory usage",
      riskLevel: "readonly",
      parametersSchema: {},
      async execute() {
        return {
          usagePercent: 34,
        };
      },
    });

    const llmClient: LlmClient = {
      getConfig() {
        return {
          provider: "openai",
          modelName: "gpt-4o-mini",
          apiKey: "test-key",
          baseUrl: "https://example.invalid",
          temperature: 0.1,
          timeoutMs: 120000,
        };
      },
      async generateText(input) {
        const combined = input.messages.map((message) => message.content).join("\n");
        expect(combined).toContain("get_cpu_usage");
        expect(combined).toContain("estimatedUsagePercent");
        expect(combined).toContain("get_memory_usage");
        expect(combined).toContain("usagePercent");
        return {
          content: "CPU 和内存状态正常。",
        };
      },
    };

    const runtime = new LlmAgentRuntimeAdapter(
      llmClient,
      registry,
      new ConfigDrivenToolPolicy({
        profiles: {
          readonly: {
            defaultAction: "deny",
            allow: ["get_cpu_usage", "get_memory_usage"],
          },
        },
      }),
    );

    const events = await collectEvents(
      runtime.run({
        session: {
          sessionId: "sess_1",
          type: "interactive",
          status: "active",
          hostId: "local-test",
          channel: "cli",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        runId: "run_2",
        promptContext: {
          systemPrompt: "你是 OMBot。",
        },
        input: {
          kind: "user_message",
          content: "帮我看看 CPU 和内存状态",
        },
        toolProfile: "readonly",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.start",
      "tool.call",
      "tool.result",
      "tool.call",
      "tool.result",
      "agent.message_update",
      "agent.summary",
      "agent.end",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool.call",
      toolName: "get_cpu_usage",
    });
    expect(events[3]).toMatchObject({
      type: "tool.call",
      toolName: "get_memory_usage",
    });
  });
});
