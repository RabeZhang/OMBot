import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadProjectEnv } from "../../src/config/dotenv";

const tempDirs: string[] = [];

async function createTempProject(envContent: string) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-dotenv-"));
  tempDirs.push(tempRoot);
  await fs.writeFile(path.join(tempRoot, ".env"), envContent, "utf8");
  return tempRoot;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  delete process.env.LLM_MODEL_NAME;
  delete process.env.LLM_API_KEY;
});

describe("loadProjectEnv", () => {
  it("loads variables from project root .env file", async () => {
    const projectRoot = await createTempProject("LLM_MODEL_NAME=gpt-4o-mini\nLLM_API_KEY=test-key\n");

    loadProjectEnv(projectRoot);

    expect(process.env.LLM_MODEL_NAME).toBe("gpt-4o-mini");
    expect(process.env.LLM_API_KEY).toBe("test-key");
  });
});
