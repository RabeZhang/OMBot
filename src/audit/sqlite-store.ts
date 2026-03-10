import Database from "better-sqlite3";
import type { AuditRecord, AuditQueryFilter, AuditStore } from "./types";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS audit_records (
  audit_id       TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  risk_level     TEXT NOT NULL,
  input          TEXT NOT NULL,
  decision       TEXT NOT NULL,
  approval_id    TEXT,
  result_status  TEXT NOT NULL,
  result_summary TEXT,
  created_at     TEXT NOT NULL
);
`;

const CREATE_INDEXES_SQL = [
    `CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_records(session_id);`,
    `CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit_records(tool_name);`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_records(created_at);`,
];

const INSERT_SQL = `
INSERT INTO audit_records (
  audit_id, session_id, tool_name, risk_level, input,
  decision, approval_id, result_status, result_summary, created_at
) VALUES (
  @auditId, @sessionId, @toolName, @riskLevel, @input,
  @decision, @approvalId, @resultStatus, @resultSummary, @createdAt
);
`;

/**
 * 基于 better-sqlite3 的审计存储实现。
 *
 * 特性：
 * - WAL 模式，提升并发读写性能
 * - 自动建表 + 索引
 * - 参数化查询，防止 SQL 注入
 */
export class SqliteAuditStore implements AuditStore {
    private db: Database.Database | null = null;
    private readonly dbPath: string;
    private insertStmt: Database.Statement | null = null;

    constructor(dbPath: string) {
        this.dbPath = dbPath;
    }

    async init(): Promise<void> {
        this.db = new Database(this.dbPath);

        // WAL 模式：允许并发读取，写入性能更好
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL");

        this.db.exec(CREATE_TABLE_SQL);
        for (const sql of CREATE_INDEXES_SQL) {
            this.db.exec(sql);
        }

        // 预编译插入语句
        this.insertStmt = this.db.prepare(INSERT_SQL);
    }

    async append(record: AuditRecord): Promise<void> {
        if (!this.insertStmt) {
            throw new Error("AuditStore 未初始化，请先调用 init()");
        }

        this.insertStmt.run({
            auditId: record.auditId,
            sessionId: record.sessionId,
            toolName: record.toolName,
            riskLevel: record.riskLevel,
            input: record.input,
            decision: record.decision,
            approvalId: record.approvalId ?? null,
            resultStatus: record.resultStatus,
            resultSummary: record.resultSummary ?? null,
            createdAt: record.createdAt,
        });
    }

    async query(filter: AuditQueryFilter): Promise<AuditRecord[]> {
        if (!this.db) {
            throw new Error("AuditStore 未初始化，请先调用 init()");
        }

        const conditions: string[] = [];
        const params: Record<string, unknown> = {};

        if (filter.sessionId) {
            conditions.push("session_id = @sessionId");
            params.sessionId = filter.sessionId;
        }
        if (filter.toolName) {
            conditions.push("tool_name = @toolName");
            params.toolName = filter.toolName;
        }
        if (filter.riskLevel) {
            conditions.push("risk_level = @riskLevel");
            params.riskLevel = filter.riskLevel;
        }
        if (filter.decision) {
            conditions.push("decision = @decision");
            params.decision = filter.decision;
        }
        if (filter.since) {
            conditions.push("created_at >= @since");
            params.since = filter.since;
        }
        if (filter.until) {
            conditions.push("created_at <= @until");
            params.until = filter.until;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = filter.limit ?? 100;

        const sql = `SELECT * FROM audit_records ${where} ORDER BY created_at DESC LIMIT ${limit}`;
        const rows = this.db.prepare(sql).all(params) as RawAuditRow[];

        return rows.map(rowToRecord);
    }

    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.insertStmt = null;
        }
    }
}

/** SQLite 返回的原始行类型。 */
interface RawAuditRow {
    audit_id: string;
    session_id: string;
    tool_name: string;
    risk_level: string;
    input: string;
    decision: string;
    approval_id: string | null;
    result_status: string;
    result_summary: string | null;
    created_at: string;
}

function rowToRecord(row: RawAuditRow): AuditRecord {
    return {
        auditId: row.audit_id,
        sessionId: row.session_id,
        toolName: row.tool_name,
        riskLevel: row.risk_level as AuditRecord["riskLevel"],
        input: row.input,
        decision: row.decision as AuditRecord["decision"],
        approvalId: row.approval_id ?? undefined,
        resultStatus: row.result_status as AuditRecord["resultStatus"],
        resultSummary: row.result_summary ?? undefined,
        createdAt: row.created_at,
    };
}
