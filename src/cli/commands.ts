/**
 * CLI 命令解析。
 * 从旧的 repl.ts 中提取出来作为独立模块，供新旧 REPL 共用。
 */

export interface CliCommand {
  type: "help" | "sessions" | "use" | "clear" | "exit" | "message";
  sessionId?: string;
  content?: string;
}

export function parseCliCommand(line: string): CliCommand {
  const trimmed = line.trim();

  if (trimmed === "/help") {
    return { type: "help" };
  }

  if (trimmed === "/sessions") {
    return { type: "sessions" };
  }

  if (trimmed === "/clear") {
    return { type: "clear" };
  }

  if (trimmed === "/exit" || trimmed === "/quit") {
    return { type: "exit" };
  }

  if (trimmed.startsWith("/use ")) {
    const sessionId = trimmed.slice(5).trim();
    return { type: "use", sessionId };
  }

  return {
    type: "message",
    content: trimmed,
  };
}
