import type { Gateway } from "../gateway/types";
import type { MonitorRuleConfig, MonitorRuleState } from "./types";
import { createInitialState, parseDuration } from "./types";
import { executeCheck } from "./runners";

export type MonitorMessageType = "alert" | "recovered" | "info";
export type MonitorMessageCallback = (message: string, type: MonitorMessageType) => void;

/**
 * Monitor Engine — 监控调度引擎。
 *
 * 独立于 Agent 主循环运行，按规则定时检查系统状态。
 * 检测到异常时通过 Gateway.dispatchMonitorEvent() 投递事件给 Agent。
 *
 * 核心状态机（每条规则独立）：
 * - 正常 → 检查失败 → 发 monitor.alert，进入 cooldown
 * - cooldown 内再次失败 → 跳过（不重复告警）
 * - 从失败恢复 → 发 monitor.recovered
 * - 持续正常 → 静默
 */
export class MonitorEngine {
    private readonly gateway: Gateway;
    private readonly rules: MonitorRuleConfig[];
    private readonly states: Map<string, MonitorRuleState> = new Map();
    private readonly timers: Map<string, ReturnType<typeof setInterval>> = new Map();
    private running = false;

    /** 消息回调，TUI 注册此回调来接收 monitor 输出。 */
    onMessage: MonitorMessageCallback = () => {};

    constructor(options: { gateway: Gateway; rules: MonitorRuleConfig[] }) {
        this.gateway = options.gateway;
        this.rules = options.rules.filter((r) => r.enabled);

        // 初始化每条规则的状态
        for (const rule of this.rules) {
            this.states.set(rule.id, createInitialState());
        }
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        this.emit(`启动监控引擎，${this.rules.length} 条规则`, "info");

        for (const rule of this.rules) {
            const intervalMs = parseDuration(rule.interval);
            this.emit(`注册规则 "${rule.name}" (${rule.id})，间隔 ${rule.interval}`, "info");

            // 立即执行首次检查
            this.runCheck(rule).catch((err) =>
                this.emit(`规则 ${rule.id} 首次检查出错: ${err}`, "info"),
            );

            // 设置定时器
            const timer = setInterval(() => {
                this.runCheck(rule).catch((err) =>
                    this.emit(`规则 ${rule.id} 检查出错: ${err}`, "info"),
                );
            }, intervalMs);

            this.timers.set(rule.id, timer);
        }
    }

    async stop(): Promise<void> {
        if (!this.running) return;
        this.running = false;

        for (const [ruleId, timer] of this.timers) {
            clearInterval(timer);
            this.timers.delete(ruleId);
        }

        this.emit("监控引擎已停止", "info");
    }

    /**
     * 执行一次规则检查，并根据状态转换决定是否投递事件。
     */
    private async runCheck(rule: MonitorRuleConfig): Promise<void> {
        const state = this.states.get(rule.id);
        if (!state) return;

        const now = new Date().toISOString();
        const result = await executeCheck(rule);

        state.lastRunAt = now;

        if (result.ok) {
            // ===== 检查通过 =====
            if (state.lastOk === false) {
                // 从失败恢复 → 发 monitor.recovered
                this.emit(`规则 "${rule.name}" 已恢复: ${result.summary}`, "recovered");
                await this.gateway.dispatchMonitorEvent({
                    ruleId: rule.id,
                    severity: "info",
                    type: "monitor.recovered",
                    summary: `[恢复] ${result.summary}`,
                    observedAt: now,
                    details: result.details,
                });
            }

            state.lastOk = true;
            state.consecutiveFailures = 0;
            state.cooldownUntil = null;
        } else {
            // ===== 检查失败 =====
            state.consecutiveFailures++;

            // 检查 cooldown
            if (state.cooldownUntil && now < state.cooldownUntil) {
                // 仍在 cooldown 内，静默跳过
                return;
            }

            const severity = rule.onFailure?.severity ?? "warning";
            this.emit(`规则 "${rule.name}" 告警: ${result.summary}`, "alert");

            await this.gateway.dispatchMonitorEvent({
                ruleId: rule.id,
                severity,
                type: "monitor.alert",
                summary: result.summary,
                observedAt: now,
                details: {
                    ...result.details,
                    consecutiveFailures: state.consecutiveFailures,
                },
            });

            state.lastOk = false;

            // 设置 cooldown
            if (rule.cooldown) {
                const cooldownMs = parseDuration(rule.cooldown);
                state.cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
            }
        }
    }

    private emit(message: string, type: MonitorMessageType): void {
        this.onMessage(message, type);
    }
}
