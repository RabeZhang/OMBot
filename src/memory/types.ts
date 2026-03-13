export type SessionType = "interactive" | "incident" | "system";
export type SessionStatus = "active" | "idle" | "closed";
export type SessionChannel = "cli" | "internal";

// SessionRecord 只保存路由和展示所需的元数据，不承载完整对话内容。
export interface SessionRecord {
  sessionId: string;
  type: SessionType;
  status: SessionStatus;
  hostId: string;
  channel: SessionChannel;
  createdAt: string;
  updatedAt: string;
  title?: string;
  relatedMonitorKey?: string;
}

export interface SessionSummary {
  sessionId: string;
  type: SessionType;
  status: SessionStatus;
  title?: string;
  updatedAt: string;
}

export interface SessionSnapshot {
  session: SessionRecord;
  transcript: TranscriptEntry[];
}

export interface SessionCreateInput {
  type: SessionType;
  title?: string;
  relatedMonitorKey?: string;
  channel?: SessionChannel;
}

export interface SessionStore {
  create(input: SessionCreateInput): Promise<SessionRecord>;
  get(sessionId: string): Promise<SessionRecord | null>;
  list(): Promise<SessionSummary[]>;
  update(session: SessionRecord): Promise<void>;
}

export type TranscriptEntryKind =
  | "message"
  | "tool_call"
  | "tool_result"
  | "monitor_event"
  | "scheduled_event"
  | "approval"
  | "summary";

// TranscriptEntry 采用 append-only 设计，后续可自然扩展更多 kind。
export interface TranscriptEntry {
  id: string;
  parentId?: string;
  sessionId: string;
  kind: TranscriptEntryKind;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface TranscriptStore {
  append(entry: TranscriptEntry): Promise<void>;
  listBySession(sessionId: string, limit?: number): Promise<TranscriptEntry[]>;
}
