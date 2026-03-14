import { Type, type TSchema } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { OmbotToolDefinition, ToolPolicy, ToolPolicyInput, ToolRiskLevel } from "./types";

/**
 * 将 OMBot 的 OmbotToolDefinition 适配为 pi-agent-core 的 AgentTool。
 *
 * 适配层同时嵌入了 ToolPolicy 评估，使 Agent 只能看到被策略允许的工具。
 */
export function toPiAgentTool(
    tool: OmbotToolDefinition,
    typeboxSchema: TSchema,
): AgentTool {
    return {
        name: tool.name,
        label: tool.name,
        description: tool.description,
        parameters: typeboxSchema,
        async execute(
            _toolCallId: string,
            params: unknown,
            _signal?: AbortSignal,
            _onUpdate?: unknown,
        ): Promise<AgentToolResult<unknown>> {
            const result = await tool.execute(params, { sessionId: "" });

            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                details: result,
            };
        },
    };
}

// ========== TypeBox Schemas ==========

export const processStatusTypeboxSchema = Type.Object({
    pid: Type.Optional(Type.Integer({ minimum: 1 })),
    processName: Type.Optional(Type.String({ minLength: 1 })),
}, { description: "pid 和 processName 至少提供一个" });

export const emptyTypeboxSchema = Type.Object({});

export const diskUsageTypeboxSchema = Type.Object({
    path: Type.Optional(Type.String({ minLength: 1 })),
});

export const portStatusTypeboxSchema = Type.Object({
    host: Type.Optional(Type.String({ minLength: 1 })),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const httpEndpointTypeboxSchema = Type.Object({
    url: Type.String({ format: "uri" }),
    method: Type.Optional(Type.Union([Type.Literal("GET"), Type.Literal("HEAD")])),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
});

// ========== Tool Mapping ==========

import { getProcessStatusTool } from "./local/process";
import { getCpuUsageTool, getMemoryUsageTool, getDiskUsageTool } from "./local/resource";
import { getPortStatusTool, checkHttpEndpointTool } from "./local/network";
import { createBashTool } from "./local/bash";
import { createReadTool } from "./local/read";
import { createEditTool } from "./local/edit";
import { createWriteTool } from "./local/write";
import { createGrepTool } from "./local/grep";
import { createFindTool } from "./local/find";
import {
    createCreateEventTool,
    createDeleteEventTool,
    createListEventsTool,
    createReadEventTool,
} from "./local/events";

interface ToolWithSchema {
    tool: OmbotToolDefinition;
    typeboxSchema: TSchema;
}

function getToolMappings(): ToolWithSchema[] {
    return [
        { tool: getProcessStatusTool, typeboxSchema: processStatusTypeboxSchema },
        { tool: getCpuUsageTool, typeboxSchema: emptyTypeboxSchema },
        { tool: getMemoryUsageTool, typeboxSchema: emptyTypeboxSchema },
        { tool: getDiskUsageTool, typeboxSchema: diskUsageTypeboxSchema },
        { tool: getPortStatusTool, typeboxSchema: portStatusTypeboxSchema },
        { tool: checkHttpEndpointTool, typeboxSchema: httpEndpointTypeboxSchema },
    ];
}

/**
 * 创建所有本机只读工具的 pi AgentTool 版本。
 */
export function createPiLocalReadOnlyTools(): AgentTool[] {
    return getToolMappings().map(({ tool, typeboxSchema }) =>
        toPiAgentTool(tool, typeboxSchema),
    );
}

/**
 * 创建所有工具（只读 + bash/read/edit/write/grep/find）。
 * cwd 参数用于 bash/read/edit/write/grep/find 的工作目录。
 */
export function createAllPiTools(options: {
    cwd: string;
    eventsDir: string;
    defaultTimezone: string;
}): AgentTool[] {
    return [
        ...createPiLocalReadOnlyTools(),
        createBashTool(options.cwd),
        createReadTool(options.cwd),
        createEditTool(options.cwd),
        createWriteTool(options.cwd),
        createGrepTool(options.cwd),
        createFindTool(options.cwd),
        createCreateEventTool({
            eventsDir: options.eventsDir,
            defaultTimezone: options.defaultTimezone,
        }),
        createListEventsTool({
            eventsDir: options.eventsDir,
            defaultTimezone: options.defaultTimezone,
        }),
        createReadEventTool({
            eventsDir: options.eventsDir,
            defaultTimezone: options.defaultTimezone,
        }),
        createDeleteEventTool({
            eventsDir: options.eventsDir,
            defaultTimezone: options.defaultTimezone,
        }),
    ];
}
