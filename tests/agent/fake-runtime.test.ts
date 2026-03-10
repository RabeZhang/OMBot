import { describe, expect, it } from "vitest";

import { FakeAgentRuntimeAdapter } from "../../src/agent/fake-runtime";
import type { AgentRuntimeEvent } from "../../src/agent/types";

async function collectEvents(stream: AsyncIterable<AgentRuntimeEvent>) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("FakeAgentRuntimeAdapter", () => {
  it("emits expected event sequence for user message", async () => {
    const runtime = new FakeAgentRuntimeAdapter();

    const events = await collectEvents(
      runtime.run({
        session: {
          sessionId: "sess_1",
          type: "interactive",
          status: "active",
          hostId: "local-test",
          channel: "cli",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        runId: "run_1",
        promptContext: {},
        input: {
          kind: "user_message",
          content: "现在 nginx 怎么样？",
        },
        toolProfile: "readonly",
      }),
    );

    expect(events.map((event) => event.type)).toEqual([
      "agent.start",
      "agent.message_update",
      "agent.summary",
      "agent.end",
    ]);
    expect(events[1]).toMatchObject({
      type: "agent.message_update",
      content: "已收到请求：现在 nginx 怎么样？",
    });
  });
});
