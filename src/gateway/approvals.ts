import { nowIsoString } from "../shared/time";
import type { ApprovalCenter, ApprovalRequest, ApprovalResolutionInput, ApprovalState, EventBus } from "./types";

interface InMemoryApprovalCenterOptions {
  eventBus: EventBus;
}

export class InMemoryApprovalCenter implements ApprovalCenter {
  private readonly approvals = new Map<string, ApprovalState>();
  private readonly eventBus: EventBus;

  constructor(options: InMemoryApprovalCenterOptions) {
    this.eventBus = options.eventBus;
  }

  async request(input: ApprovalRequest): Promise<void> {
    // 审批状态先保存在内存里，后续再接审计库和更完整的生命周期管理。
    const state: ApprovalState = {
      ...input,
      status: "pending",
    };

    this.approvals.set(input.approvalId, state);
    await this.eventBus.publish({
      type: "approval.required",
      sessionId: input.sessionId,
      approvalId: input.approvalId,
      toolName: input.toolName,
      reason: input.reason,
    });
  }

  async resolve(input: ApprovalResolutionInput): Promise<void> {
    const current = this.approvals.get(input.approvalId);
    if (!current) {
      throw new Error(`Approval not found: ${input.approvalId}`);
    }

    const next: ApprovalState = {
      ...current,
      status: input.action === "approve_once" ? "approved_once" : "denied",
      resolvedBy: input.resolvedBy,
      resolvedAt: nowIsoString(),
    };

    this.approvals.set(input.approvalId, next);
    await this.eventBus.publish({
      type: "approval.resolved",
      sessionId: current.sessionId,
      approvalId: input.approvalId,
      action: input.action,
    });
  }

  async get(approvalId: string): Promise<ApprovalState | null> {
    return this.approvals.get(approvalId) ?? null;
  }
}
