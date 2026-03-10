import type { AgentRuntimeAdapter, AgentRuntimeInput } from "../agent/types";
import { createId } from "../shared/ids";
import { nowIsoString } from "../shared/time";
import type { SessionStore, TranscriptStore } from "../memory/types";
import type { AuditStore } from "../audit/types";
import type {
  ApprovalCenter,
  ApprovalResolutionInput,
  EventBus,
  Gateway,
  GatewayEvent,
  GatewayRunHandle,
  MonitorEventInput,
  UserMessageInput,
} from "./types";

interface GatewayCoreOptions {
  sessionStore: SessionStore;
  transcriptStore: TranscriptStore;
  eventBus: EventBus;
  approvalCenter: ApprovalCenter;
  agentRuntime: AgentRuntimeAdapter;
  auditStore?: AuditStore;
  promptContext?: {
    systemPrompt?: string;
  };
}

class AsyncEventQueue {
  private readonly items: GatewayEvent[] = [];
  private readonly resolvers: Array<(value: IteratorResult<GatewayEvent>) => void> = [];
  private done = false;

  push(item: GatewayEvent) {
    if (this.done) {
      return;
    }

    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value: item, done: false });
      return;
    }

    this.items.push(item);
  }

  close() {
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      resolver?.({ value: undefined, done: true });
    }
  }

  async *iterate(): AsyncIterable<GatewayEvent> {
    // GatewayRunHandle 先用一个轻量异步队列实现，足够支撑当前测试和 CLI 骨架。
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as GatewayEvent;
        continue;
      }

      if (this.done) {
        return;
      }

      const next = await new Promise<IteratorResult<GatewayEvent>>((resolve) => {
        this.resolvers.push(resolve);
      });

      if (next.done) {
        return;
      }

      yield next.value;
    }
  }
}

export class GatewayCore implements Gateway {
  private readonly sessionStore: SessionStore;
  private readonly transcriptStore: TranscriptStore;
  private readonly eventBus: EventBus;
  private readonly approvalCenter: ApprovalCenter;
  private readonly agentRuntime: AgentRuntimeAdapter;
  private readonly auditStore?: AuditStore;
  private readonly promptContext: {
    systemPrompt?: string;
  };

  constructor(options: GatewayCoreOptions) {
    this.sessionStore = options.sessionStore;
    this.transcriptStore = options.transcriptStore;
    this.eventBus = options.eventBus;
    this.approvalCenter = options.approvalCenter;
    this.agentRuntime = options.agentRuntime;
    this.auditStore = options.auditStore;
    this.promptContext = options.promptContext ?? {};
  }

  async sendUserMessage(input: UserMessageInput): Promise<GatewayRunHandle> {
    const session = input.sessionId
      ? await this.getRequiredSession(input.sessionId)
      : await this.sessionStore.create({
        type: "interactive",
        title: input.title,
        channel: "cli",
      });

    const runId = createId("run");
    const queue = new AsyncEventQueue();
    const unsubscribe = this.eventBus.subscribe(async (event) => {
      if ("runId" in event && event.runId !== runId) {
        return;
      }

      if (event.sessionId !== session.sessionId) {
        return;
      }

      queue.push(event);

      if (event.type === "gateway.run.completed") {
        unsubscribe();
        queue.close();
      }
    });

    await this.transcriptStore.append({
      id: createId("entry"),
      sessionId: session.sessionId,
      kind: "message",
      createdAt: nowIsoString(),
      payload: {
        role: "user",
        content: input.content,
      },
    });

    await this.eventBus.publish({
      type: "gateway.run.started",
      sessionId: session.sessionId,
      runId,
    });

    // Phase 1 先把 Gateway 做成“接收并落盘”的控制面骨架，Agent 接入放到后续步骤。
    await this.eventBus.publish({
      type: "user.message.accepted",
      sessionId: session.sessionId,
      runId,
      content: input.content,
    });

    // 在后台启动 Agent，不阻塞 sendUserMessage 返回。
    // 事件通过 eventBus → AsyncEventQueue 实时推出，REPL 可逐一消费。
    setImmediate(async () => {
      try {
        await this.runAgent(session.sessionId, runId, {
          kind: "user_message",
          content: input.content,
        });
      } catch (err) {
        await this.eventBus.publish({
          type: "gateway.run.error",
          sessionId: session.sessionId,
          runId,
          error: err instanceof Error ? err.message : String(err),
        } as any);
      } finally {
        await this.eventBus.publish({
          type: "gateway.run.completed",
          sessionId: session.sessionId,
          runId,
        });
      }
    });

    return {
      sessionId: session.sessionId,
      runId,
      stream: queue.iterate(),
    };
  }

