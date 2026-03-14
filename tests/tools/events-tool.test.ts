import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCreateEventTool } from "../../src/tools/local/events";
import { runWithToolRuntimeContext } from "../../src/tools/runtime-context";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-events-tool-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("create_event tool", () => {
  it("binds created event to current runtime session by default", async () => {
    const root = await createTempDir();
    const eventsDir = path.join(root, "events");
    const tool = createCreateEventTool({
      eventsDir,
      defaultTimezone: "Asia/Shanghai",
    });

    await runWithToolRuntimeContext({ sessionId: "sess_bound" }, async () => {
      await tool.execute("call_1", {
        type: "one-shot",
        text: "一分钟后检查服务",
        at: "2026-03-14T09:00:00+08:00",
      });
    });

    const files = await fs.readdir(eventsDir);
    expect(files).toHaveLength(1);
    const content = await fs.readFile(path.join(eventsDir, files[0]!), "utf8");
    const parsed = JSON.parse(content) as { sessionId?: string };
    expect(parsed.sessionId).toBe("sess_bound");
  });
});
