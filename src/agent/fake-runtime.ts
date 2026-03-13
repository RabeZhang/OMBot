import type { AgentRunInput, AgentRuntimeAdapter, AgentRuntimeEvent } from "./types";

export class FakeAgentRuntimeAdapter implements AgentRuntimeAdapter {
  async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const { session, runId } = input;

    // Fake runtime 的目的不是模拟完整推理，而是先把 Gateway -> Agent -> Event 的链路接通。
    yield {
      type: "agent.start",
      sessionId: session.sessionId,
      runId,
    };

    if (input.input.kind === "user_message") {
      const content = `已收到请求：${input.input.content}`;

      yield {
        type: "agent.message_update",
        sessionId: session.sessionId,
        runId,
        content,
      };

      yield {
        type: "agent.summary",
        sessionId: session.sessionId,
        runId,
        summary: "用户消息已进入 Agent 运行时处理链路。",
      };
    } else if (input.input.kind === "monitor_event") {
      const content = `已分析监控事件：${input.input.event.summary}`;

      yield {
        type: "agent.message_update",
        sessionId: session.sessionId,
        runId,
        content,
      };

      yield {
        type: "agent.summary",
        sessionId: session.sessionId,
        runId,
        summary: "监控事件已进入 Agent 运行时处理链路。",
      };
    } else {
      const content = `已处理定时事件：${input.input.event.text}`;

      yield {
        type: "agent.message_update",
        sessionId: session.sessionId,
        runId,
        content,
      };

      yield {
        type: "agent.summary",
        sessionId: session.sessionId,
        runId,
        summary: "定时事件已进入 Agent 运行时处理链路。",
      };
    }

    yield {
      type: "agent.end",
      sessionId: session.sessionId,
      runId,
    };
  }
}
