import path from "node:path";

import { Cron } from "croner";
import { z } from "zod";

import { ConfigError } from "../shared/errors";
import type { OmbotEventFile, ParsedOmbotEvent } from "./types";

const baseSchema = z.object({
  text: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const immediateSchema = baseSchema.extend({
  type: z.literal("immediate"),
});

const oneShotSchema = baseSchema.extend({
  type: z.literal("one-shot"),
  at: z.string().datetime({ offset: true }),
});

const periodicSchema = baseSchema.extend({
  type: z.literal("periodic"),
  schedule: z.string().min(1),
  timezone: z.string().min(1).optional(),
});

const eventSchema = z.discriminatedUnion("type", [
  immediateSchema,
  oneShotSchema,
  periodicSchema,
]);

export function parseEventFile(
  filename: string,
  raw: string,
  defaults: { defaultTimezone: string },
): ParsedOmbotEvent {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(`事件文件 JSON 解析失败: ${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = eventSchema.safeParse(parsedJson);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`事件文件校验失败: ${filename}: ${details}`);
  }

  const event = normalizeEvent(result.data, defaults);
  return {
    eventId: toEventId(filename),
    sourceFile: filename,
    event,
  };
}

function normalizeEvent(event: OmbotEventFile, defaults: { defaultTimezone: string }): OmbotEventFile {
  if (event.type === "periodic") {
    const timezone = event.timezone ?? defaults.defaultTimezone;
    try {
      const cron = new Cron(event.schedule, { timezone, paused: true });
      cron.stop();
    } catch (error) {
      throw new ConfigError(`周期事件 cron 非法: ${event.schedule}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      ...event,
      timezone,
      profile: event.profile ?? "readonly",
    };
  }

  return {
    ...event,
    profile: event.profile ?? "readonly",
  };
}

function toEventId(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  return `evt_${base.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
}
