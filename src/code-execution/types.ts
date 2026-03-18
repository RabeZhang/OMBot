export type CodeLanguage = "python" | "typescript";
export type CodeExecutionBackendKind = "local_sandbox";

export interface CodeExecutionInputFile {
  path: string;
  content: string;
}

export interface CodeExecutionArtifact {
  path: string;
  sizeBytes: number;
}

export interface CodeExecutionRequest {
  language: CodeLanguage;
  code: string;
  files?: CodeExecutionInputFile[];
  timeoutSec?: number;
}

export interface CodeExecutionResult {
  ok: boolean;
  language: CodeLanguage;
  backend: CodeExecutionBackendKind;
  isolationLevel: "lightweight";
  summary: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  artifacts: CodeExecutionArtifact[];
}

export interface CodeExecutionBackend {
  readonly kind: CodeExecutionBackendKind;
  run(request: CodeExecutionRequest): Promise<CodeExecutionResult>;
}
