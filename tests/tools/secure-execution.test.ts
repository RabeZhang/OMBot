import type { AgentTool } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";

import { InMemoryApprovalCenter } from "../../src/gateway/approvals";
import { InMemoryEventBus } from "../../src/gateway/event-bus";
import { InMemoryToolApprovalModeController } from "../../src/tools/approval-mode";
import { ToolApprovalDeniedError } from "../../src/tools/approval-errors";
import { runWithToolRuntimeContext } from "../../src/tools/runtime-context";
import { wrapProtectedAgentTools } from "../../src/tools/secure-execution";

function createTestTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: `${name} test tool`,
    parameters: {},
    async execute() {
      return {
        content: [{ type: "text", text: `${name}-ok` }],
      };
    },
  };
}

describe("wrapProtectedAgentTools", () => {
  it("executes safe bash commands without approval", async () => {
    const wrapped = wrapProtectedAgentTools(
      [createTestTool("bash")],
      {
        approvalCenter: new InMemoryApprovalCenter({ eventBus: new InMemoryEventBus() }),
        approvalTimeoutSec: 1,
        getApprovalMode: () => "default",
      },
    );

    const result = await runWithToolRuntimeContext({ sessionId: "sess_1" }, () =>
      wrapped[0]!.execute("tool_call_1", { command: "ls -la" }),
    );

    expect(result).toMatchObject({
      content: [{ type: "text", text: "bash-ok" }],
    });
  });

  it("blocks dangerous bash commands until approved", async () => {
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const approvalMode = new InMemoryToolApprovalModeController("default");
    const wrapped = wrapProtectedAgentTools(
      [createTestTool("bash")],
      {
        approvalCenter,
        approvalTimeoutSec: 2,
        getApprovalMode: () => approvalMode.getMode(),
      },
    );

    const approvalRefPromise = new Promise<string>((resolve) => {
      const unsubscribe = eventBus.subscribe(async (event) => {
        if (event.type === "approval.required") {
          unsubscribe();
          resolve(event.approvalRef);
        }
      });
    });

    const execution = runWithToolRuntimeContext({ sessionId: "sess_1" }, () =>
      wrapped[0]!.execute("tool_call_1", { command: "rm -rf /tmp/test" }),
    );

    const approvalRef = await approvalRefPromise;
    await approvalCenter.resolve({
      approvalRef,
      action: "approve_once",
      resolvedBy: "tester",
    });

    await expect(execution).resolves.toMatchObject({
      content: [{ type: "text", text: "bash-ok" }],
    });
  });

  it("throws and stops on denied protected tools", async () => {
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const approvalMode = new InMemoryToolApprovalModeController("default");
    const wrapped = wrapProtectedAgentTools(
      [createTestTool("write")],
      {
        approvalCenter,
        approvalTimeoutSec: 2,
        getApprovalMode: () => approvalMode.getMode(),
      },
    );

    const approvalRefPromise = new Promise<string>((resolve) => {
      const unsubscribe = eventBus.subscribe(async (event) => {
        if (event.type === "approval.required") {
          unsubscribe();
          resolve(event.approvalRef);
        }
      });
    });

    const execution = runWithToolRuntimeContext({ sessionId: "sess_1" }, () =>
      wrapped[0]!.execute("tool_call_1", { file: "test.txt", content: "hello" }),
    );

    const approvalRef = await approvalRefPromise;
    await approvalCenter.resolve({
      approvalRef,
      action: "deny",
      resolvedBy: "tester",
    });

    await expect(execution).rejects.toBeInstanceOf(ToolApprovalDeniedError);
  });

  it("bypasses approval in auto mode for protected tools", async () => {
    const eventBus = new InMemoryEventBus();
    const approvalCenter = new InMemoryApprovalCenter({ eventBus });
    const approvalMode = new InMemoryToolApprovalModeController("auto");
    const wrapped = wrapProtectedAgentTools(
      [createTestTool("write")],
      {
        approvalCenter,
        approvalTimeoutSec: 2,
        getApprovalMode: () => approvalMode.getMode(),
      },
    );

    const received: string[] = [];
    eventBus.subscribe(async (event) => {
      received.push(event.type);
    });

    const result = await runWithToolRuntimeContext({ sessionId: "sess_1" }, () =>
      wrapped[0]!.execute("tool_call_1", { file: "test.txt", content: "hello" }),
    );

    expect(result).toMatchObject({
      content: [{ type: "text", text: "write-ok" }],
    });
    expect(received).toEqual([]);
  });
});
