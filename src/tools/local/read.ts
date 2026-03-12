import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createReadTool as createMomReadTool } from "@mariozechner/pi-mom/dist/tools/read.js";

/**
 * 使用 pi-mom 的 read 工具创建 OMBot 的文件读取工具。
 *
 * pi-mom read 工具特性：
 * - 文本文件读取，支持 offset/limit 分页
 * - 图片文件识别（jpg, png, gif, webp）
 * - 输出自动截断（默认 2000 行 / 50KB 头部截断）
 * - 超大文件智能提示（显示行号范围，提示如何继续读取）
 *
 * @param cwd 工作目录（当前未使用，保留参数以便后续扩展）
 * @returns AgentTool 符合 pi-agent-core 接口
 */
export function createReadTool(cwd: string): AgentTool {
	// 创建 host 模式的 executor（在当前环境执行命令）
	const executor = createExecutor({ type: "host" });

	// 获取 pi-mom 的 read 工具
	const momReadTool = createMomReadTool(executor);

	// 包装为 OMBot 兼容的工具
	return {
		name: "read",
		label: "读取文件",
		description:
			`读取文件内容。支持文本文件和图片文件（jpg, png, gif, webp）。\n` +
			`文本文件自动截断到前 2000 行或 50KB。\n` +
			`支持 offset（起始行号，1-indexed）和 limit（最大行数）参数进行分页读取。\n` +
			`适用于查看配置文件、日志文件、截图分析等场景。`,
		parameters: momReadTool.parameters,
		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
		): Promise<AgentToolResult<unknown>> {
			// 调用 pi-mom 的 read 工具执行
			return momReadTool.execute(_toolCallId, params, signal);
		},
	};
}
