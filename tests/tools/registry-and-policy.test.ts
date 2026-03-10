import { describe, expect, it } from "vitest";

import type { ToolPolicyConfig } from "../../src/config/schema";
import { ConfigError } from "../../src/shared/errors";
import { ConfigDrivenToolPolicy } from "../../src/tools/policy";
import { InMemoryToolRegistry } from "../../src/tools/registry";

describe("InMemoryToolRegistry", () => {
  it("registers and returns tools", () => {
    const registry = new InMemoryToolRegistry();

    registry.register({
      name: "get_cpu_usage",
      description: "Read CPU usage",
      riskLevel: "readonly",
      parametersSchema: {},
      async execute() {
        return { cpu: 10 };
      },
    });

    expect(registry.get("get_cpu_usage")?.name).toBe("get_cpu_usage");
    expect(registry.list()).toHaveLength(1);
  });

  it("rejects duplicate tool registration", () => {
    const registry = new InMemoryToolRegistry();

    const tool = {
      name: "get_cpu_usage",
      description: "Read CPU usage",
      riskLevel: "readonly" as const,
      parametersSchema: {},
      async execute() {
        return { cpu: 10 };
      },
    };

    registry.register(tool);

    expect(() => registry.register(tool)).toThrow(ConfigError);
    expect(() => registry.register(tool)).toThrow("重复的工具注册");
  });
});

describe("ConfigDrivenToolPolicy", () => {
  const config: ToolPolicyConfig = {
    profiles: {
      readonly: {
        defaultAction: "deny",
        allow: ["get_cpu_usage", "get_memory_usage"],
      },
      ops: {
        defaultAction: "deny",
        allow: ["restart_service", "stop_service"],
        requireConfirmation: ["restart_service"],
      },
    },
  };

  it("allows tool explicitly listed in profile", async () => {
    const policy = new ConfigDrivenToolPolicy(config);

    const decision = await policy.evaluate({
      profile: "readonly",
      toolName: "get_cpu_usage",
      riskLevel: "readonly",
      sessionId: "sess_1",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it("denies tool not allowed by profile", async () => {
    const policy = new ConfigDrivenToolPolicy(config);

    const decision = await policy.evaluate({
      profile: "readonly",
      toolName: "restart_service",
      riskLevel: "privileged",
      sessionId: "sess_1",
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("未被 profile readonly 允许");
  });

  it("falls back to readonly profile for unknown profile", async () => {
    const policy = new ConfigDrivenToolPolicy(config);

    const decision = await policy.evaluate({
      profile: "unknown-profile",
      toolName: "get_memory_usage",
      riskLevel: "readonly",
      sessionId: "sess_1",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it("requires confirmation for high-risk tool when profile demands it", async () => {
    const policy = new ConfigDrivenToolPolicy(config);

    const decision = await policy.evaluate({
      profile: "ops",
      toolName: "restart_service",
      riskLevel: "privileged",
      sessionId: "sess_1",
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
  });

  it("requires confirmation when tool metadata demands it", async () => {
    const policy = new ConfigDrivenToolPolicy(config);

    const decision = await policy.evaluate({
      profile: "ops",
      toolName: "stop_service",
      riskLevel: "mutating",
      sessionId: "sess_1",
      toolRequiresConfirmation: true,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresConfirmation).toBe(true);
  });
});
