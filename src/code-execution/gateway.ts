import type { CodeExecutionBackend, CodeExecutionRequest, CodeExecutionResult } from "./types";

export class CodeExecutionGateway {
  private readonly backend: CodeExecutionBackend;

  constructor(options: { backend: CodeExecutionBackend }) {
    this.backend = options.backend;
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    return this.backend.run(request);
  }
}
