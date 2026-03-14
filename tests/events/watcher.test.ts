import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EventsWatcher } from "../../src/events/watcher";
import type { Gateway, ScheduledEventInput } from "../../src/gateway/types";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-events-"));
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

function createGatewaySpy(calls: ScheduledEventInput[]): Gateway {
  return {
    async sendUserMessage() {
      throw new Error("not implemented");
    },
    async dispatchMonitorEvent() {
      throw new Error("not implemented");
    },
    async dispatchScheduledEvent(input: ScheduledEventInput) {
      calls.push(input);
      return {
        sessionId: input.sessionId ?? "sess_test",
        runId: "run_test",
        stream: (async function* () {})(),
      };
    },
    async resolveApproval() {},
    async listSessions() {
      return [];
    },
    async getSession() {
      return null;
    },
    async deleteSession() {},
    async updateSessionTitle() {},
  };
}

describe("EventsWatcher", () => {
  it("dispatches immediate events created after startup", async () => {
    const root = await createTempDir();
    const eventsDir = path.join(root, "events");
    await fs.mkdir(eventsDir, { recursive: true });

    const calls: ScheduledEventInput[] = [];
    const watcher = new EventsWatcher({
      eventsDir,
      gateway: createGatewaySpy(calls),
      defaultTimezone: "Asia/Shanghai",
      enableFileWatch: false,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    await fs.writeFile(
      path.join(eventsDir, "immediate.json"),
      JSON.stringify({
        type: "immediate",
        text: "立刻检查 nginx",
      }),
      "utf8",
    );

    await watcher.processFile("immediate.json");
    watcher.stop();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("immediate");
    expect(calls[0]?.text).toBe("立刻检查 nginx");
  });

  it("schedules future one-shot events during startup scan", async () => {
    const root = await createTempDir();
    const eventsDir = path.join(root, "events");
    await fs.mkdir(eventsDir, { recursive: true });

    const eventTime = new Date(Date.now() + 150).toISOString();
    await fs.writeFile(
      path.join(eventsDir, "future.json"),
      JSON.stringify({
        type: "one-shot",
        text: "稍后执行",
        at: eventTime,
      }),
      "utf8",
    );

    const calls: ScheduledEventInput[] = [];
    const watcher = new EventsWatcher({
      eventsDir,
      gateway: createGatewaySpy(calls),
      defaultTimezone: "Asia/Shanghai",
      enableFileWatch: false,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    watcher.stop();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.type).toBe("one-shot");
    expect(calls[0]?.scheduledAt).toBe(eventTime);
  });

  it("deletes past one-shot events during startup scan", async () => {
    const root = await createTempDir();
    const eventsDir = path.join(root, "events");
    await fs.mkdir(eventsDir, { recursive: true });

    await fs.writeFile(
      path.join(eventsDir, "past.json"),
      JSON.stringify({
        type: "one-shot",
        text: "过期事件",
        at: "2020-01-01T00:00:00+08:00",
      }),
      "utf8",
    );

    const calls: ScheduledEventInput[] = [];
    const watcher = new EventsWatcher({
      eventsDir,
      gateway: createGatewaySpy(calls),
      defaultTimezone: "Asia/Shanghai",
      enableFileWatch: false,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    watcher.stop();

    expect(calls).toHaveLength(0);
    await expect(fs.stat(path.join(eventsDir, "past.json"))).rejects.toThrow();
  });
});
