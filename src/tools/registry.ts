import { ConfigError } from "../shared/errors";
import type { OmbotToolDefinition, ToolRegistry } from "./types";

export class InMemoryToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, OmbotToolDefinition>();

  register(tool: OmbotToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new ConfigError(`重复的工具注册: ${tool.name}`);
    }

    // 工具名是模型侧和运行时之间的稳定标识，重复注册直接视为配置错误。
    this.tools.set(tool.name, tool);
  }

  get(name: string): OmbotToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): OmbotToolDefinition[] {
    // list() 后续会用于给 Agent 暴露可见工具集合。
    return Array.from(this.tools.values());
  }
}
