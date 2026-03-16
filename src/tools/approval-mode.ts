import type { ToolApprovalMode } from "../gateway/types";

export interface ToolApprovalModeController {
  getMode(): ToolApprovalMode;
  setMode(mode: ToolApprovalMode): void;
}

export class InMemoryToolApprovalModeController implements ToolApprovalModeController {
  private mode: ToolApprovalMode;

  constructor(initialMode: ToolApprovalMode = "default") {
    this.mode = initialMode;
  }

  getMode(): ToolApprovalMode {
    return this.mode;
  }

  setMode(mode: ToolApprovalMode): void {
    this.mode = mode;
  }
}
