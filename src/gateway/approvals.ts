import fs from "node:fs/promises";
import path from "node:path";

import { nowIsoString } from "../shared/time";
import type { ApprovalCenter, ApprovalRequest, ApprovalResolutionInput, ApprovalState, EventBus } from "./types";

interface InMemoryApprovalCenterOptions {
  eventBus: EventBus;
  persistenceFilePath?: string;
}

interface PersistedPendingApprovals {
  approvals: ApprovalState[];
}

export class InMemoryApprovalCenter implements ApprovalCenter {
  private readonly approvals = new Map<string, ApprovalState>();
  private readonly refs = new Map<string, string>();
  private readonly waiters = new Map<string, Array<(state: ApprovalState) => void>>();
  private readonly eventBus: EventBus;
  private readonly persistenceFilePath?: string;

  constructor(options: InMemoryApprovalCenterOptions) {
    this.eventBus = options.eventBus;
    this.persistenceFilePath = options.persistenceFilePath;
  }

  async init(): Promise<void> {
    if (!this.persistenceFilePath) {
      return;
    }

    try {
      const raw = await fs.readFile(this.persistenceFilePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedPendingApprovals;
      for (const approval of parsed.approvals ?? []) {
        if (approval.status !== "pending") {
          continue;
        }

        if (new Date(approval.expiresAt).getTime() <= Date.now()) {
          continue;
        }

        this.approvals.set(approval.approvalId, approval);
        this.refs.set(approval.approvalRef, approval.approvalId);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    await this.persistPendingApprovals();
  }

  async request(input: ApprovalRequest): Promise<void> {
    if (this.refs.has(input.approvalRef)) {
      throw new Error(`Approval ref already exists: ${input.approvalRef}`);
    }

    const state: ApprovalState = {
      ...input,
      status: "pending",
    };

    this.approvals.set(input.approvalId, state);
    this.refs.set(input.approvalRef, input.approvalId);
    await this.persistPendingApprovals();
    await this.eventBus.publish({
      type: "approval.required",
      sessionId: input.sessionId,
      approvalId: input.approvalId,
      approvalRef: input.approvalRef,
      toolName: input.toolName,
      reason: input.reason,
    });
  }

  async resolve(input: ApprovalResolutionInput): Promise<void> {
    const current = await this.getResolutionTarget(input);
    if (!current) {
      throw new Error(`Approval not found: ${input.approvalId ?? input.approvalRef ?? "unknown"}`);
    }

    const next: ApprovalState = {
      ...current,
      status: input.action === "approve_once" ? "approved_once" : "denied",
      resolvedBy: input.resolvedBy,
      resolvedAt: nowIsoString(),
    };

    this.approvals.set(current.approvalId, next);
    this.refs.delete(current.approvalRef);
    await this.persistPendingApprovals();

    const waiters = this.waiters.get(current.approvalId) ?? [];
    this.waiters.delete(current.approvalId);
    for (const waiter of waiters) {
      waiter(next);
    }

    await this.eventBus.publish({
      type: "approval.resolved",
      sessionId: current.sessionId,
      approvalId: current.approvalId,
      approvalRef: current.approvalRef,
      action: input.action,
    });
  }

  async get(approvalId: string): Promise<ApprovalState | null> {
    return this.approvals.get(approvalId) ?? null;
  }

  async getByRef(approvalRef: string): Promise<ApprovalState | null> {
    const approvalId = this.refs.get(approvalRef);
    if (!approvalId) {
      return null;
    }
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
      const timeout = setTimeout(async () => {
        cleanup();
        await this.expirePendingApproval(approvalId);
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

  private async getResolutionTarget(input: ApprovalResolutionInput): Promise<ApprovalState | null> {
    if (input.approvalId) {
      return this.approvals.get(input.approvalId) ?? null;
    }

    if (input.approvalRef) {
      return this.getByRef(input.approvalRef);
    }

    throw new Error("Approval resolution requires approvalId or approvalRef");
  }

  private async expirePendingApproval(approvalId: string): Promise<void> {
    const state = this.approvals.get(approvalId);
    if (!state || state.status !== "pending") {
      return;
    }

    this.refs.delete(state.approvalRef);
    this.approvals.delete(approvalId);
    await this.persistPendingApprovals();
  }

  private async persistPendingApprovals(): Promise<void> {
    if (!this.persistenceFilePath) {
      return;
    }

    const pending = [...this.approvals.values()].filter((approval) => approval.status === "pending");
    await fs.mkdir(path.dirname(this.persistenceFilePath), { recursive: true });
    await fs.writeFile(
      this.persistenceFilePath,
      JSON.stringify({ approvals: pending } satisfies PersistedPendingApprovals, null, 2),
      "utf8",
    );
  }
}
