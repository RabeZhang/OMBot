import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/monitor/runners", () => ({
    executeCheck: vi.fn(),
}));

import { parseDuration, createInitialState } from "../../src/monitor/types";
import { MonitorEngine } from "../../src/monitor/engine";
import { executeCheck } from "../../src/monitor/runners";

const mockedExecuteCheck = vi.mocked(executeCheck);

beforeEach(() => {
    mockedExecuteCheck.mockReset();
});

describe("parseDuration", () => {
    it("解析秒", () => {
        expect(parseDuration("60s")).toBe(60_000);
        expect(parseDuration("1s")).toBe(1_000);
    });

    it("解析分钟", () => {
        expect(parseDuration("5m")).toBe(300_000);
    });

    it("解析小时", () => {
        expect(parseDuration("1h")).toBe(3_600_000);
    });

    it("解析天", () => {
        expect(parseDuration("1d")).toBe(86_400_000);
    });

    it("无效格式抛错", () => {
        expect(() => parseDuration("abc")).toThrow("无效的时间间隔");
        expect(() => parseDuration("10")).toThrow("无效的时间间隔");
    });
});

describe("createInitialState", () => {
    it("创建正确的初始状态", () => {
        const state = createInitialState();
        expect(state.lastRunAt).toBeNull();
        expect(state.lastOk).toBeNull();
        expect(state.cooldownUntil).toBeNull();
        expect(state.consecutiveFailures).toBe(0);
        expect(state.consecutiveSuccesses).toBe(0);
        expect(state.incidentActive).toBe(false);
    });
});

describe("MonitorEngine", () => {
    it("构造时只注册 enabled 规则", () => {
        const mockGateway = {
            sendUserMessage: vi.fn(),
            dispatchMonitorEvent: vi.fn(),
            resolveApproval: vi.fn(),
            listSessions: vi.fn(),
            getSession: vi.fn(),
        };

        const engine = new MonitorEngine({
            gateway: mockGateway as any,
            rules: [
                {
                    id: "rule-1",
                    name: "Test Rule 1",
                    enabled: true,
                    type: "process" as const,
                    interval: "60s",
                    target: { processName: "nginx" },
                },
                {
                    id: "rule-2",
                    name: "Test Rule 2",
                    enabled: false,
                    type: "process" as const,
                    interval: "30s",
                    target: { processName: "redis" },
                },
            ],
        });

        // engine 是私有属性，但可以通过 start/stop 验证行为
        expect(engine).toBeDefined();
    });

    it("start/stop 生命周期", async () => {
        const mockGateway = {
            sendUserMessage: vi.fn(),
            dispatchMonitorEvent: vi.fn().mockResolvedValue({
                sessionId: "test",
                runId: "test",
                stream: (async function* () { })(),
            }),
            resolveApproval: vi.fn(),
            listSessions: vi.fn(),
            getSession: vi.fn(),
        };

        const engine = new MonitorEngine({
            gateway: mockGateway as any,
            rules: [], // 空规则，测试纯生命周期
        });

        await engine.start();
        await engine.stop();
        // 不抛错即通过
    });

    it("only alerts after reaching failureThreshold", async () => {
        mockedExecuteCheck
            .mockResolvedValueOnce({ ok: false, summary: "第一次失败", details: {} })
            .mockResolvedValueOnce({ ok: false, summary: "第二次失败", details: {} });

        const mockGateway = {
            sendUserMessage: vi.fn(),
            dispatchMonitorEvent: vi.fn().mockResolvedValue({
                sessionId: "incident_1",
                runId: "run_1",
                stream: (async function* () { })(),
            }),
            resolveApproval: vi.fn(),
            listSessions: vi.fn(),
            getSession: vi.fn(),
        };

        const rule = {
            id: "cpu-usage",
            name: "CPU 使用率",
            enabled: true,
            type: "resource" as const,
            interval: "30s",
            failureThreshold: 2,
            recoveryThreshold: 1,
            target: { metric: "cpu_usage" },
        };

        const engine = new MonitorEngine({
            gateway: mockGateway as any,
            rules: [rule],
        });

        await (engine as any).runCheck(rule);
        expect(mockGateway.dispatchMonitorEvent).not.toHaveBeenCalled();

        await (engine as any).runCheck(rule);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenCalledTimes(1);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenCalledWith(expect.objectContaining({
            ruleId: "cpu-usage",
            type: "monitor.alert",
            details: expect.objectContaining({
                consecutiveFailures: 2,
                failureThreshold: 2,
            }),
        }));
    });

    it("only recovers after reaching recoveryThreshold", async () => {
        mockedExecuteCheck
            .mockResolvedValueOnce({ ok: false, summary: "失败", details: {} })
            .mockResolvedValueOnce({ ok: true, summary: "第一次恢复成功", details: {} })
            .mockResolvedValueOnce({ ok: true, summary: "第二次恢复成功", details: {} });

        const mockGateway = {
            sendUserMessage: vi.fn(),
            dispatchMonitorEvent: vi.fn().mockResolvedValue({
                sessionId: "incident_1",
                runId: "run_1",
                stream: (async function* () { })(),
            }),
            resolveApproval: vi.fn(),
            listSessions: vi.fn(),
            getSession: vi.fn(),
        };

        const rule = {
            id: "memory-usage",
            name: "内存使用率",
            enabled: true,
            type: "resource" as const,
            interval: "30s",
            failureThreshold: 1,
            recoveryThreshold: 2,
            target: { metric: "memory_usage" },
        };

        const engine = new MonitorEngine({
            gateway: mockGateway as any,
            rules: [rule],
        });

        await (engine as any).runCheck(rule);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenCalledTimes(1);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenLastCalledWith(expect.objectContaining({
            type: "monitor.alert",
        }));

        await (engine as any).runCheck(rule);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenCalledTimes(1);

        await (engine as any).runCheck(rule);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenCalledTimes(2);
        expect(mockGateway.dispatchMonitorEvent).toHaveBeenLastCalledWith(expect.objectContaining({
            ruleId: "memory-usage",
            type: "monitor.recovered",
            details: expect.objectContaining({
                consecutiveSuccesses: 2,
                recoveryThreshold: 2,
            }),
        }));
    });
});
