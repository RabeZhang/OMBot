import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const DEFAULT_LIMIT = 50;

const grepSchema = Type.Object({
    pattern: Type.String({ description: "搜索模式（正则表达式或字面字符串）" }),
    path: Type.Optional(Type.String({ description: "搜索的目录或文件路径（默认: 当前目录）" })),
    glob: Type.Optional(Type.String({ description: "文件过滤 glob 模式，如 '*.ts' 或 '*.log'" })),
    ignoreCase: Type.Optional(Type.Boolean({ description: "是否忽略大小写（默认: false）" })),
    literal: Type.Optional(Type.Boolean({ description: "将 pattern 作为字面字符串而非正则（默认: false）" })),
    limit: Type.Optional(Type.Number({ description: `最大匹配数（默认: ${DEFAULT_LIMIT}）` })),
});

/**
 * 检查 ripgrep 是否可用
 */
function findRg(): string | null {
    try {
        const { spawnSync } = require("node:child_process");
        const result = spawnSync("which", ["rg"], { encoding: "utf-8" });
        return result.status === 0 ? result.stdout.trim() : null;
    } catch {
        return null;
    }
}

/**
 * 文件内容搜索工具。
 *
 * 优先使用 ripgrep（如果可用），否则 fallback 到系统 grep -rn。
 * 返回格式：`文件路径:行号: 行内容`
 */
export function createGrepTool(cwd: string): AgentTool {
    return {
        name: "grep",
        label: "搜索文件内容",
        description:
            `在文件中搜索匹配模式的内容。返回匹配行及文件路径和行号。` +
            `默认遵循 .gitignore 规则。结果截断到 ${DEFAULT_LIMIT} 条匹配。支持正则和字面搜索。`,
        parameters: grepSchema,
        async execute(
            _toolCallId: string,
            params: any,
            signal?: AbortSignal,
        ): Promise<AgentToolResult<unknown>> {
            const { pattern, path: searchDir, glob, ignoreCase, literal, limit } = params as {
                pattern: string;
                path?: string;
                glob?: string;
                ignoreCase?: boolean;
                literal?: boolean;
                limit?: number;
            };
            const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
            const searchPath = searchDir
                ? (searchDir.startsWith("/") ? searchDir : `${cwd}/${searchDir}`)
                : cwd;

            return new Promise((resolve, reject) => {
                if (signal?.aborted) {
                    reject(new Error("操作被中止"));
                    return;
                }

                const rgPath = findRg();

                let child: ReturnType<typeof spawn>;
                let useJson = false;

                if (rgPath) {
                    // 使用 ripgrep
                    const args: string[] = [
                        "--json", "--line-number", "--color=never", "--hidden",
                        "--max-count", String(effectiveLimit),
                    ];
                    if (ignoreCase) args.push("--ignore-case");
                    if (literal) args.push("--fixed-strings");
                    if (glob) args.push("--glob", glob);
                    args.push(pattern, searchPath);
                    child = spawn(rgPath, args, { stdio: ["ignore", "pipe", "pipe"] });
                    useJson = true;
                } else {
                    // Fallback 到系统 grep
                    const args: string[] = ["-rn", "--color=never"];
                    if (ignoreCase) args.push("-i");
                    if (literal) args.push("-F");
                    if (glob) args.push("--include", glob);
                    args.push(pattern, searchPath);
                    child = spawn("grep", args, { stdio: ["ignore", "pipe", "pipe"] });
                }

                const rl = createInterface({ input: child.stdout! });
                const outputLines: string[] = [];
                let matchCount = 0;

                const cleanup = () => {
                    rl.close();
                    signal?.removeEventListener("abort", onAbort);
                };

                const onAbort = () => {
                    if (!child.killed) child.kill();
                };
                signal?.addEventListener("abort", onAbort, { once: true });

                rl.on("line", (line) => {
                    if (matchCount >= effectiveLimit) return;

                    if (useJson) {
                        // ripgrep JSON 格式
                        try {
                            const event = JSON.parse(line);
                            if (event.type === "match") {
                                matchCount++;
                                const filePath = event.data?.path?.text ?? "";
                                const lineNumber = event.data?.line_number ?? 0;
                                const lineText = event.data?.lines?.text?.trimEnd() ?? "";
                                const relative = filePath.startsWith(searchPath)
                                    ? filePath.slice(searchPath.length + 1)
                                    : filePath;
                                outputLines.push(`${relative}:${lineNumber}: ${lineText}`);
                                if (matchCount >= effectiveLimit && !child.killed) {
                                    child.kill();
                                }
                            }
                        } catch { /* skip invalid JSON lines */ }
                    } else {
                        // 系统 grep 输出格式已经是 file:line:content
                        matchCount++;
                        // 将绝对路径替换为相对路径
                        const relativeLine = line.startsWith(searchPath)
                            ? line.slice(searchPath.length + 1)
                            : line;
                        outputLines.push(relativeLine);
                        if (matchCount >= effectiveLimit && !child.killed) {
                            child.kill();
                        }
                    }
                });

                child.on("close", (_code) => {
                    cleanup();

                    if (signal?.aborted) {
                        reject(new Error("操作被中止"));
                        return;
                    }

                    if (matchCount === 0) {
                        resolve({
                            content: [{ type: "text", text: "未找到匹配内容" }],
                            details: { matchCount: 0 },
                        });
                        return;
                    }

                    let output = outputLines.join("\n");
                    if (matchCount >= effectiveLimit) {
                        output += `\n\n[已达到 ${effectiveLimit} 条匹配上限，可增大 limit 参数获取更多结果]`;
                    }

                    resolve({
                        content: [{ type: "text", text: output }],
                        details: { matchCount, limitReached: matchCount >= effectiveLimit },
                    });
                });

                child.on("error", (err) => {
                    cleanup();
                    reject(new Error(`grep 执行失败: ${err.message}`));
                });
            });
        },
    };
}
