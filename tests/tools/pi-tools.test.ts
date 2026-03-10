import { describe, expect, it } from "vitest";

import {
    toPiAgentTool,
    createPiLocalReadOnlyTools,
    processStatusTypeboxSchema,
    emptyTypeboxSchema,
    diskUsageTypeboxSchema,
    portStatusTypeboxSchema,
    httpEndpointTypeboxSchema,
} from "../../src/tools/pi-tools";
import { getProcessStatusTool } from "../../src/tools/local/process";
import { getCpuUsageTool } from "../../src/tools/local/resource";

describe("toPiAgentTool", () => {
    it("converts OmbotToolDefinition to AgentTool with correct metadata", () => {
        const piTool = toPiAgentTool(getProcessStatusTool, processStatusTypeboxSchema);

        expect(piTool.name).toBe("get_process_status");
        expect(piTool.label).toBe("get_process_status");
        expect(piTool.description).toBe("查询进程是否存活以及匹配列表");
        expect(piTool.parameters).toBe(processStatusTypeboxSchema);
    });

    it("execute wraps tool result in AgentToolResult format", async () => {
        const piTool = toPiAgentTool(getCpuUsageTool, emptyTypeboxSchema);
        const result = await piTool.execute("call_1", {});

        expect(result.content).toHaveLength(1);
        expect(result.content[0]?.type).toBe("text");
        expect(typeof (result.content[0] as any).text).toBe("string");

        // details should be the raw result object
        expect(result.details).toHaveProperty("coreCount");
        expect(result.details).toHaveProperty("loadAverage1m");
        expect(result.details).toHaveProperty("estimatedUsagePercent");
    });

    it("execute result text is valid JSON", async () => {
        const piTool = toPiAgentTool(getCpuUsageTool, emptyTypeboxSchema);
        const result = await piTool.execute("call_1", {});

        const parsed = JSON.parse((result.content[0] as any).text);
        expect(parsed).toHaveProperty("coreCount");
    });
});

describe("createPiLocalReadOnlyTools", () => {
    it("returns all 6 local readonly tools as AgentTools", () => {
        const tools = createPiLocalReadOnlyTools();

        expect(tools).toHaveLength(6);
        const names = tools.map((t) => t.name);
        expect(names).toContain("get_process_status");
        expect(names).toContain("get_cpu_usage");
        expect(names).toContain("get_memory_usage");
        expect(names).toContain("get_disk_usage");
        expect(names).toContain("get_port_status");
        expect(names).toContain("check_http_endpoint");
    });

    it("all tools have valid execute functions", () => {
        const tools = createPiLocalReadOnlyTools();
        for (const tool of tools) {
            expect(typeof tool.execute).toBe("function");
            expect(typeof tool.name).toBe("string");
            expect(typeof tool.description).toBe("string");
            expect(typeof tool.label).toBe("string");
            expect(tool.parameters).toBeDefined();
        }
    });
});

describe("TypeBox schemas", () => {
    it("processStatusTypeboxSchema has expected properties", () => {
        expect(processStatusTypeboxSchema.properties).toHaveProperty("pid");
        expect(processStatusTypeboxSchema.properties).toHaveProperty("processName");
    });

    it("emptyTypeboxSchema has no required properties", () => {
        expect(Object.keys(emptyTypeboxSchema.properties ?? {})).toHaveLength(0);
    });

    it("diskUsageTypeboxSchema has path property", () => {
        expect(diskUsageTypeboxSchema.properties).toHaveProperty("path");
    });

    it("portStatusTypeboxSchema has port as required", () => {
        expect(portStatusTypeboxSchema.properties).toHaveProperty("port");
        expect(portStatusTypeboxSchema.required).toContain("port");
    });

    it("httpEndpointTypeboxSchema has url as required", () => {
        expect(httpEndpointTypeboxSchema.properties).toHaveProperty("url");
        expect(httpEndpointTypeboxSchema.required).toContain("url");
    });
});
