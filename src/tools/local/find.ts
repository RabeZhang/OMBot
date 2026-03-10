import { spawnSync } from "node:child_process";
import path from "node:path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const DEFAULT_LIMIT = 100;

const findSchema = Type.Object({
    pattern: Type.String({ description: "文件名匹配模式（支持通配符如 '*.log'、'*.ts'）" }),
    path: Type.Optional(Type.String({ description: "搜索目录路径（默认: 当前目录）" })),
    type: Type.Optional(
        Type.Union([Type.Literal("file"), Type.Literal("directory")], {
            description: "限制结果类型: file（仅文件）或 directory（仅目录）",
        }),
    ),
    limit: Type.Optional(Type.Number({ description: `最大结果数（默认: ${DEFAULT_LIMIT}）` })),
});

/**
 * 文件查找工具。
 *
 * 使用系统 `find` 命令按名称模式搜索文件。
 * 返回匹配的文件路径列表（相对路径）。
 */
export function createFindTool(cwd: string): AgentTool {
    return {
        name: "find",
        label: "查找文件",
        description:
            `按名称模式搜索文件和目录。返回匹配的文件路径。` +
            `使用系统 find 命令，支持通配符模式。结果上限 ${DEFAULT_LIMIT} 条。` +
            `默认排除 .git 和 node_modules 目录。`,
        parameters: findSchema,
        async execute(
            _toolCallId: string,
            params: any,
            signal?: AbortSignal,
        ): Promise<AgentToolResult<unknown>> {
            if (signal?.aborted) {
                throw new Error("操作被中止");
            }

            const { pattern, path: searchDir, type: fileType, limit } = params as {
                pattern: string;
                path?: string;
                type?: "file" | "directory";
                limit?: number;
            };
            const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
            const searchPath = searchDir
                ? (searchDir.startsWith("/") ? searchDir : path.resolve(cwd, searchDir))
                : cwd;

            // 构建 find 命令参数
            const args: string[] = [
                searchPath,
                // 排除 .git 和 node_modules
                "-not", "-path", "*/.git/*",
                "-not", "-path", "*/node_modules/*",
            ];

            // 类型过滤
            if (fileType === "file") {
                args.push("-type", "f");
            } else if (fileType === "directory") {
                args.push("-type", "d");
            }

            // 名称匹配（大小写不敏感）
            args.push("-iname", pattern);

            // 限制结果数量（macOS 不支持 -quit，用 head 限制）
            // 但 spawnSync 单命令更简洁，我们手动截断

            const result = spawnSync("find", args, {
                encoding: "utf-8",
                maxBuffer: 5 * 1024 * 1024,
                timeout: 15000, // 15 秒超时
            });

            if (result.error) {
                throw new Error(`find 执行失败: ${result.error.message}`);
            }

            const rawOutput = result.stdout?.trim() ?? "";

            if (!rawOutput) {
                return {
                    content: [{ type: "text", text: "未找到匹配文件" }],
                    details: { matchCount: 0 },
                };
            }

            const lines = rawOutput.split("\n").filter((l) => l.trim().length > 0);

            // 转为相对路径
            const relativized = lines.map((line) => {
                if (line.startsWith(searchPath)) {
                    const rel = line.slice(searchPath.length);
                    return rel.startsWith("/") ? rel.slice(1) : rel;
                }
                return path.relative(searchPath, line);
            });

            // 截断
            const truncated = relativized.slice(0, effectiveLimit);
            let output = truncated.join("\n");

            if (relativized.length > effectiveLimit) {
                output += `\n\n[共找到 ${relativized.length} 个结果，仅显示前 ${effectiveLimit} 条]`;
            }

            return {
                content: [{ type: "text", text: output }],
                details: {
                    matchCount: relativized.length,
                    limitReached: relativized.length > effectiveLimit,
                },
            };
        },
    };
}
