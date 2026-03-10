import fs from "node:fs/promises";
import path from "node:path";

import type { OmbotConfig, MonitorsConfig } from "../config/schema";
import type { PromptContext } from "./types";

async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

/**
 * 将 monitors.yaml 中的监控规则转换为可注入 prompt 的描述块。
 * Agent 知道这些服务和地址才能主动用正确的工具去检查。
 */
function buildMonitorContextSection(monitors: MonitorsConfig): string {
  if (monitors.monitors.length === 0) return "";

  const lines: string[] = [
    "[当前监控配置]",
    "以下是正在被 Monitor Engine 持续监控的目标，当用户询问服务状态时，你应主动使用对应工具检查：",
    "",
  ];

  for (const rule of monitors.monitors) {
    if (!rule.enabled) continue;

    if (rule.type === "http") {
      const url = rule.target.url as string | undefined;
      const expectedStatus = (rule.target.expectedStatus as number | undefined) ?? 200;
      const thresholdNote = rule.threshold
        ? `，响应时间阈值 ${rule.threshold.operator} ${rule.threshold.value}${rule.threshold.unit}`
        : "";
      lines.push(`- 【${rule.name}】(id: ${rule.id}) 类型: HTTP 健康检查`);
      lines.push(`  URL: ${url}，期望状态码: ${expectedStatus}${thresholdNote}`);
      lines.push(`  → 检查工具: check_http_endpoint，参数 url="${url}"`);
    } else if (rule.type === "port") {
      const host = (rule.target.host as string | undefined) ?? "localhost";
      const port = rule.target.port as number | undefined;
      lines.push(`- 【${rule.name}】(id: ${rule.id}) 类型: 端口检测`);
      lines.push(`  主机: ${host}，端口: ${port}`);
      lines.push(`  → 检查工具: get_port_status，参数 host="${host}" port=${port}`);
    } else if (rule.type === "process") {
      const procName = rule.target.processName as string | undefined;
      lines.push(`- 【${rule.name}】(id: ${rule.id}) 类型: 进程存活`);
      lines.push(`  进程名: ${procName}`);
      lines.push(`  → 检查工具: get_process_status，参数 processName="${procName}"`);
    } else if (rule.type === "resource") {
      const metric = rule.target.metric as string | undefined;
      const threshold = rule.threshold
        ? `阈值 ${rule.threshold.operator} ${rule.threshold.value}${rule.threshold.unit}`
        : "";
      lines.push(`- 【${rule.name}】(id: ${rule.id}) 类型: 资源使用率，指标: ${metric}，${threshold}`);
      if (metric === "cpu_usage") {
        lines.push(`  → 检查工具: get_cpu_usage`);
      } else if (metric === "memory_usage") {
        lines.push(`  → 检查工具: get_memory_usage`);
      } else if (metric === "disk_usage") {
        const mount = rule.target.mountPoint as string | undefined;
        lines.push(`  → 检查工具: get_disk_usage，参数 path="${mount ?? "/"}"`);
      }
    }
  }

  lines.push("");
  lines.push("当用户问到「监控服务状态」、「各服务是否正常」等问题时，请逐一调用以上工具，汇总结果后再回答。");
  return lines.join("\n");
}

export async function buildPromptContext(
  config: OmbotConfig,
  monitors?: MonitorsConfig,
): Promise<PromptContext> {
  const sections: string[] = [];

  const systemPrompt = (await readTextFile(config.agent.systemPromptTemplate)).trim();
  if (systemPrompt) {
    sections.push(systemPrompt);
  }

  // 注入 Monitor 配置，让 Agent 了解正在监控哪些服务和指标
  if (monitors && monitors.monitors.length > 0) {
    const monitorSection = buildMonitorContextSection(monitors);
    if (monitorSection) {
      sections.push(monitorSection);
    }
  }

  for (const filePath of config.agent.workspaceFiles) {
    const content = (await readTextFile(filePath)).trim();
    if (!content) {
      continue;
    }

    // workspace 文档统一以文件名作为标题注入，方便模型理解不同材料的职责。
    sections.push(`\n[Workspace: ${path.basename(filePath)}]\n${content}`);
  }

  return {
    systemPrompt: sections.join("\n\n").trim(),
  };
}
