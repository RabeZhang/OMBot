/**
 * CLI 命令解析。
 * 从旧的 repl.ts 中提取出来作为独立模块，供新旧 REPL 共用。
 */

export interface CliCommand {
  type: "help" | "sessions" | "use" | "clear" | "exit" | "events" | "event" | "session" | "approval" | "approval_mode" | "host" | "monitor" | "message";
  sessionId?: string;
  sessionIndex?: number; // 用于 /use 1, /use 2 这样的编号切换
  content?: string;
  limit?: number | "all";
  action?: "list" | "show" | "runs" | "rm" | "approve_once" | "deny" | "auto" | "default" | "refresh" | "new";
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

  if (trimmed === "/host") {
    return { type: "host", action: "list" };
  }

  if (trimmed === "/host show") {
    return { type: "host", action: "show" };
  }

  if (trimmed === "/host refresh") {
    return { type: "host", action: "refresh" };
  }

  if (trimmed === "/approval auto") {
    return { type: "approval_mode", action: "auto" };
  }

  if (trimmed === "/approval default") {
    return { type: "approval_mode", action: "default" };
  }

  if (trimmed.startsWith("/approve ")) {
    return {
      type: "approval",
      action: "approve_once",
      content: trimmed.slice("/approve ".length).trim(),
    };
  }

  if (trimmed.startsWith("/deny ")) {
    return {
      type: "approval",
      action: "deny",
      content: trimmed.slice("/deny ".length).trim(),
    };
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

  if (trimmed === "/events runs") {
    return { type: "events", action: "runs" };
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

  if (trimmed === "/monitor") {
    return { type: "monitor", action: "list" };
  }

  if (trimmed === "/monitor show") {
    return { type: "monitor", action: "show" };
  }

  if (trimmed === "/exit" || trimmed === "/quit") {
    return { type: "exit" };
  }

  if (trimmed.startsWith("/use ")) {
    const arg = trimmed.slice(5).trim();
    if (arg === "new") {
      return { type: "use", action: "new" };
    }
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
