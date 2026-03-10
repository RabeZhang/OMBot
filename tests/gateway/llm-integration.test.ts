import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LlmAgentRuntimeAdapter } from "../../src/agent/runtime";
import { InMemoryApprovalCenter } from "../../src/gateway/approvals";
import { GatewayCore } from "../../src/gateway/core";
import { InMemoryEventBus } from "../../src/gateway/event-bus";
import { createLlmClient } from "../../src/llm/client";
import { FileSessionStore } from "../../src/memory/session-store";
import { FileTranscriptStore } from "../../src/memory/transcript-store";
import { createLocalReadOnlyTools } from "../../src/tools/local";
import { ConfigDrivenToolPolicy } from "../../src/tools/policy";
import { InMemoryToolRegistry } from "../../src/tools/registry";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-llm-gateway-"));
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

describe("Gateway + LLM integration", () => {
  it("runs full gateway -> agent runtime -> llm client chain", async () => {
    const root = await createTempDir();
    let receivedBody = "";

    const server = http.createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      receivedBody = Buffer.concat(chunks).toString("utf8");

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "LLM 已确认：当前链路可用。",
              },
            },
          ],
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const toolRegistry = new InMemoryToolRegistry();
      for (const tool of createLocalReadOnlyTools()) {
        toolRegistry.register(tool);
      }

      const llmClient = createLlmClient({
        provider: "openai",
        modelName: "gpt-4o-mini",
        apiKey: "test-key",
        baseUrl: `http://127.0.0.1:${port}`,
        temperature: 0.1,
        timeoutMs: 120000,
      });

      const gateway = new GatewayCore({
        eventBus: new InMemoryEventBus(),
        approvalCenter: new InMemoryApprovalCenter({
          eventBus: new InMemoryEventBus(),
        }),
        agentRuntime: new LlmAgentRuntimeAdapter(
          llmClient,
          toolRegistry,
          new ConfigDrivenToolPolicy({
            profiles: {
              readonly: {
                defaultAction: "deny",
                allow: ["get_cpu_usage", "get_memory_usage", "get_process_status"],
              },
            },
          }),
        ),
        promptContext: {
          systemPrompt: "你是测试环境中的 OMBot。\n\n[Workspace: RUNBOOK.md]\n- 先核对事实",
        },
        sessionStore: new FileSessionStore({
          indexFilePath: path.join(root, "data/sessions/index.json"),
          hostId: "local-test",
        }),
        transcriptStore: new FileTranscriptStore({
          transcriptsDir: path.join(root, "data/transcripts"),
        }),
      });

      const run = await gateway.sendUserMessage({
        content: "请查看当前 CPU 和内存状态",
        title: "LLM integration session",
      });

      const events = await collectEvents(run.stream);
      const snapshot = await gateway.getSession(run.sessionId);

      expect(events).toHaveLength(11);
      expect(events[3]).toMatchObject({
        type: "tool.call",
        toolName: "get_cpu_usage",
      });
      expect(events[4]).toMatchObject({
        type: "tool.result",
        toolName: "get_cpu_usage",
      });
      expect(events[5]).toMatchObject({
        type: "tool.call",
        toolName: "get_memory_usage",
      });
      expect(events[6]).toMatchObject({
        type: "tool.result",
        toolName: "get_memory_usage",
      });
      expect(events[7]).toMatchObject({
        type: "agent.message_update",
        content: "LLM 已确认：当前链路可用。",
      });
      expect(snapshot?.transcript).toHaveLength(7);
      expect(snapshot?.transcript[1]?.kind).toBe("tool_call");
      expect(snapshot?.transcript[2]?.kind).toBe("tool_result");
      expect(snapshot?.transcript[3]?.kind).toBe("tool_call");
      expect(snapshot?.transcript[4]?.kind).toBe("tool_result");
      expect(snapshot?.transcript[5]?.payload).toMatchObject({
        role: "assistant",
        content: "LLM 已确认：当前链路可用。",
      });
      expect(receivedBody).toContain('"role":"system"');
      expect(receivedBody).toContain("你是测试环境中的 OMBot。");
      expect(receivedBody).toContain("RUNBOOK");
      expect(receivedBody).toContain("get_cpu_usage");
      expect(receivedBody).toContain("get_memory_usage");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
