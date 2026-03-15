import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import { createId } from "../shared/ids";
import type { ApprovalCenter } from "../gateway/types";
import { ToolApprovalDeniedError, ToolApprovalTimeoutError } from "./approval-errors";
import { inspectToolRisk } from "./risk-inspector";
import { getCurrentToolSessionId } from "./runtime-context";

export interface SecureExecutionOptions {
  approvalCenter: ApprovalCenter;
  approvalTimeoutSec: number;
}

export function wrapProtectedAgentTools(
  tools: AgentTool[],
  options: SecureExecutionOptions,
): AgentTool[] {
  return tools.map((tool) => {
    if (!isProtectedTool(tool.name)) {
      return tool;
    }

    return {
      ...tool,
      async execute(
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: unknown,
      ): Promise<AgentToolResult<unknown>> {
        const sessionId = getCurrentToolSessionId();
        if (!sessionId) {
          throw new Error(`Protected tool ${tool.name} missing runtime session context`);
        }

        const inspection = inspectToolRisk(tool.name, params);
        if (!inspection.requiresApproval) {
          return tool.execute(toolCallId, params, signal, onUpdate);
        }

        const approvalId = createId("approval");
        const expiresAt = new Date(Date.now() + options.approvalTimeoutSec * 1000).toISOString();

        await options.approvalCenter.request({
          approvalId,
          sessionId,
          toolCallId,
          toolName: tool.name,
          reason: inspection.reason ?? `${tool.name} requires user confirmation`,
          expiresAt,
        });

        const resolution = await options.approvalCenter.waitForResolution(
          approvalId,
          expiresAt,
          signal,
        );

        if (resolution.status === "denied") {
          throw new ToolApprovalDeniedError(approvalId);
        }

        if (resolution.status === "timed_out") {
          throw new ToolApprovalTimeoutError(approvalId);
        }

        return tool.execute(toolCallId, params, signal, onUpdate);
      },
    };
  });
}

function isProtectedTool(toolName: string): boolean {
  return toolName === "bash" || toolName === "edit" || toolName === "write";
}
