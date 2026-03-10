import type { SessionSnapshot, SessionSummary } from "../memory/types";

export interface UserMessageInput {
  content: string;
  sessionId?: string;
  title?: string;
}

export interface MonitorEventInput {
  ruleId: string;
  severity: "info" | "warning" | "critical";
  type: "monitor.alert" | "monitor.recovered";
  summary: string;
  observedAt?: string;
  details?: Record<string, unknown>;
}

export interface ApprovalRequest {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  expiresAt: string;
}

export interface ApprovalResolutionInput {
  approvalId: string;
  action: "approve_once" | "deny";
  resolvedBy: string;
}

export interface ApprovalState extends ApprovalRequest {
  status: "pending" | "approved_once" | "denied";
  resolvedBy?: string;
  resolvedAt?: string;
}

export type GatewayEvent =
  | { type: "gateway.run.started"; sessionId: string; runId: string }
  | { type: "gateway.run.completed"; sessionId: string; runId: string }
  | { type: "user.message.accepted"; sessionId: string; runId: string; content: string }
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
  | { type: "agent.end"; sessionId: string; runId: string }
  | { type: "monitor.alert"; sessionId: string; runId: string; summary: string }
  | { type: "monitor.recovered"; sessionId: string; runId: string; summary: string }
  | { type: "approval.required"; sessionId: string; approvalId: string; toolName: string; reason: string }
  | { type: "approval.resolved"; sessionId: string; approvalId: string; action: "approve_once" | "deny" };

export interface GatewayRunHandle {
  sessionId: string;
  runId: string;
  stream: AsyncIterable<GatewayEvent>;
}

export interface EventBus {
  publish(event: GatewayEvent): Promise<void>;
  subscribe(handler: (event: GatewayEvent) => void | Promise<void>): () => void;
}

export interface ApprovalCenter {
  request(input: ApprovalRequest): Promise<void>;
  resolve(input: ApprovalResolutionInput): Promise<void>;
  get(approvalId: string): Promise<ApprovalState | null>;
}

export interface Gateway {
  sendUserMessage(input: UserMessageInput): Promise<GatewayRunHandle>;
  dispatchMonitorEvent(input: MonitorEventInput): Promise<GatewayRunHandle>;
  resolveApproval(input: ApprovalResolutionInput): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSnapshot | null>;
}
