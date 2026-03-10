import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

import type { AgentRunInput, AgentRuntimeAdapter, AgentRuntimeEvent } from "./types";

/**
 * 基于 pi-agent-core 的 Agent Runtime Adapter。
 *
 * 流式工作方式：
 * 1. 创建 Agent + 订阅事件
 * 2. 调用 agent.prompt() 触发 LLM
 * 3. 通过 AsyncGenerator 实时流出事件
 */
export class PiAgentRuntimeAdapter implements AgentRuntimeAdapter {
    private readonly model: Model<any>;
    private readonly tools: AgentTool[];
    private readonly apiKey: string;
    private readonly temperature: number;

    constructor(options: {
        model: Model<any>;
        tools: AgentTool[];
        apiKey: string;
        temperature?: number;
    }) {
        this.model = options.model;
        this.tools = options.tools;
        this.apiKey = options.apiKey;
        this.temperature = options.temperature ?? 0.1;
    }

    async *run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent> {
        const { session, runId } = input;
        const sessionId = session.sessionId;

        yield { type: "agent.start", sessionId, runId };

        // 构造 prompt 文本
        const promptText = this.buildPromptText(input);

        // 使用 Promise + 队列实现真正的流式事件传递
        const eventQueue: Array<AgentRuntimeEvent | null> = [];
        let resolveNext: (() => void) | null = null;
        let done = false;
        let error: Error | null = null;

        function enqueue(event: AgentRuntimeEvent | null) {
            eventQueue.push(event);
            resolveNext?.();
            resolveNext = null;
        }

        // 创建 pi Agent 实例
        const agent = new Agent({
            initialState: {
                systemPrompt: input.promptContext.systemPrompt ?? "",
                model: this.model,
                tools: this.tools,
            },
            convertToLlm: (messages) => messages.filter(
                (m) => "role" in m && ["user", "assistant", "toolResult"].includes((m as any).role),
            ) as any,
            getApiKey: async () => this.apiKey,
        });

        let finalAssistantContent = "";

        agent.subscribe((event: AgentEvent) => {
            switch (event.type) {
                case "tool_execution_start":
                    enqueue({
                        type: "tool.call",
                        sessionId,
                        runId,
                        toolName: event.toolName,
                        toolInput: event.args ?? {},
                    });
                    break;

                case "tool_execution_end":
                    enqueue({
                        type: "tool.result",
                        sessionId,
                        runId,
                        toolName: event.toolName,
                        toolInput: {},
                        toolOutput: event.result,
                    });
                    break;

                case "message_end": {
                    const msg = event.message;
                    if ("role" in msg && (msg as any).role === "assistant") {
                        const assistantMsg = msg as any;
                        const textParts = (assistantMsg.content ?? [])
                            .filter((c: any) => c.type === "text")
                            .map((c: any) => c.text);
                        const text = textParts.join("").trim();
                        if (text) {
                            finalAssistantContent = text;
                        }
                    }
                    break;
                }
            }
        });

        // 在后台执行 prompt，不阻塞 generator
        const agentPromise = agent.prompt(promptText)
            .then(() => agent.waitForIdle())
            .then(() => {
                done = true;
                enqueue(null); // sentinel to signal completion
            })
            .catch((err: Error) => {
                error = err;
                done = true;
                enqueue(null);
            });

        // 流式消费事件队列
        while (true) {
            if (eventQueue.length === 0) {
                if (done) break;
                // 等待新事件
                await new Promise<void>((resolve) => {
                    resolveNext = resolve;
                });
            }

            const item = eventQueue.shift();
            if (item === null || item === undefined) {
                // sentinel or done
                break;
            }

            yield item;
        }

        await agentPromise; // ensure cleanup

        if (error) {
            throw error;
        }

        // 发射最终助手消息
        if (finalAssistantContent) {
            yield {
                type: "agent.message_update",
                sessionId,
                runId,
                content: finalAssistantContent,
            };
        }

        yield {
            type: "agent.summary",
            sessionId,
            runId,
            summary: "pi Agent 响应已完成。",
        };

        yield { type: "agent.end", sessionId, runId };
    }

    private buildPromptText(input: AgentRunInput): string {
        if (input.input.kind === "user_message") {
            return input.input.content;
        }

        // 监控事件构造为结构化提示
        const event = input.input.event;
        return [
            "请基于以下监控事件给出简洁分析：",
            `规则 ID: ${event.ruleId}`,
            `事件类型: ${event.type}`,
            `严重级别: ${event.severity}`,
            `摘要: ${event.summary}`,
            `详情: ${JSON.stringify(event.details ?? {})}`,
        ].join("\n");
    }
}
