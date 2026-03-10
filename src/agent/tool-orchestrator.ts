import type { ToolPolicy, ToolRegistry } from "../tools/types";
import type { AgentRunInput, AgentRuntimeEvent } from "./types";

export interface ToolPlan {
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolExecutionRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: unknown;
}

export interface ToolExecutionBatch {
  toolExecutions: ToolExecutionRecord[];
  runtimeEvents: AgentRuntimeEvent[];
}

export interface ToolOrchestrator {
  plan(input: AgentRunInput): ToolPlan[];
  execute(input: AgentRunInput): Promise<ToolExecutionBatch>;
}

function extractProcessName(content: string): string | undefined {
  const explicitMatch = content.match(/([a-zA-Z0-9._-]+)\s*(进程|process|服务|service)/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1];
  }

  const commonNames = ["nginx", "mysql", "redis", "postgres", "postgresql", "node", "python", "java"];
  const lower = content.toLowerCase();
  return commonNames.find((name) => lower.includes(name));
}

export class HeuristicToolOrchestrator implements ToolOrchestrator {
  private readonly toolRegistry: ToolRegistry;
  private readonly toolPolicy: ToolPolicy;

  constructor(toolRegistry: ToolRegistry, toolPolicy: ToolPolicy) {
    this.toolRegistry = toolRegistry;
    this.toolPolicy = toolPolicy;
  }

  plan(input: AgentRunInput): ToolPlan[] {
    if (input.input.kind !== "user_message") {
      return [];
    }

    // 这里先保留一层轻量启发式规则，后续再平滑替换成更强的计划器或 function-calling。
    const content = input.input.content.toLowerCase();
    const plans: ToolPlan[] = [];

    if (content.includes("cpu") || content.includes("负载") || content.includes("load")) {
      plans.push({ toolName: "get_cpu_usage", input: {} });
    }

    if (content.includes("内存") || content.includes("memory") || content.includes("mem")) {
      plans.push({ toolName: "get_memory_usage", input: {} });
    }

    if (content.includes("磁盘") || content.includes("disk") || content.includes("存储") || content.includes("空间")) {
      plans.push({ toolName: "get_disk_usage", input: { path: "/" } });
    }

    const portMatch = input.input.content.match(/端口\s*(\d{1,5})|port\s*(\d{1,5})/i);
    const portValue = portMatch?.[1] ?? portMatch?.[2];
    if (portValue) {
      plans.push({
        toolName: "get_port_status",
        input: { host: "127.0.0.1", port: Number(portValue) },
      });
    }

    const urlMatch = input.input.content.match(/https?:\/\/[^\s]+/i);
    if (urlMatch?.[0]) {
      plans.push({
        toolName: "check_http_endpoint",
        input: { url: urlMatch[0], method: "GET" },
      });
    }

    const processName = extractProcessName(input.input.content);
    if (processName) {
      plans.push({
        toolName: "get_process_status",
        input: { processName },
      });
    }

    const deduped = new Map<string, ToolPlan>();
    for (const plan of plans) {
      deduped.set(`${plan.toolName}:${JSON.stringify(plan.input)}`, plan);
    }

    return Array.from(deduped.values());
  }

  async execute(input: AgentRunInput): Promise<ToolExecutionBatch> {
    const toolExecutions: ToolExecutionRecord[] = [];
    const runtimeEvents: AgentRuntimeEvent[] = [];

    for (const plan of this.plan(input)) {
      const tool = this.toolRegistry.get(plan.toolName);
      if (!tool) {
        continue;
      }

      const decision = await this.toolPolicy.evaluate({
        profile: input.toolProfile,
        toolName: tool.name,
        riskLevel: tool.riskLevel,
        sessionId: input.session.sessionId,
        toolRequiresConfirmation: tool.requiresConfirmation,
      });

      if (!decision.allowed) {
        continue;
      }

      // 编排器只负责“挑选并执行工具”，不负责最终如何向用户组织语言。
      runtimeEvents.push({
        type: "tool.call",
        sessionId: input.session.sessionId,
        runId: input.runId,
        toolName: tool.name,
        toolInput: plan.input,
      });

      const output = await tool.execute(plan.input, {
        sessionId: input.session.sessionId,
      });

      toolExecutions.push({
        toolName: tool.name,
        input: plan.input,
        output,
      });

      runtimeEvents.push({
        type: "tool.result",
        sessionId: input.session.sessionId,
        runId: input.runId,
        toolName: tool.name,
        toolInput: plan.input,
        toolOutput: output,
      });
    }

    return {
      toolExecutions,
      runtimeEvents,
    };
  }
}
