import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createWriteTool as createMomWriteTool } from "@mariozechner/pi-mom/dist/tools/write.js";

/**
 * 使用 pi-mom 的 write 工具创建 OMBot 的文件写入工具。
 *
 * pi-mom write 工具特性：
 * - 创建新文件（如果不存在）
 * - 覆盖现有文件（如果存在）
 * - 自动创建父目录
 * - 使用 printf 处理特殊字符，避免 heredoc 问题
 * - 返回写入字节数统计
 *
 * 适用场景：
 * - 创建新的配置文件
 * - 生成脚本文件
 * - 保存日志或报告
 * - 完全替换文件内容（而非部分编辑）
 *
 * 注意：这是一个高风险操作，会覆盖现有文件。如需部分修改请使用 edit 工具。
 *
 * @param cwd 工作目录（当前未使用，保留参数以便后续扩展）
 * @returns AgentTool 符合 pi-agent-core 接口
 */
export function createWriteTool(cwd: string): AgentTool {
	// 创建 host 模式的 executor（在当前环境执行命令）
	const executor = createExecutor({ type: "host" });

	// 获取 pi-mom 的 write 工具
	const momWriteTool = createMomWriteTool(executor);

	// 包装为 OMBot 兼容的工具
	return {
		name: "write",
		label: "写入文件",
		description:
			`创建或覆盖文件内容。\n` +
			`如果文件不存在则创建，如果存在则完全覆盖。\n` +
			`自动创建所需的父目录。\n` +
			`适用于生成新配置文件、保存脚本、写入日志等场景。\n` +
			`注意：这是一个高风险操作，会覆盖现有文件。如需部分修改请使用 edit 工具。`,
		parameters: momWriteTool.parameters,
		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
		): Promise<AgentToolResult<unknown>> {
			// 调用 pi-mom 的 write 工具执行
			return momWriteTool.execute(_toolCallId, params, signal);
		},
	};
}
