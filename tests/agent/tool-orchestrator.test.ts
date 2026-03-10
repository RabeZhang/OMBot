import { describe, expect, it } from "vitest";

import { HeuristicToolOrchestrator } from "../../src/agent/tool-orchestrator";
import { ConfigDrivenToolPolicy } from "../../src/tools/policy";
import { InMemoryToolRegistry } from "../../src/tools/registry";

describe("HeuristicToolOrchestrator", () => {
  it("plans tools based on user message heuristics", () => {
    const orchestrator = new HeuristicToolOrchestrator(
      new InMemoryToolRegistry(),
      new ConfigDrivenToolPolicy({
        profiles: {
          readonly: {
            defaultAction: "deny",
          },
        },
      }),
    );

    const plans = orchestrator.plan({
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
      promptContext: {},
      input: {
        kind: "user_message",
        content: "帮我看看 nginx 进程、CPU、内存、端口 8080 和 https://example.com/health",
      },
      toolProfile: "readonly",
    });

    const toolNames = plans.map((plan) => plan.toolName);
    expect(toolNames).toContain("get_process_status");
    expect(toolNames).toContain("get_cpu_usage");
    expect(toolNames).toContain("get_memory_usage");
    expect(toolNames).toContain("get_port_status");
    expect(toolNames).toContain("check_http_endpoint");
  });

  it("executes only allowed tools and returns runtime events", async () => {
    const registry = new InMemoryToolRegistry();
    registry.register({
      name: "get_cpu_usage",
      description: "Read CPU usage",
      riskLevel: "readonly",
      parametersSchema: {},
      async execute() {
        return { estimatedUsagePercent: 20 };
      },
    });

    const orchestrator = new HeuristicToolOrchestrator(
      registry,
      new ConfigDrivenToolPolicy({
        profiles: {
          readonly: {
            defaultAction: "deny",
            allow: ["get_cpu_usage"],
          },
        },
      }),
    );

    const batch = await orchestrator.execute({
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
      promptContext: {},
      input: {
        kind: "user_message",
        content: "帮我看看 CPU 状态",
      },
      toolProfile: "readonly",
    });

    expect(batch.toolExecutions).toHaveLength(1);
    expect(batch.toolExecutions[0]?.toolName).toBe("get_cpu_usage");
    expect(batch.runtimeEvents.map((event) => event.type)).toEqual(["tool.call", "tool.result"]);
  });
});
