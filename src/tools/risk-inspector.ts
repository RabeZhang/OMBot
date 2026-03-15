export interface ToolRiskInspection {
  requiresApproval: boolean;
  reason?: string;
}

export function inspectToolRisk(toolName: string, params: unknown): ToolRiskInspection {
  if (toolName === "edit") {
    const path = extractPath(params);
    return {
      requiresApproval: true,
      reason: `edit 会修改文件${path ? `: ${path}` : ""}`,
    };
  }

  if (toolName === "write") {
    const path = extractPath(params);
    return {
      requiresApproval: true,
      reason: `write 会创建或覆盖文件${path ? `: ${path}` : ""}`,
    };
  }

  if (toolName === "bash") {
    const command = typeof (params as { command?: unknown })?.command === "string"
      ? (params as { command: string }).command
      : "";
    const reason = inspectBashCommand(command);
    return {
      requiresApproval: reason !== undefined,
      reason,
    };
  }

  return { requiresApproval: false };
}

function inspectBashCommand(command: string): string | undefined {
  const patterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\brm\b/, reason: "bash 命中删除命令 rm" },
    { pattern: /\bmv\b/, reason: "bash 命中移动或重命名命令 mv" },
    { pattern: /\bchmod\b|\bchown\b/, reason: "bash 命中权限修改命令" },
    { pattern: /\bkill\b|\bpkill\b|\bkillall\b/, reason: "bash 命中进程终止命令" },
    { pattern: /\bsystemctl\b|\bservice\b|\blaunchctl\b/, reason: "bash 命中服务控制命令" },
    { pattern: /\bsed\s+-i\b/, reason: "bash 命中原地修改命令 sed -i" },
    { pattern: /(^|[^>])>(?!>)/, reason: "bash 命中输出重定向写文件" },
    { pattern: />>/, reason: "bash 命中追加重定向写文件" },
    { pattern: /\btee\b/, reason: "bash 命中 tee 写文件" },
  ];

  for (const entry of patterns) {
    if (entry.pattern.test(command)) {
      return entry.reason;
    }
  }

  return undefined;
}

function extractPath(params: unknown): string | undefined {
  const value = (params as { path?: unknown })?.path;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
