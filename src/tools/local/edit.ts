import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createEditTool as createMomEditTool } from "@mariozechner/pi-mom/dist/tools/edit.js";

/**
 * 使用 pi-mom 的 edit 工具创建 OMBot 的文件编辑工具。
 *
 * pi-mom edit 工具特性：
 * - 精确文本替换（oldText 必须完全匹配，包括空白字符）
 * - 自动检查唯一性（如果 oldText 出现多次会报错）
 * - 生成 diff 预览（便于用户确认变更）
 * - 返回变更统计（字符数变化）
 *
 * 适用场景：
 * - 修改 nginx 配置文件
 * - 调整 systemd service 配置
 * - 编辑环境变量文件
 * - 精确修改配置文件中的特定值
 *
 * @param cwd 工作目录（当前未使用，保留参数以便后续扩展）
 * @returns AgentTool 符合 pi-agent-core 接口
 */
export function createEditTool(cwd: string): AgentTool {
	// 创建 host 模式的 executor（在当前环境执行命令）
	const executor = createExecutor({ type: "host" });

	// 获取 pi-mom 的 edit 工具
	const momEditTool = createMomEditTool(executor);

	// 包装为 OMBot 兼容的工具
	return {
		name: "edit",
		label: "编辑文件",
		description:
			`精确编辑文件内容，通过替换指定文本实现。\n` +
			`oldText 必须完全匹配（包括所有空白字符和换行），且在整个文件中必须唯一。\n` +
			`返回 diff 预览，便于确认变更。\n` +
			`适用于修改配置文件、调整参数值等需要精确控制的场景。\n` +
			`注意：这是一个高风险操作，修改前请仔细确认 oldText 的准确性。`,
		parameters: momEditTool.parameters,
		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
		): Promise<AgentToolResult<unknown>> {
			// 调用 pi-mom 的 edit 工具执行
			return momEditTool.execute(_toolCallId, params, signal);
		},
	};
}
