import { checkHttpEndpointTool, getPortStatusTool } from "./network";
import { getProcessStatusTool } from "./process";
import { getCpuUsageTool, getDiskUsageTool, getMemoryUsageTool } from "./resource";
import type { OmbotToolDefinition } from "../types";

export function createLocalReadOnlyTools(): OmbotToolDefinition[] {
  // 本机只读工具会优先服务于“先取事实再回答”的运行时预取策略。
  return [
    getProcessStatusTool,
    getCpuUsageTool,
    getMemoryUsageTool,
    getDiskUsageTool,
    getPortStatusTool,
    checkHttpEndpointTool,
  ];
}
