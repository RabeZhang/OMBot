import { AsyncLocalStorage } from "node:async_hooks";

interface ToolRuntimeContextValue {
  sessionId: string;
}

const toolRuntimeContext = new AsyncLocalStorage<ToolRuntimeContextValue>();

export function runWithToolRuntimeContext<T>(value: ToolRuntimeContextValue, fn: () => Promise<T>): Promise<T> {
  return toolRuntimeContext.run(value, fn);
}

export function getCurrentToolSessionId(): string | undefined {
  return toolRuntimeContext.getStore()?.sessionId;
}
