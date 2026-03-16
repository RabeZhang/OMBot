export type ToolRiskLevel = "readonly" | "mutating" | "privileged";

export interface ToolExecutionContext {
  sessionId: string;
}

// 这里先用最小工具定义，后续再逐步补审计、进度回调和取消信号。
export interface OmbotToolDefinition<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresConfirmation?: boolean;
  parametersSchema: unknown;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<TResult>;
}
