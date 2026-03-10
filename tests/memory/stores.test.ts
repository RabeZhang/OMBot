import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileSessionStore } from "../../src/memory/session-store";
import { FileTranscriptStore } from "../../src/memory/transcript-store";
import type { TranscriptEntry } from "../../src/memory/types";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-memory-"));
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

describe("FileSessionStore", () => {
  it("creates and lists sessions", async () => {
    const root = await createTempDir();
    const store = new FileSessionStore({
      indexFilePath: path.join(root, "data/sessions/index.json"),
      hostId: "local-test",
    });

    const first = await store.create({ type: "interactive", title: "First session" });
    const second = await store.create({ type: "incident", relatedMonitorKey: "nginx-process" });

    const listed = await store.list();
    const loaded = await store.get(first.sessionId);

    expect(first.hostId).toBe("local-test");
    expect(second.channel).toBe("cli");
    expect(listed).toHaveLength(2);
    expect(listed[0]?.sessionId).toBe(second.sessionId);
    expect(loaded?.title).toBe("First session");
  });

  it("updates existing sessions and refreshes updatedAt", async () => {
    const root = await createTempDir();
    const store = new FileSessionStore({
      indexFilePath: path.join(root, "data/sessions/index.json"),
      hostId: "local-test",
    });

    const session = await store.create({ type: "interactive", title: "Before update" });
    const before = session.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));

    await store.update({
      ...session,
      status: "idle",
      title: "After update",
    });

    const updated = await store.get(session.sessionId);

    expect(updated?.status).toBe("idle");
    expect(updated?.title).toBe("After update");
    expect(updated?.updatedAt && updated.updatedAt > before).toBe(true);
  });
});

describe("FileTranscriptStore", () => {
  it("appends and reads transcript entries", async () => {
    const root = await createTempDir();
    const store = new FileTranscriptStore({
      transcriptsDir: path.join(root, "data/transcripts"),
    });

    const entries: TranscriptEntry[] = [
      {
        id: "entry_1",
        sessionId: "sess_1",
        kind: "message",
        createdAt: new Date().toISOString(),
        payload: { role: "user", content: "hello" },
      },
      {
        id: "entry_2",
        parentId: "entry_1",
        sessionId: "sess_1",
        kind: "tool_result",
        createdAt: new Date().toISOString(),
        payload: { tool: "get_cpu_usage", value: 12 },
      },
    ];

    for (const entry of entries) {
      await store.append(entry);
    }

    const allEntries = await store.listBySession("sess_1");
    const limitedEntries = await store.listBySession("sess_1", 1);

    expect(allEntries).toHaveLength(2);
    expect(allEntries[0]?.id).toBe("entry_1");
    expect(allEntries[1]?.id).toBe("entry_2");
    expect(limitedEntries).toHaveLength(1);
    expect(limitedEntries[0]?.id).toBe("entry_2");
  });

  it("returns empty array for missing transcript file", async () => {
    const root = await createTempDir();
    const store = new FileTranscriptStore({
      transcriptsDir: path.join(root, "data/transcripts"),
    });

    const entries = await store.listBySession("unknown-session");

    expect(entries).toEqual([]);
  });
});
