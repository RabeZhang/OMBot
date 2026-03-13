import type { GatewayEvent } from "../gateway/types";
import type { SessionSummary } from "../memory/types";

export function renderGatewayEvent(event: GatewayEvent): string | null {
  // REPL 当前只渲染对人可读的核心事件，省略纯内部状态噪音。
  switch (event.type) {
    case "gateway.run.started":
      return `[run:start] session=${event.sessionId} run=${event.runId}`;
    case "gateway.run.completed":
      return `[run:end] session=${event.sessionId} run=${event.runId}`;
    case "user.message.accepted":
      return null;
    case "agent.start":
      return "[agent] 开始处理";
    case "tool.call":
      return `[tool] ${event.toolName} ${JSON.stringify(event.toolInput)}`;
    case "tool.result":
      return `[tool:result] ${event.toolName}`;
    case "agent.message_update":
      return event.content;
    case "agent.summary":
      return `[summary] ${event.summary}`;
    case "agent.end":
      return "[agent] 处理完成";
    case "monitor.alert":
      return `[alert] ${event.summary}`;
    case "monitor.recovered":
      return `[recovered] ${event.summary}`;
    case "scheduled_event.accepted":
      return `[event] ${event.sourceFile}: ${event.summary}`;
    case "approval.required":
      return `[approval] ${event.toolName}: ${event.reason}`;
    case "approval.resolved":
      return `[approval:${event.action}] ${event.approvalId}`;
  }
}

export function renderSessionSummaries(
  sessions: SessionSummary[],
  options?: { limit?: number; total?: number },
): string {
  if (sessions.length === 0) {
    return "当前还没有会话。";
  }

  const lines = sessions.map((session, index) => {
    const title = session.title ? ` | ${session.title}` : "";
    return `${index + 1}. ${session.sessionId} [${session.type}/${session.status}]${title}`;
  });

  // 添加分页提示
  if (options?.total !== undefined && options.total > sessions.length) {
    lines.push(`\n[共 ${options.total} 个会话，显示前 ${sessions.length} 个。使用 /sessions all 查看全部]`);
  }

  return lines.join("\n");
}

export function renderHelp(): string {
  return [
    "可用命令：",
    "/help                查看帮助",
    "/sessions [n|all]    列出当前会话（默认前 10 个）",
    "                       /sessions     - 显示前 10 个",
    "                       /sessions 20  - 显示前 20 个",
    "                       /sessions all - 显示全部",
    "/use <id|number>     切换到指定会话",
    "                       /use 1        - 切换到第 1 个会话",
    "                       /use sess_xxx - 用 sessionId 切换",
    "/clear               清除当前会话绑定",
    "/events              列出当前事件文件",
    "/events show <file>  查看事件文件内容",
    "/event now <text>    创建一个 immediate 事件",
    "/event rm <file>     删除一个事件文件",
    "/monitor             查看最近的监控告警历史",
    "/expand [n]          展开第 n 次（默认最近一次）折叠的工具调用详情",
    "/exit                退出 CLI",
  ].join("\n");
}
