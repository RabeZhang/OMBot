import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

export function loadProjectEnv(projectRoot: string): void {
  const envPath = path.join(projectRoot, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  // Phase 1 默认只做本地开发加载，不覆盖已经显式传入的环境变量。
  dotenv.config({
    path: envPath,
    override: false,
    quiet: true,
  });
}
