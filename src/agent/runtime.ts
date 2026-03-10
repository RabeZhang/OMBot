import type { LlmClient, LlmMessage } from "../llm/types";
import type { ToolPolicy, ToolRegistry } from "../tools/types";
import type { AgentRunInput, AgentRuntimeAdapter, AgentRuntimeEvent } from "./types";
import {
  HeuristicToolOrchestrator,
  type ToolExecutionRecord,
  type ToolOrchestrator,
} from "./tool-orchestrator";

function buildMessages(input: AgentRunInput, toolExecutions: ToolExecutionRecord[]): LlmMessage[] {
  const messages: LlmMessage[] = [];

  if (input.promptContext.systemPrompt) {
    messages.push({
      role: "system",
      content: input.promptContext.systemPrompt,
    });
  }

  if (toolExecutions.length > 0) {
    messages.push({
      role: "system",
      content: [
        "以下是通过系统工具获取到的实时事实，请优先基于这些事实回答：",
        JSON.stringify(toolExecutions, null, 2),
      ].join("\n"),
    });
  }

  if (input.input.kind === "user_message") {
    messages.push({
      role: "user",
      content: input.input.content,
    });
    return messages;
  }

  messages.push({
    role: "user",
    content: [
      "请基于以下监控事件给出简洁分析：",
      `规则 ID: ${input.input.event.ruleId}`,
      `事件类型: ${input.input.event.type}`,
      `严重级别: ${input.input.event.severity}`,
      `摘要: ${input.input.event.summary}`,
      `详情: ${JSON.stringify(input.input.event.details ?? {})}`,
    ].join("\n"),
  });

  return messages;
}

export class LlmAgentRuntimeAdapter implements AgentRuntimeAdapter {
  private readonly llmClient: LlmClient;
  private readonly toolOrchestrator: ToolOrchestrator;

  constructor(llmClient: LlmClient, toolRegistry: ToolRegistry, toolPolicy: ToolPolicy) {
    this.llmClient = llmClient;
    this.toolOrchestrator = new HeuristicToolOrchestrator(toolRegistry, toolPolicy);
  }

  async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
    const { session, runId } = input;

    // 运行时目前只负责“构造消息 -> 调 LLM -> 输出事件”，工具调用以后再逐步接入。
    yield {
      type: "agent.start",
      sessionId: session.sessionId,
      runId,
    };

    // 运行时本身只关心“工具事实 + LLM 生成”，工具挑选与执行交给编排器。
    const { toolExecutions, runtimeEvents } = await this.toolOrchestrator.execute(input);

    for (const event of runtimeEvents) {
      yield event;
    }

    const result = await this.llmClient.generateText({
      messages: buildMessages(input, toolExecutions),
    });

    yield {
      type: "agent.message_update",
      sessionId: session.sessionId,
      runId,
      content: result.content,
    };

    // 先用一个稳定的 summary 占位，后续可替换为更智能的摘要或结构化运行结果。
    yield {
      type: "agent.summary",
      sessionId: session.sessionId,
      runId,
      summary: "LLM 响应已生成。",
    };

    yield {
      type: "agent.end",
      sessionId: session.sessionId,
      runId,
    };
  }
}
