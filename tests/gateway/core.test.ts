import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FakeAgentRuntimeAdapter } from "../../src/agent/fake-runtime";
import { InMemoryApprovalCenter } from "../../src/gateway/approvals";
import { GatewayCore } from "../../src/gateway/core";
import { InMemoryEventBus } from "../../src/gateway/event-bus";
import { FileSessionStore } from "../../src/memory/session-store";
import { FileTranscriptStore } from "../../src/memory/transcript-store";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-gateway-"));
  tempDirs.push(dir);
  return dir;
}

async function collectEvents(stream: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("InMemoryEventBus", () => {
  it("publishes events to subscribers and supports unsubscribe", async () => {
    const eventBus = new InMemoryEventBus();
    const received: string[] = [];

    const unsubscribe = eventBus.subscribe(async (event) => {
      received.push(event.type);
    });

    await eventBus.publish({
      type: "gateway.run.started",
      sessionId: "sess_1",
      runId: "run_1",
    });

    unsubscribe();

    await eventBus.publish({
      type: "gateway.run.completed",
      sessionId: "sess_1",
      runId: "run_1",
    });

    expect(received).toEqual(["gateway.run.started"]);
  });
});

describe("InMemoryApprovalCenter", () => {
  it("stores approval state and emits lifecycle events", async () => {
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const received: string[] = [];

    eventBus.subscribe(async (event) => {
      received.push(event.type);
    });

    await approvalCenter.request({
      approvalId: "approval_1",
      sessionId: "sess_1",
      toolCallId: "tool_call_1",
      toolName: "restart_service",
      reason: "重启 nginx",
      expiresAt: new Date().toISOString(),
    });

    await approvalCenter.resolve({
      approvalId: "approval_1",
      action: "approve_once",
      resolvedBy: "tester",
    });

    const state = await approvalCenter.get("approval_1");

    expect(received).toEqual(["approval.required", "approval.resolved"]);
    expect(state?.status).toBe("approved_once");
    expect(state?.resolvedBy).toBe("tester");
  });
});

describe("GatewayCore", () => {
  it("creates interactive session for user message and appends transcript", async () => {
    const root = await createTempDir();
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const gateway = new GatewayCore({
      eventBus,
      approvalCenter,
      agentRuntime: new FakeAgentRuntimeAdapter(),
      sessionStore: new FileSessionStore({
        indexFilePath: path.join(root, "data/sessions/index.json"),
        hostId: "local-test",
      }),
      transcriptStore: new FileTranscriptStore({
        transcriptsDir: path.join(root, "data/transcripts"),
      }),
    });

    const run = await gateway.sendUserMessage({
      content: "现在 nginx 怎么样？",
      title: "CLI session",
    });

    const events = await collectEvents(run.stream);
    const snapshot = await gateway.getSession(run.sessionId);

    expect(events).toHaveLength(7);
    expect(events[0]).toMatchObject({ type: "gateway.run.started" });
    expect(events[1]).toMatchObject({ type: "user.message.accepted" });
    expect(events[2]).toMatchObject({ type: "agent.start" });
    expect(events[3]).toMatchObject({ type: "agent.message_update" });
    expect(events[4]).toMatchObject({ type: "agent.summary" });
    expect(events[5]).toMatchObject({ type: "agent.end" });
    expect(events[6]).toMatchObject({ type: "gateway.run.completed" });
    expect(snapshot?.session.type).toBe("interactive");
    expect(snapshot?.transcript).toHaveLength(3);
    expect(snapshot?.transcript[0]?.kind).toBe("message");
    expect(snapshot?.transcript[1]?.payload).toMatchObject({
      role: "assistant",
      content: "已收到请求：现在 nginx 怎么样？",
    });
    expect(snapshot?.transcript[2]?.kind).toBe("summary");
  });

  it("creates incident session for monitor event and appends monitor transcript", async () => {
    const root = await createTempDir();
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const gateway = new GatewayCore({
      eventBus,
      approvalCenter,
      agentRuntime: new FakeAgentRuntimeAdapter(),
      sessionStore: new FileSessionStore({
        indexFilePath: path.join(root, "data/sessions/index.json"),
        hostId: "local-test",
      }),
      transcriptStore: new FileTranscriptStore({
        transcriptsDir: path.join(root, "data/transcripts"),
      }),
    });

    const run = await gateway.dispatchMonitorEvent({
      ruleId: "nginx-process",
      severity: "warning",
      type: "monitor.alert",
      summary: "nginx 进程异常",
    });

    const events = await collectEvents(run.stream);

    // 新的轻量实现：monitor 事件不触发 Agent LLM 调用，只发 3 个事件
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "gateway.run.started" });
    expect(events[1]).toMatchObject({ type: "monitor.alert", summary: "nginx 进程异常" });
    expect(events[2]).toMatchObject({ type: "gateway.run.completed" });
  });

  it("creates system session for scheduled event and appends scheduled transcript", async () => {
    const root = await createTempDir();
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const gateway = new GatewayCore({
      eventBus,
      approvalCenter,
      agentRuntime: new FakeAgentRuntimeAdapter(),
      sessionStore: new FileSessionStore({
        indexFilePath: path.join(root, "data/sessions/index.json"),
        hostId: "local-test",
      }),
      transcriptStore: new FileTranscriptStore({
        transcriptsDir: path.join(root, "data/transcripts"),
      }),
    });

    const run = await gateway.dispatchScheduledEvent({
      eventId: "evt_daily-check",
      sourceFile: "daily-check.json",
      type: "periodic",
      text: "每天巡检一次 nginx 状态",
      profile: "readonly",
      scheduledAt: "0 9 * * *",
      triggeredAt: new Date().toISOString(),
      timezone: "Asia/Shanghai",
    });

    const events = await collectEvents(run.stream);
    const snapshot = await gateway.getSession(run.sessionId);

    expect(events).toHaveLength(7);
    expect(events[0]).toMatchObject({ type: "gateway.run.started" });
    expect(events[1]).toMatchObject({ type: "scheduled_event.accepted", sourceFile: "daily-check.json" });
    expect(events[2]).toMatchObject({ type: "agent.start" });
    expect(events[3]).toMatchObject({ type: "agent.message_update" });
    expect(events[6]).toMatchObject({ type: "gateway.run.completed" });
    expect(snapshot?.session.type).toBe("system");
    expect(snapshot?.transcript[0]?.kind).toBe("scheduled_event");
    expect(snapshot?.transcript[1]?.payload).toMatchObject({
      role: "assistant",
      content: "已处理定时事件：每天巡检一次 nginx 状态",
    });
  });

  it("deletes session, transcript, and bound event files together", async () => {
    const root = await createTempDir();
    const eventsDir = path.join(root, "workspace/events");
    await fs.mkdir(eventsDir, { recursive: true });

    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const gateway = new GatewayCore({
      eventBus,
      approvalCenter,
      agentRuntime: new FakeAgentRuntimeAdapter(),
      sessionStore: new FileSessionStore({
        indexFilePath: path.join(root, "data/sessions/index.json"),
        hostId: "local-test",
      }),
      transcriptStore: new FileTranscriptStore({
        transcriptsDir: path.join(root, "data/transcripts"),
      }),
      eventsDir,
    });

    const run = await gateway.sendUserMessage({
      content: "帮我创建一个一分钟后的提醒",
      title: "Event binding session",
    });
    await collectEvents(run.stream);

    await fs.writeFile(
      path.join(eventsDir, "bound.json"),
      JSON.stringify({
        type: "one-shot",
        text: "绑定到 session",
        at: "2026-03-14T09:00:00+08:00",
        sessionId: run.sessionId,
      }),
      "utf8",
    );

    await gateway.deleteSession(run.sessionId);

    expect(await gateway.getSession(run.sessionId)).toBeNull();
    await expect(fs.stat(path.join(root, "data/transcripts", `${run.sessionId}.jsonl`))).rejects.toThrow();
    await expect(fs.stat(path.join(eventsDir, "bound.json"))).rejects.toThrow();
  });
});
