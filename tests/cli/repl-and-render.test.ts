import { describe, expect, it } from "vitest";

import { parseCliCommand } from "../../src/cli/commands";
import { renderGatewayEvent, renderHelp, renderSessionSummaries } from "../../src/cli/render";

describe("parseCliCommand", () => {
  it("parses cli control commands", () => {
    expect(parseCliCommand("/help")).toEqual({ type: "help" });
    expect(parseCliCommand("/sessions")).toEqual({ type: "sessions", limit: 10 });
    expect(parseCliCommand("/sessions 20")).toEqual({ type: "sessions", limit: 20 });
    expect(parseCliCommand("/sessions all")).toEqual({ type: "sessions", limit: "all" });
    expect(parseCliCommand("/clear")).toEqual({ type: "clear" });
    expect(parseCliCommand("/host")).toEqual({ type: "host", action: "list" });
    expect(parseCliCommand("/host show")).toEqual({ type: "host", action: "show" });
    expect(parseCliCommand("/host refresh")).toEqual({ type: "host", action: "refresh" });
    expect(parseCliCommand("/approval auto")).toEqual({
      type: "approval_mode",
      action: "auto",
    });
    expect(parseCliCommand("/approval default")).toEqual({
      type: "approval_mode",
      action: "default",
    });
    expect(parseCliCommand("/approve a1f")).toEqual({
      type: "approval",
      action: "approve_once",
      content: "a1f",
    });
    expect(parseCliCommand("/deny a1f")).toEqual({
      type: "approval",
      action: "deny",
      content: "a1f",
    });
    expect(parseCliCommand("/session rm 1")).toEqual({
      type: "session",
      action: "rm",
      sessionIndex: 1,
    });
    expect(parseCliCommand("/session rm sess_123")).toEqual({
      type: "session",
      action: "rm",
      sessionId: "sess_123",
    });
    expect(parseCliCommand("/events")).toEqual({ type: "events", action: "list" });
    expect(parseCliCommand("/events runs")).toEqual({
      type: "events",
      action: "runs",
    });
    expect(parseCliCommand("/events show test.json")).toEqual({
      type: "events",
      action: "show",
      filename: "test.json",
    });
    expect(parseCliCommand("/event rm test.json")).toEqual({
      type: "event",
      action: "rm",
      filename: "test.json",
    });
    expect(parseCliCommand("/monitor")).toEqual({
      type: "monitor",
      action: "list",
    });
    expect(parseCliCommand("/monitor show")).toEqual({
      type: "monitor",
      action: "show",
    });
    expect(parseCliCommand("/exit")).toEqual({ type: "exit" });
    expect(parseCliCommand("/quit")).toEqual({ type: "exit" });
    expect(parseCliCommand("/use sess_123")).toEqual({
      type: "use",
      sessionId: "sess_123",
    });
    expect(parseCliCommand("/use new")).toEqual({
      type: "use",
      action: "new",
    });
    // 支持用编号切换 /use 1, /use 2
    expect(parseCliCommand("/use 1")).toEqual({
      type: "use",
      sessionIndex: 1,
    });
    expect(parseCliCommand("/use 10")).toEqual({
      type: "use",
      sessionIndex: 10,
    });
  });

  it("treats normal text as message command", () => {
    expect(parseCliCommand("现在服务器状态怎么样？")).toEqual({
      type: "message",
      content: "现在服务器状态怎么样？",
    });
  });
});

describe("render helpers", () => {
  it("renders gateway events for cli output", () => {
    expect(
      renderGatewayEvent({
        type: "tool.call",
        sessionId: "sess_1",
        runId: "run_1",
        toolName: "get_cpu_usage",
        toolInput: {},
      }),
    ).toContain("get_cpu_usage");

    expect(
      renderGatewayEvent({
        type: "agent.message_update",
        sessionId: "sess_1",
        runId: "run_1",
        content: "当前服务运行正常。",
      }),
    ).toBe("当前服务运行正常。");

    expect(
      renderGatewayEvent({
        type: "approval.required",
        sessionId: "sess_1",
        approvalId: "approval_1",
        approvalRef: "a1f",
        toolName: "write",
        reason: "写入配置",
      }),
    ).toContain("a1f");

    expect(
      renderGatewayEvent({
        type: "agent.summary",
        sessionId: "sess_1",
        runId: "run_1",
        summary: "LLM 响应已生成。",
      }),
    ).toBe("[summary] LLM 响应已生成。");
  });

  it("renders session summaries and help text", () => {
    expect(
      renderSessionSummaries([
        {
          sessionId: "sess_1",
          type: "interactive",
          status: "active",
          title: "CLI session",
          updatedAt: new Date().toISOString(),
        },
      ]),
    ).toContain("sess_1");

    expect(renderSessionSummaries([])).toBe("当前还没有会话。");
    expect(renderHelp()).toContain("/sessions");
    expect(renderHelp()).toContain("/use");
    expect(renderHelp()).toContain("/use new");
    expect(renderHelp()).toContain("/host");
    expect(renderHelp()).toContain("/host refresh");
    expect(renderHelp()).toContain("/host show");
    expect(renderHelp()).toContain("/approval auto");
    expect(renderHelp()).toContain("/approval default");
    expect(renderHelp()).toContain("/approve");
    expect(renderHelp()).toContain("/deny");
    expect(renderHelp()).toContain("/session rm");
    expect(renderHelp()).toContain("/events");
    expect(renderHelp()).toContain("/events runs");
    expect(renderHelp()).toContain("/event rm");
    expect(renderHelp()).toContain("/monitor");
    expect(renderHelp()).toContain("/monitor show");
  });
});
