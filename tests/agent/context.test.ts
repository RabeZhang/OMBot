import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildPromptContext } from "../../src/agent/context";
import type { OmbotConfig } from "../../src/config/schema";

const tempDirs: string[] = [];

async function createTempProject() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-context-"));
  tempDirs.push(tempRoot);
  return tempRoot;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("buildPromptContext", () => {
  it("combines system prompt template and workspace files", async () => {
    const root = await createTempProject();
    const systemPromptPath = path.join(root, "config/prompts/system.txt");
    const runbookPath = path.join(root, "workspace/RUNBOOK.md");
    const toolsPath = path.join(root, "workspace/TOOLS.md");

    await fs.mkdir(path.dirname(systemPromptPath), { recursive: true });
    await fs.mkdir(path.dirname(runbookPath), { recursive: true });
    await fs.writeFile(systemPromptPath, "你是 OMBot。", "utf8");
    await fs.writeFile(runbookPath, "# Runbook\n- 先收集事实", "utf8");
    await fs.writeFile(toolsPath, "# Tools\n- get_cpu_usage", "utf8");

    const config: OmbotConfig = {
      app: {
        name: "OMBot",
        env: "development",
        hostId: "local-test",
      },
      agent: {
        maxContextMessages: 30,
        autoSummaryThreshold: 24,
        systemPromptTemplate: systemPromptPath,
        workspaceFiles: [runbookPath, toolsPath],
      },
      gateway: {
        mode: "embedded",
        localCliEnabled: true,
        approvalTimeoutSec: 300,
      },
      logging: {
        level: "info",
        pretty: true,
      },
      execution: {
        mode: "host",
      },
      events: {
        enabled: false,
        dir: path.join(root, "workspace/events"),
        defaultTimezone: "Asia/Shanghai",
        maxQueuedPerSession: 5,
        startupScan: true,
      },
      paths: {
        dataDir: path.join(root, "data"),
        workspaceDir: path.join(root, "workspace"),
        transcriptsDir: path.join(root, "data/sessions"),
        auditDbPath: path.join(root, "data/audit/audit.db"),
      },
    };

    const promptContext = await buildPromptContext(config);

    expect(promptContext.systemPrompt).toContain("你是 OMBot。");
    expect(promptContext.systemPrompt).toContain("[Workspace: RUNBOOK.md]");
    expect(promptContext.systemPrompt).toContain("先收集事实");
    expect(promptContext.systemPrompt).toContain("[Workspace: TOOLS.md]");
    expect(promptContext.systemPrompt).toContain("get_cpu_usage");
  });
});
