/**
 * CLI 命令解析。
 * 从旧的 repl.ts 中提取出来作为独立模块，供新旧 REPL 共用。
 */

export interface CliCommand {
  type: "help" | "sessions" | "use" | "clear" | "exit" | "events" | "event" | "session" | "message";
  sessionId?: string;
  sessionIndex?: number; // 用于 /use 1, /use 2 这样的编号切换
  content?: string;
  limit?: number | "all";
  action?: "list" | "show" | "rm";
  filename?: string;
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

  if (trimmed.startsWith("/session rm ")) {
    const arg = trimmed.slice("/session rm ".length).trim();
    const num = parseInt(arg, 10);
    if (!isNaN(num) && num > 0 && String(num) === arg) {
      return { type: "session", action: "rm", sessionIndex: num };
    }
    return { type: "session", action: "rm", sessionId: arg };
  }

  if (trimmed === "/events") {
    return { type: "events", action: "list" };
  }

  if (trimmed.startsWith("/events show ")) {
    const filename = trimmed.slice("/events show ".length).trim();
    return { type: "events", action: "show", filename };
  }

  if (trimmed.startsWith("/event rm ")) {
    return {
      type: "event",
      action: "rm",
      filename: trimmed.slice("/event rm ".length).trim(),
    };
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
