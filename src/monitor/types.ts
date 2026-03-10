import type { MonitorsConfig } from "../config/schema";

/**
 * 单条监控规则的配置类型。
 */
export type MonitorRuleConfig = MonitorsConfig["monitors"][number];

/**
 * 单次检查结果。
 */
export interface MonitorCheckResult {
    /** 检查是否通过 */
    ok: boolean;
    /** 人类可读摘要 */
    summary: string;
    /** 结构化详情（传给 Agent） */
    details: Record<string, unknown>;
}

/**
 * 每条规则的运行时状态。
 */
export interface MonitorRuleState {
    /** 上次检查时间 */
    lastRunAt: string | null;
    /** 上次检查结果是否正常 */
    lastOk: boolean | null;
    /** cooldown 截止时间（在此之前不重复告警） */
    cooldownUntil: string | null;
    /** 连续失败次数 */
    consecutiveFailures: number;
}

/**
 * 解析 "60s" / "5m" / "1h" / "1d" 格式的时间间隔为毫秒。
 */
export function parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
        throw new Error(`无效的时间间隔: ${duration}`);
    }

    const value = Number(match[1]);
    const unit = match[2];

    switch (unit) {
        case "s":
            return value * 1000;
        case "m":
            return value * 60 * 1000;
        case "h":
            return value * 60 * 60 * 1000;
        case "d":
            return value * 24 * 60 * 60 * 1000;
        default:
            throw new Error(`未知的时间单位: ${unit}`);
    }
}

/**
 * 创建规则的初始状态。
 */
export function createInitialState(): MonitorRuleState {
    return {
        lastRunAt: null,
        lastOk: null,
        cooldownUntil: null,
        consecutiveFailures: 0,
    };
}
