import type { MonitorCheckResult, MonitorRuleConfig } from "./types";

import type { ToolExecutionContext } from "../tools/types";
import { getProcessStatusTool } from "../tools/local/process";
import { getCpuUsageTool, getMemoryUsageTool, getDiskUsageTool } from "../tools/local/resource";
import { getPortStatusTool, checkHttpEndpointTool } from "../tools/local/network";

/** Monitor Engine 调用工具时使用的默认上下文。 */
const monitorCtx: ToolExecutionContext = { sessionId: "__monitor__" };

/**
 * 根据规则类型调用对应的工具执行检查。
 * 直接复用已有的工具函数，不做额外封装。
 */
export async function executeCheck(rule: MonitorRuleConfig): Promise<MonitorCheckResult> {
    switch (rule.type) {
        case "process":
            return checkProcess(rule);
        case "resource":
            return checkResource(rule);
        case "port":
            return checkPort(rule);
        case "http":
            return checkHttp(rule);
        default:
            return { ok: false, summary: `未知的监控类型: ${rule.type}`, details: {} };
    }
}

async function checkProcess(rule: MonitorRuleConfig): Promise<MonitorCheckResult> {
    const processName = rule.target.processName as string;
    try {
        const result = await getProcessStatusTool.execute({ processName }, monitorCtx);
        if (result.running) {
            return {
                ok: true,
                summary: `进程 ${processName} 正在运行（找到 ${result.matches.length} 个匹配进程）`,
                details: result,
            };
        }
        return {
            ok: false,
            summary: `进程 ${processName} 未运行`,
            details: result,
        };
    } catch (err) {
        return {
            ok: false,
            summary: `检查进程 ${processName} 时出错: ${err instanceof Error ? err.message : String(err)}`,
            details: { error: String(err) },
        };
    }
}

async function checkResource(rule: MonitorRuleConfig): Promise<MonitorCheckResult> {
    const metric = rule.target.metric as string;
    const threshold = rule.threshold;

    if (!threshold) {
        return { ok: true, summary: `规则 ${rule.id} 未配置阈值，跳过`, details: {} };
    }

    try {
        let currentValue: number;
        let details: Record<string, unknown>;

        switch (metric) {
            case "cpu_usage": {
                const cpu = await getCpuUsageTool.execute({}, monitorCtx);
                currentValue = cpu.estimatedUsagePercent;
                details = cpu;
                break;
            }
            case "memory_usage": {
                const mem = await getMemoryUsageTool.execute({}, monitorCtx);
                currentValue = mem.usagePercent;
                details = mem;
                break;
            }
            case "disk_usage": {
                const mountPoint = (rule.target.mountPoint as string) ?? "/";
                const disk = await getDiskUsageTool.execute({ path: mountPoint }, monitorCtx);
                currentValue = disk.usagePercent;
                details = disk;
                break;
            }
            default:
                return { ok: false, summary: `未知的资源指标: ${metric}`, details: {} };
        }

        const thresholdValue = Number(threshold.value);
        const exceeded = evaluateThreshold(currentValue, threshold.operator, thresholdValue);

        if (exceeded) {
            return {
                ok: false,
                summary: `${rule.name}: ${metric} = ${currentValue.toFixed(1)}%，超过阈值 ${threshold.operator} ${thresholdValue}%`,
                details: { ...details, currentValue, thresholdValue, operator: threshold.operator },
            };
        }

        return {
            ok: true,
            summary: `${rule.name}: ${metric} = ${currentValue.toFixed(1)}%，正常`,
            details: { ...details, currentValue, thresholdValue, operator: threshold.operator },
        };
    } catch (err) {
        return {
            ok: false,
            summary: `检查资源 ${metric} 时出错: ${err instanceof Error ? err.message : String(err)}`,
            details: { error: String(err) },
        };
    }
}

async function checkPort(rule: MonitorRuleConfig): Promise<MonitorCheckResult> {
    const host = (rule.target.host as string) ?? "localhost";
    const port = rule.target.port as number;

    try {
        const result = await getPortStatusTool.execute({ host, port }, monitorCtx);
        if (result.open) {
            return { ok: true, summary: `端口 ${host}:${port} 正在监听`, details: result };
        }
        return { ok: false, summary: `端口 ${host}:${port} 未监听`, details: result };
    } catch (err) {
        return {
            ok: false,
            summary: `检查端口 ${host}:${port} 时出错: ${err instanceof Error ? err.message : String(err)}`,
            details: { error: String(err) },
        };
    }
}

async function checkHttp(rule: MonitorRuleConfig): Promise<MonitorCheckResult> {
    const url = rule.target.url as string;
    const expectedStatus = (rule.target.expectedStatus as number) ?? 200;
    const timeoutMs = (rule.target.timeoutMs as number) ?? 10000;

    try {
        const result = await checkHttpEndpointTool.execute({ url, timeoutMs }, monitorCtx);

        // 状态码不匹配 → 直接失败
        if (result.statusCode !== expectedStatus) {
            return {
                ok: false,
                summary: `${url} 返回 ${result.statusCode}，预期 ${expectedStatus}`,
                details: { ...result, expectedStatus },
            };
        }

        // 状态码正常，检查响应时间阈值（如果配置了 threshold）
        if (rule.threshold) {
            const thresholdValue = Number(rule.threshold.value);
            const exceeded = evaluateThreshold(result.responseTimeMs, rule.threshold.operator, thresholdValue);
            if (exceeded) {
                return {
                    ok: false,
                    summary: `${url} 响应时间 ${result.responseTimeMs}ms，超过阈值 ${rule.threshold.operator} ${thresholdValue}ms`,
                    details: { ...result, responseTimeThreshold: thresholdValue },
                };
            }
        }

        return {
            ok: true,
            summary: `${url} 健康检查通过（${result.statusCode}，${result.responseTimeMs}ms）`,
            details: result,
        };
    } catch (err) {
        return {
            ok: false,
            summary: `HTTP 健康检查 ${url} 失败: ${err instanceof Error ? err.message : String(err)}`,
            details: { error: String(err), url, expectedStatus },
        };
    }
}


function evaluateThreshold(current: number, operator: string, threshold: number): boolean {
    switch (operator) {
        case ">":
            return current > threshold;
        case ">=":
            return current >= threshold;
        case "<":
            return current < threshold;
        case "<=":
            return current <= threshold;
        case "==":
            return current === threshold;
        case "!=":
            return current !== threshold;
        default:
            return false;
    }
}
