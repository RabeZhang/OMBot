import { Cron } from "croner";
import {
  existsSync,
  type FSWatcher,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  watch,
} from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Gateway } from "../gateway/types";
import type { ParsedOmbotEvent } from "./types";
import { parseEventFile } from "./parser";

const DEBOUNCE_MS = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 100;

export interface EventsWatcherOptions {
  eventsDir: string;
  gateway: Gateway;
  defaultTimezone: string;
  startupScan?: boolean;
  enableFileWatch?: boolean;
  logger?: Pick<Console, "info" | "warn">;
}

export class EventsWatcher {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly crons = new Map<string, Cron>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly knownFiles = new Set<string>();
  private readonly logger: Pick<Console, "info" | "warn">;
  private readonly startTime: number;
  private watcher: FSWatcher | null = null;

  constructor(private readonly options: EventsWatcherOptions) {
    this.logger = options.logger ?? console;
    this.startTime = Date.now();
  }

  start(): void {
    if (!existsSync(this.options.eventsDir)) {
      mkdirSync(this.options.eventsDir, { recursive: true });
    }

    if (this.options.startupScan !== false) {
      this.scanExisting();
    }

    if (this.options.enableFileWatch !== false) {
      this.watcher = watch(this.options.eventsDir, (_eventType, filename) => {
        if (!filename || !filename.endsWith(".json")) {
          return;
        }

        this.debounce(filename, () => {
          void this.handleFileChange(filename);
        });
      });
    }

    this.logger.info(`[events] watcher started: ${this.options.eventsDir}`);
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const cron of this.crons.values()) {
      cron.stop();
    }
    this.crons.clear();
    this.knownFiles.clear();
    this.logger.info("[events] watcher stopped");
  }

  async processFile(filename: string): Promise<void> {
    await this.handleFile(filename);
  }

  private debounce(filename: string, fn: () => void): void {
    const existing = this.debounceTimers.get(filename);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      filename,
      setTimeout(() => {
        this.debounceTimers.delete(filename);
        fn();
      }, DEBOUNCE_MS),
    );
  }

  private scanExisting(): void {
    let files: string[];
    try {
      files = readdirSync(this.options.eventsDir).filter((file) => file.endsWith(".json"));
    } catch (error) {
      this.logger.warn(`[events] failed to scan directory: ${String(error)}`);
      return;
    }

    for (const filename of files) {
      void this.handleFile(filename);
    }
  }

  private async handleFileChange(filename: string): Promise<void> {
    const filePath = path.join(this.options.eventsDir, filename);
    if (!existsSync(filePath)) {
      this.handleDelete(filename);
      return;
    }

    if (this.knownFiles.has(filename)) {
      this.cancelScheduled(filename);
    }

    await this.handleFile(filename);
  }

  private handleDelete(filename: string): void {
    if (!this.knownFiles.has(filename)) {
      return;
    }

    this.cancelScheduled(filename);
    this.knownFiles.delete(filename);
  }

  private cancelScheduled(filename: string): void {
    const timer = this.timers.get(filename);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(filename);
    }

    const cron = this.crons.get(filename);
    if (cron) {
      cron.stop();
      this.crons.delete(filename);
    }
  }

  private async handleFile(filename: string): Promise<void> {
    const parsed = await this.readParsedEvent(filename);
    if (!parsed) {
      return;
    }

    this.knownFiles.add(filename);
    const { event } = parsed;

    if (event.type === "immediate") {
      this.handleImmediate(parsed);
      return;
    }

    if (event.type === "one-shot") {
      this.handleOneShot(parsed);
      return;
    }

    this.handlePeriodic(parsed);
  }

  private async readParsedEvent(filename: string): Promise<ParsedOmbotEvent | null> {
    const filePath = path.join(this.options.eventsDir, filename);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const content = await readFile(filePath, "utf8");
        return parseEventFile(filename, content, {
          defaultTimezone: this.options.defaultTimezone,
        });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_BASE_MS * 2 ** attempt);
        }
      }
    }

    this.logger.warn(`[events] invalid event file deleted: ${filename}: ${lastError?.message ?? "unknown error"}`);
    this.deleteFile(filename);
    return null;
  }

  private handleImmediate(parsed: ParsedOmbotEvent): void {
    const filePath = path.join(this.options.eventsDir, parsed.sourceFile);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs < this.startTime) {
        this.deleteFile(parsed.sourceFile);
        return;
      }
    } catch {
      return;
    }

    void this.dispatch(parsed, true);
  }

  private handleOneShot(parsed: ParsedOmbotEvent): void {
    if (parsed.event.type !== "one-shot") {
      return;
    }

    const atTime = new Date(parsed.event.at).getTime();
    if (atTime <= Date.now()) {
      this.deleteFile(parsed.sourceFile);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(parsed.sourceFile);
      void this.dispatch(parsed, true);
    }, atTime - Date.now());

    this.timers.set(parsed.sourceFile, timer);
  }

  private handlePeriodic(parsed: ParsedOmbotEvent): void {
    if (parsed.event.type !== "periodic") {
      return;
    }

    const cron = new Cron(
      parsed.event.schedule,
      { timezone: parsed.event.timezone },
      () => {
        void this.dispatch(parsed, false);
      },
    );

    this.crons.set(parsed.sourceFile, cron);
  }

  private async dispatch(parsed: ParsedOmbotEvent, deleteAfter: boolean): Promise<void> {
    const { event } = parsed;
    const triggeredAt = new Date().toISOString();
    const scheduledAt =
      event.type === "one-shot"
        ? event.at
        : event.type === "periodic"
          ? event.schedule
          : undefined;

    await this.options.gateway.dispatchScheduledEvent({
      eventId: parsed.eventId,
      sourceFile: parsed.sourceFile,
      type: event.type,
      text: event.text,
      sessionId: event.sessionId,
      title: event.title,
      profile: event.profile ?? "readonly",
      scheduledAt,
      triggeredAt,
      timezone: event.type === "periodic" ? event.timezone : undefined,
      metadata: event.metadata,
    });

    if (deleteAfter) {
      this.deleteFile(parsed.sourceFile);
    }
  }

  private deleteFile(filename: string): void {
    const filePath = path.join(this.options.eventsDir, filename);
    try {
      unlinkSync(filePath);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ENOENT") {
        this.logger.warn(`[events] failed to delete event file ${filename}: ${String(error)}`);
      }
    }

    this.knownFiles.delete(filename);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
