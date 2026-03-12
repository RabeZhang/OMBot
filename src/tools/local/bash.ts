import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createBashTool as createMomBashTool } from "@mariozechner/pi-mom/dist/tools/bash.js";

/**
 * 使用 pi-mom 的 bash 工具创建 OMBot 的 bash 工具。
 *
 * pi-mom 的 bash 工具特性：
 * - 输出自动截断（默认 2000 行 / 50KB）
 * - 超大输出写入临时文件
 * - 支持 timeout 和 AbortSignal
 * - 进程树清理
 *
 * @param cwd 工作目录（当前未使用，保留参数以便后续扩展）
 * @returns AgentTool 符合 pi-agent-core 接口
 */
export function createBashTool(cwd: string): AgentTool {
	// 创建 host 模式的 executor（在当前环境执行命令）
	const executor = createExecutor({ type: "host" });

	// 获取 pi-mom 的 bash 工具
	const momBashTool = createMomBashTool(executor);

	// 包装为 OMBot 兼容的工具
	return {
		name: "bash",
		label: "执行命令",
		description:
			`在当前系统执行 Bash 命令。返回 stdout 和 stderr 合并输出。` +
			`输出自动截断到末尾 2000 行或 50KB（以先到为准）。` +
			`超大输出会保存到临时文件并提示路径。` +
			`可指定超时秒数。适用于运维诊断、日志查看、系统管理等场景。`,
		parameters: momBashTool.parameters,
		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
		): Promise<AgentToolResult<unknown>> {
			// 调用 pi-mom 的 bash 工具执行
			return momBashTool.execute(_toolCallId, params, signal);
		},
	};
}
