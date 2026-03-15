import { nowIsoString } from "../shared/time";
import type { ApprovalCenter, ApprovalRequest, ApprovalResolutionInput, ApprovalState, EventBus } from "./types";

interface InMemoryApprovalCenterOptions {
  eventBus: EventBus;
}

export class InMemoryApprovalCenter implements ApprovalCenter {
  private readonly approvals = new Map<string, ApprovalState>();
  private readonly waiters = new Map<string, Array<(state: ApprovalState) => void>>();
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
    const waiters = this.waiters.get(input.approvalId) ?? [];
    this.waiters.delete(input.approvalId);
    for (const waiter of waiters) {
      waiter(next);
    }
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

  async waitForResolution(
    approvalId: string,
    expiresAt: string,
    signal?: AbortSignal,
  ): Promise<{
    approvalId: string;
    status: "approved_once" | "denied" | "timed_out";
    resolvedAt: string;
  }> {
    const current = this.approvals.get(approvalId);
    if (!current) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    if (current.status === "approved_once" || current.status === "denied") {
      return {
        approvalId,
        status: current.status,
        resolvedAt: current.resolvedAt ?? nowIsoString(),
      };
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      const queue = this.waiters.get(approvalId) ?? [];
      const onAbort = () => {
        cleanup();
        reject(new Error(`Approval wait aborted: ${approvalId}`));
      };
      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          approvalId,
          status: "timed_out",
          resolvedAt: nowIsoString(),
        });
      }, timeoutMs);

      const waiter = (state: ApprovalState) => {
        cleanup();
        resolve({
          approvalId,
          status: state.status === "approved_once" ? "approved_once" : "denied",
          resolvedAt: state.resolvedAt ?? nowIsoString(),
        });
      };

      queue.push(waiter);
      this.waiters.set(approvalId, queue);

      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const cleanup = () => {
        clearTimeout(timeout);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
        const remaining = queue.filter((entry) => entry !== waiter);
        if (remaining.length === 0) {
          this.waiters.delete(approvalId);
        } else {
          this.waiters.set(approvalId, remaining);
        }
      };
    });
  }
}
