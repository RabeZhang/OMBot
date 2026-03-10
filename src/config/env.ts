import { ConfigError } from "../shared/errors";

const envPattern = /\$\{([A-Z0-9_]+)\}/g;

export function expandEnvVars(input: string, env: NodeJS.ProcessEnv = process.env): string {
  // 配置文件统一在加载阶段展开环境变量，避免后续模块再各自处理占位符。
  return input.replace(envPattern, (_match, varName: string) => {
    const value = env[varName];
    if (value === undefined || value === "") {
      throw new ConfigError(`缺少环境变量: ${varName}`);
    }
    return value;
  });
}