  async dispatchMonitorEvent(input: MonitorEventInput): Promise<GatewayRunHandle> {
    // Phase 1：monitor 事件只做记录和事件发布，不触发 LLM Agent 调用。
    // Agent 调用由用户主动发起，避免后台并发 LLM 请求阻塞用户的交互。
    const sessionId = createId("sess"); // 轻量 incident session，不写磁盘
    const runId = createId("run");
    const queue = new AsyncEventQueue();

    // 立即关闭队列（不触发 Agent 运行）
    queue.push({
      type: "gateway.run.started",
      sessionId,
      runId,
    });

    queue.push({
      type: input.type,
      sessionId,
      runId,
      summary: input.summary,
    });

    queue.push({
      type: "gateway.run.completed",
      sessionId,
      runId,
    });

    queue.close();

    return {
      sessionId,
      runId,
      stream: queue.iterate(),
    };
  }

  async resolveApproval(input: ApprovalResolutionInput): Promise<void> {
    await this.approvalCenter.resolve(input);
  }

  async listSessions() {
    return this.sessionStore.list();
  }

  async getSession(sessionId: string) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      return null;
    }

    const transcript = await this.transcriptStore.listBySession(sessionId);
    return {
      session,
      transcript,
    };
  }

  private async getRequiredSession(sessionId: string) {
    const session = await this.sessionStore.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private async runAgent(sessionId: string, runId: string, input: AgentRuntimeInput): Promise<void> {
    const session = await this.getRequiredSession(sessionId);

    // 这里先把 Gateway 和 Agent 事件链打通，PromptContext 细化会在真实运行时接入时继续完善。
    for await (const event of this.agentRuntime.run({
      session,
      runId,
      input,
      promptContext: this.promptContext,
      toolProfile: "readonly",
    })) {
      if (event.type === "agent.message_update") {
        await this.transcriptStore.append({
          id: createId("entry"),
          sessionId,
          kind: "message",
          createdAt: nowIsoString(),
          payload: {
            role: "assistant",
            content: event.content,
          },
        });
      }

      if (event.type === "tool.call") {
        await this.transcriptStore.append({
          id: createId("entry"),
          sessionId,
          kind: "tool_call",
          createdAt: nowIsoString(),
          payload: {
            toolName: event.toolName,
            input: event.toolInput,
          },
        });
      }

      if (event.type === "tool.result") {
        await this.transcriptStore.append({
          id: createId("entry"),
          sessionId,
          kind: "tool_result",
          createdAt: nowIsoString(),
          payload: {
            toolName: event.toolName,
            input: event.toolInput,
            output: event.toolOutput,
          },
        });

        // 审计记录：每次工具执行完成后记录
        if (this.auditStore) {
          const outputStr = typeof event.toolOutput === "string"
            ? event.toolOutput
            : JSON.stringify(event.toolOutput);

          await this.auditStore.append({
            auditId: createId("audit"),
            sessionId,
            toolName: event.toolName,
            riskLevel: "readonly",  // 后续可从 ToolRegistry 获取实际 riskLevel
            input: JSON.stringify(event.toolInput),
            decision: "allowed",
            resultStatus: "success",
            resultSummary: outputStr.slice(0, 500),
            createdAt: nowIsoString(),
          });
        }
      }

      if (event.type === "agent.summary") {
        await this.transcriptStore.append({
          id: createId("entry"),
          sessionId,
          kind: "summary",
          createdAt: nowIsoString(),
          payload: {
            summary: event.summary,
          },
        });
      }

      await this.eventBus.publish(event);
    }
  }
}
