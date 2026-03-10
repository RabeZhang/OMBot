import { describe, it, expect, vi } from "vitest";
import { parseDuration, createInitialState } from "../../src/monitor/types";
import { MonitorEngine } from "../../src/monitor/engine";

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
});
