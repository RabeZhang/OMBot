import path from "node:path";

import type { MonitorsConfig, OmbotConfig, ToolPolicyConfig } from "./schema";

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase());
}

export function camelizeKeys<T>(input: T): T {
  // YAML 配置沿用 snake_case，可在进入 TypeScript 领域前统一转成 camelCase。
  if (Array.isArray(input)) {
    return input.map((item) => camelizeKeys(item)) as T;
  }

  if (input && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      result[toCamelCase(key)] = camelizeKeys(value);
    }
    return result as T;
  }

  return input;
}

function resolvePath(projectRoot: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(projectRoot, targetPath);
}

export function normalizeOmbotConfigPaths(config: OmbotConfig, projectRoot: string): OmbotConfig {
  // 启动时就把所有关键路径标准化，后续模块只处理绝对路径，减少重复判断。
  return {
    ...config,
    agent: {
      ...config.agent,
      systemPromptTemplate: resolvePath(projectRoot, config.agent.systemPromptTemplate),
      workspaceFiles: config.agent.workspaceFiles.map((file) => resolvePath(projectRoot, file)),
    },
    events: {
      ...config.events,
      dir: resolvePath(projectRoot, config.events.dir),
    },
    paths: {
      dataDir: resolvePath(projectRoot, config.paths.dataDir),
      workspaceDir: resolvePath(projectRoot, config.paths.workspaceDir),
      transcriptsDir: resolvePath(projectRoot, config.paths.transcriptsDir),
      auditDbPath: resolvePath(projectRoot, config.paths.auditDbPath),
    },
  };
}

export function normalizeMonitorsConfig(config: MonitorsConfig): MonitorsConfig {
  return config;
}

export function normalizeToolPolicyConfig(config: ToolPolicyConfig): ToolPolicyConfig {
  return config;
}
