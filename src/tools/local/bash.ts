import { spawn } from "node:child_process";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

const MAX_OUTPUT_BYTES = 30 * 1024; // 30KB
const MAX_OUTPUT_LINES = 200;

const bashSchema = Type.Object({
    command: Type.String({ description: "要执行的 Bash 命令" }),
    timeout: Type.Optional(Type.Number({ description: "超时秒数（可选，默认 30 秒）" })),
});

/**
 * 截断输出到末尾 MAX_OUTPUT_LINES 行或 MAX_OUTPUT_BYTES 字节。
 */
function truncateOutput(text: string): { content: string; truncated: boolean } {
    const bytes = Buffer.byteLength(text, "utf-8");

    if (bytes <= MAX_OUTPUT_BYTES) {
        const lines = text.split("\n");
        if (lines.length <= MAX_OUTPUT_LINES) {
            return { content: text, truncated: false };
        }
        // 行数超限，取末尾
        const kept = lines.slice(-MAX_OUTPUT_LINES);
        return {
            content: `[... 省略前 ${lines.length - MAX_OUTPUT_LINES} 行 ...]\n${kept.join("\n")}`,
            truncated: true,
        };
    }

    // 字节超限，取末尾
    const sliced = text.slice(-MAX_OUTPUT_BYTES);
    const firstNewline = sliced.indexOf("\n");
    const clean = firstNewline >= 0 ? sliced.slice(firstNewline + 1) : sliced;
    return {
        content: `[... 输出过长，仅保留末尾 ${MAX_OUTPUT_BYTES / 1024}KB ...]\n${clean}`,
        truncated: true,
    };
}

function getShell(): { shell: string; args: string[] } {
    // macOS 和 Linux 通用
    const shell = process.env.SHELL || "/bin/bash";
    return { shell, args: ["-c"] };
}

/**
 * Bash 命令执行工具。
 *
 * 参考 pi-coding-agent 的 bash 工具实现，针对 OMBot 运维场景简化：
 * - 合并 stdout/stderr
 * - 输出截断
 * - 超时 + abort 信号支持
 * - 非 0 exit code 抛错
 */
export function createBashTool(cwd: string): AgentTool {
    return {
        name: "bash",
        label: "执行命令",
        description:
            `在当前工作目录执行 Bash 命令。返回 stdout 和 stderr 合并输出。` +
            `输出截断到末尾 ${MAX_OUTPUT_LINES} 行或 ${MAX_OUTPUT_BYTES / 1024}KB。` +
            `可指定超时秒数。适用于运维诊断、日志查看、系统管理等场景。`,
        parameters: bashSchema,
        async execute(
            _toolCallId: string,
            params: any,
            signal?: AbortSignal,
        ): Promise<AgentToolResult<unknown>> {
            const { command, timeout = 30 } = params as { command: string; timeout?: number };

            return new Promise((resolve, reject) => {
                const { shell, args } = getShell();
                const child = spawn(shell, [...args, command], {
                    cwd,
                    detached: true,
                    stdio: ["ignore", "pipe", "pipe"],
                });

                const chunks: Buffer[] = [];
                let timedOut = false;

                // 超时处理
                const timeoutHandle = setTimeout(() => {
                    timedOut = true;
                    if (child.pid) {
                        try { process.kill(-child.pid, "SIGTERM"); } catch { /* ignore */ }
                    }
                }, timeout * 1000);

                // 合并 stdout + stderr
                child.stdout?.on("data", (data: Buffer) => chunks.push(data));
                child.stderr?.on("data", (data: Buffer) => chunks.push(data));

                // abort 信号
                const onAbort = () => {
                    if (child.pid) {
                        try { process.kill(-child.pid, "SIGTERM"); } catch { /* ignore */ }
                    }
                };
                if (signal) {
                    if (signal.aborted) { onAbort(); }
                    else { signal.addEventListener("abort", onAbort, { once: true }); }
                }

                child.on("error", (err) => {
                    clearTimeout(timeoutHandle);
                    signal?.removeEventListener("abort", onAbort);
                    reject(err);
                });

                child.on("close", (code) => {
                    clearTimeout(timeoutHandle);
                    signal?.removeEventListener("abort", onAbort);

                    if (signal?.aborted) {
                        reject(new Error("命令被中止"));
                        return;
                    }

                    const rawOutput = Buffer.concat(chunks).toString("utf-8");
                    const { content, truncated } = truncateOutput(rawOutput);
                    let outputText = content || "(无输出)";

                    if (timedOut) {
                        outputText += `\n\n命令超时（${timeout} 秒）`;
                        reject(new Error(outputText));
                        return;
                    }

                    if (code !== 0 && code !== null) {
                        outputText += `\n\n命令退出码: ${code}`;
                        reject(new Error(outputText));
                    } else {
                        resolve({
                            content: [{ type: "text", text: outputText }],
                            details: { exitCode: code, truncated },
                        });
                    }
                });
            });
        },
    };
}
