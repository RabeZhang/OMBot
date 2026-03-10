import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SqliteAuditStore } from "../../src/audit/sqlite-store";
import type { AuditRecord } from "../../src/audit/types";

function createTempDbPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ombot-audit-test-"));
    return path.join(dir, "test-audit.db");
}

describe("SqliteAuditStore", () => {
    let store: SqliteAuditStore;
    let dbPath: string;

    afterEach(() => {
        store?.close();
        if (dbPath && fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
            // 清理 WAL 文件
            if (fs.existsSync(dbPath + "-wal")) fs.unlinkSync(dbPath + "-wal");
            if (fs.existsSync(dbPath + "-shm")) fs.unlinkSync(dbPath + "-shm");
            fs.rmdirSync(path.dirname(dbPath));
        }
    });

    it("init 创建表和索引", async () => {
        dbPath = createTempDbPath();
        store = new SqliteAuditStore(dbPath);
        await store.init();
        expect(fs.existsSync(dbPath)).toBe(true);
    });

    it("append 写入并 query 读取", async () => {
        dbPath = createTempDbPath();
        store = new SqliteAuditStore(dbPath);
        await store.init();

        const record: AuditRecord = {
            auditId: "audit_001",
            sessionId: "sess_001",
            toolName: "get_cpu_usage",
            riskLevel: "readonly",
            input: "{}",
            decision: "allowed",
            resultStatus: "success",
            resultSummary: "CPU 使用率 15%",
            createdAt: "2026-03-07T15:00:00Z",
        };

        await store.append(record);

        const results = await store.query({});
        expect(results).toHaveLength(1);
        expect(results[0].auditId).toBe("audit_001");
        expect(results[0].toolName).toBe("get_cpu_usage");
        expect(results[0].resultSummary).toBe("CPU 使用率 15%");
    });

    it("按 sessionId 过滤", async () => {
        dbPath = createTempDbPath();
        store = new SqliteAuditStore(dbPath);
        await store.init();

        await store.append({
            auditId: "a1",
            sessionId: "sess_A",
            toolName: "bash",
            riskLevel: "mutating",
            input: '{"command":"uptime"}',
            decision: "allowed",
            resultStatus: "success",
            createdAt: "2026-03-07T15:01:00Z",
        });

        await store.append({
            auditId: "a2",
            sessionId: "sess_B",
            toolName: "grep",
            riskLevel: "readonly",
            input: '{"pattern":"TODO"}',
            decision: "allowed",
            resultStatus: "success",
            createdAt: "2026-03-07T15:02:00Z",
        });

        const sessA = await store.query({ sessionId: "sess_A" });
        expect(sessA).toHaveLength(1);
        expect(sessA[0].toolName).toBe("bash");

        const sessB = await store.query({ sessionId: "sess_B" });
        expect(sessB).toHaveLength(1);
        expect(sessB[0].toolName).toBe("grep");
    });

    it("按 riskLevel 和时间范围过滤", async () => {
        dbPath = createTempDbPath();
        store = new SqliteAuditStore(dbPath);
        await store.init();

        await store.append({
            auditId: "a1",
            sessionId: "s1",
            toolName: "get_cpu_usage",
            riskLevel: "readonly",
            input: "{}",
            decision: "allowed",
            resultStatus: "success",
            createdAt: "2026-03-07T10:00:00Z",
        });

        await store.append({
            auditId: "a2",
            sessionId: "s1",
            toolName: "bash",
            riskLevel: "mutating",
            input: '{"command":"ls"}',
            decision: "allowed",
            resultStatus: "success",
            createdAt: "2026-03-07T12:00:00Z",
        });

        const mutating = await store.query({ riskLevel: "mutating" });
        expect(mutating).toHaveLength(1);
        expect(mutating[0].toolName).toBe("bash");

        const afternoon = await store.query({ since: "2026-03-07T11:00:00Z" });
        expect(afternoon).toHaveLength(1);
        expect(afternoon[0].auditId).toBe("a2");
    });

    it("close 后不能再使用", async () => {
        dbPath = createTempDbPath();
        store = new SqliteAuditStore(dbPath);
        await store.init();
        store.close();

        await expect(store.append({
            auditId: "x",
            sessionId: "s",
            toolName: "t",
            riskLevel: "readonly",
            input: "{}",
            decision: "allowed",
            resultStatus: "success",
            createdAt: new Date().toISOString(),
        })).rejects.toThrow();
    });
});
