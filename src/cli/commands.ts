/**
 * CLI 命令解析。
 * 从旧的 repl.ts 中提取出来作为独立模块，供新旧 REPL 共用。
 */

export interface CliCommand {
  type: "help" | "sessions" | "use" | "clear" | "exit" | "message";
  sessionId?: string;
  sessionIndex?: number; // 用于 /use 1, /use 2 这样的编号切换
  content?: string;
  limit?: number | "all";
}

export function parseCliCommand(line: string): CliCommand {
  const trimmed = line.trim();

  if (trimmed === "/help") {
    return { type: "help" };
  }

  if (trimmed === "/sessions" || trimmed.startsWith("/sessions ")) {
    const arg = trimmed.slice(10).trim();
    if (!arg || arg === "all") {
      return { type: "sessions", limit: arg === "all" ? "all" : 10 };
    }
    const num = parseInt(arg, 10);
    if (!isNaN(num) && num > 0) {
      return { type: "sessions", limit: num };
    }
    return { type: "sessions", limit: 10 };
  }

  if (trimmed === "/clear") {
    return { type: "clear" };
  }

  if (trimmed === "/exit" || trimmed === "/quit") {
    return { type: "exit" };
  }

  if (trimmed.startsWith("/use ")) {
    const arg = trimmed.slice(5).trim();
    // 支持 /use 1, /use 2 这样的编号，也支持 /use sess_xxx 这样的 sessionId
    const num = parseInt(arg, 10);
    if (!isNaN(num) && num > 0 && String(num) === arg) {
      return { type: "use", sessionIndex: num };
    }
    return { type: "use", sessionId: arg };
  }

  return {
    type: "message",
    content: trimmed,
  };
}
