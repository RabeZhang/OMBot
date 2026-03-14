import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import {
  createImmediateEventFile,
  createOneShotEventFile,
  createPeriodicEventFile,
  deleteEventFile,
  listEventFiles,
  readEventFile,
} from "../../events/files";
import { parseEventFile } from "../../events/parser";
import { getCurrentToolSessionId } from "../runtime-context";

interface EventToolsOptions {
  eventsDir: string;
  defaultTimezone: string;
}

function asTextResult(details: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

export function createCreateEventTool(options: EventToolsOptions): AgentTool {
  return {
    name: "create_event",
    label: "创建事件",
    description:
      "创建调度事件。适用于提醒、延迟任务、周期巡检。支持 immediate、one-shot、periodic 三种类型。" +
      "如果用户表达的是提醒、定时检查、每天/每小时执行某任务，应优先使用这个工具。",
    parameters: Type.Object({
      type: Type.Union([
        Type.Literal("immediate"),
        Type.Literal("one-shot"),
        Type.Literal("periodic"),
      ]),
      text: Type.String({ minLength: 1 }),
      at: Type.Optional(Type.String({ description: "one-shot 必填，ISO 8601 且带时区偏移" })),
      schedule: Type.Optional(Type.String({ description: "periodic 必填，标准 cron 表达式" })),
      timezone: Type.Optional(Type.String({ description: "periodic 可选，IANA 时区名" })),
      title: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
      profile: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const input = params as {
        type: "immediate" | "one-shot" | "periodic";
        text: string;
        at?: string;
        schedule?: string;
        timezone?: string;
        title?: string;
        sessionId?: string;
        profile?: string;
      };

      let filename: string;
      const boundSessionId = input.sessionId ?? getCurrentToolSessionId();
      if (input.type === "immediate") {
        filename = await createImmediateEventFile(options.eventsDir, {
          text: input.text,
          title: input.title,
          sessionId: boundSessionId,
          profile: input.profile ?? "readonly",
          metadata: { source: "agent" },
        });
      } else if (input.type === "one-shot") {
        if (!input.at) {
          throw new Error("one-shot 事件必须提供 at");
        }
        parseEventFile(
          "validation.json",
          JSON.stringify({
            type: "one-shot",
            text: input.text,
            at: input.at,
            title: input.title,
            sessionId: boundSessionId,
            profile: input.profile ?? "readonly",
          }),
          { defaultTimezone: options.defaultTimezone },
        );
        filename = await createOneShotEventFile(options.eventsDir, {
          text: input.text,
          at: input.at,
          title: input.title,
          sessionId: boundSessionId,
          profile: input.profile ?? "readonly",
          metadata: { source: "agent" },
        });
      } else {
        if (!input.schedule) {
          throw new Error("periodic 事件必须提供 schedule");
        }
        parseEventFile(
          "validation.json",
          JSON.stringify({
            type: "periodic",
            text: input.text,
            schedule: input.schedule,
            timezone: input.timezone ?? options.defaultTimezone,
            title: input.title,
            sessionId: boundSessionId,
            profile: input.profile ?? "readonly",
          }),
          { defaultTimezone: options.defaultTimezone },
        );
        filename = await createPeriodicEventFile(options.eventsDir, {
          text: input.text,
          schedule: input.schedule,
          timezone: input.timezone ?? options.defaultTimezone,
          title: input.title,
          sessionId: boundSessionId,
          profile: input.profile ?? "readonly",
          metadata: { source: "agent" },
        });
      }

      return asTextResult({
        ok: true,
        filename,
        type: input.type,
        eventsDir: options.eventsDir,
        sessionId: boundSessionId,
      });
    },
  };
}

export function createListEventsTool(options: EventToolsOptions): AgentTool {
  return {
    name: "list_events",
    label: "列出事件",
    description: "列出当前 events 目录中的事件文件，适用于查看已配置的提醒、定时任务和周期巡检。",
    parameters: Type.Object({}),
    async execute(): Promise<AgentToolResult<unknown>> {
      const files = await listEventFiles(options.eventsDir);
      return asTextResult({
        ok: true,
        count: files.length,
        files,
      });
    },
  };
}

export function createReadEventTool(options: EventToolsOptions): AgentTool {
  return {
    name: "read_event",
    label: "读取事件",
    description: "读取指定事件文件内容。适用于查看已有提醒、周期任务或外部事件定义。",
    parameters: Type.Object({
      filename: Type.String({ minLength: 1 }),
    }),
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const input = params as { filename: string };
      const content = await readEventFile(options.eventsDir, input.filename);
      return asTextResult({
        ok: true,
        filename: input.filename,
        content,
      });
    },
  };
}

export function createDeleteEventTool(options: EventToolsOptions): AgentTool {
  return {
    name: "delete_event",
    label: "删除事件",
    description: "删除指定事件文件。适用于取消提醒、移除周期任务或清理无效事件。",
    parameters: Type.Object({
      filename: Type.String({ minLength: 1 }),
    }),
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const input = params as { filename: string };
      await deleteEventFile(options.eventsDir, input.filename);
      return asTextResult({
        ok: true,
        filename: input.filename,
      });
    },
  };
}
