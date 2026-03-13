export interface EventFileBase {
  text: string;
  sessionId?: string;
  title?: string;
  profile?: string;
  metadata?: Record<string, unknown>;
}

export interface ImmediateEventFile extends EventFileBase {
  type: "immediate";
}

export interface OneShotEventFile extends EventFileBase {
  type: "one-shot";
  at: string;
}

export interface PeriodicEventFile extends EventFileBase {
  type: "periodic";
  schedule: string;
  timezone?: string;
}

export type OmbotEventFile = ImmediateEventFile | OneShotEventFile | PeriodicEventFile;

export interface ParsedOmbotEvent {
  eventId: string;
  sourceFile: string;
  event: OmbotEventFile;
}
