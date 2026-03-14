import type { SessionRecord } from "../memory/types";

export interface PromptContext {
  systemPrompt?: string;
  sessionHistory?: string;
}

export type AgentRuntimeInput =
  | { kind: "user_message"; content: string }
  | {
      kind: "monitor_event";
      event: {
        ruleId: string;
        severity: "info" | "warning" | "critical";
        type: "monitor.alert" | "monitor.recovered";
        summary: string;
        observedAt?: string;
        details?: Record<string, unknown>;
      };
    }
  | {
      kind: "scheduled_event";
      event: {
        eventId: string;
        sourceFile: string;
        type: "one-shot" | "periodic" | "immediate";
        text: string;
        title?: string;
        profile: string;
        scheduledAt?: string;
        triggeredAt: string;
        timezone?: string;
        metadata?: Record<string, unknown>;
      };
    };

export interface AgentRunInput {
  session: SessionRecord;
  runId: string;
  promptContext: PromptContext;
  input: AgentRuntimeInput;
  toolProfile: string;
}

export type AgentRuntimeEvent =
  | { type: "agent.start"; sessionId: string; runId: string }
  | { type: "tool.call"; sessionId: string; runId: string; toolName: string; toolInput: Record<string, unknown> }
  | {
      type: "tool.result";
      sessionId: string;
      runId: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      toolOutput: unknown;
    }
  | { type: "agent.message_update"; sessionId: string; runId: string; content: string }
  | { type: "agent.summary"; sessionId: string; runId: string; summary: string }
  | { type: "agent.end"; sessionId: string; runId: string };

// Agent Runtime 与 Gateway 之间只通过事件流通信，便于后续替换为真实 LLM 驱动实现。
export interface AgentRuntimeAdapter {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}
