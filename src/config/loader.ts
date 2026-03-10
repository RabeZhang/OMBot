import fs from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { ConfigError } from "../shared/errors";
import { loadLlmConfigFromEnv } from "../llm/config";
import type { LlmConfig } from "../llm/types";
import { expandEnvVars } from "./env";
import {
  camelizeKeys,
  normalizeMonitorsConfig,
  normalizeOmbotConfigPaths,
  normalizeToolPolicyConfig,
} from "./normalize";
import {
  monitorsConfigSchema,
  ombotConfigSchema,
  toolPolicyConfigSchema,
  type MonitorsConfig,
  type OmbotConfig,
  type ToolPolicyConfig,
} from "./schema";

export interface LoadedConfig {
  ombot: OmbotConfig;
  llm: LlmConfig;
  monitors: MonitorsConfig;
  toolPolicy: ToolPolicyConfig;
}

export interface ConfigLoader {
  load(configDir: string): Promise<LoadedConfig>;
}

async function readYamlFile(filePath: string): Promise<unknown> {
  // 这里先做环境变量替换，再交给 YAML 解析，便于测试和错误定位。
  const raw = await fs.readFile(filePath, "utf8");
  const expanded = expandEnvVars(raw);
  return YAML.parse(expanded);
}

function parseWithSchema<T>(name: string, schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    // 把 Zod 的 issue 压成一行，CLI 和测试里更容易直接看到配置问题。
    const details = result.error?.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`${name} 校验失败: ${details}`);
  }

  return result.data as T;
}

export class FileSystemConfigLoader implements ConfigLoader {
  async load(configDir: string): Promise<LoadedConfig> {
    const absoluteConfigDir = path.resolve(configDir);
    const projectRoot = path.resolve(absoluteConfigDir, "..");

    const ombotRaw = await readYamlFile(path.join(absoluteConfigDir, "ombot.yaml"));
    const monitorsRaw = await readYamlFile(path.join(absoluteConfigDir, "monitors.yaml"));
    const toolPolicyRaw = await readYamlFile(path.join(absoluteConfigDir, "tool_policy.yaml"));

    const ombotParsed = parseWithSchema("ombot.yaml", ombotConfigSchema, camelizeKeys(ombotRaw));
    const monitorsParsed = parseWithSchema("monitors.yaml", monitorsConfigSchema, camelizeKeys(monitorsRaw));
    const toolPolicyParsed = parseWithSchema("tool_policy.yaml", toolPolicyConfigSchema, camelizeKeys(toolPolicyRaw));

    return {
      // 加载器的输出就是系统内的“标准配置对象”，路径和字段名都已经规范化。
      ombot: normalizeOmbotConfigPaths(ombotParsed, projectRoot),
      llm: loadLlmConfigFromEnv(),
      monitors: normalizeMonitorsConfig(monitorsParsed),
      toolPolicy: normalizeToolPolicyConfig(toolPolicyParsed),
    };
  }
}
