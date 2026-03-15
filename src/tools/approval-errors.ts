export class ToolApprovalDeniedError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string, message = "Tool execution denied by user approval") {
    super(message);
    this.name = "ToolApprovalDeniedError";
    this.approvalId = approvalId;
  }
}

export class ToolApprovalTimeoutError extends Error {
  readonly approvalId: string;

  constructor(approvalId: string, message = "Tool execution approval timed out") {
    super(message);
    this.name = "ToolApprovalTimeoutError";
    this.approvalId = approvalId;
  }
}
