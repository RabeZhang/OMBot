import type { ToolRiskLevel } from "../tools/types";

/**
 * 审计决策类型。
 */
export type AuditDecision = "allowed" | "denied" | "approved" | "timeout";

/**
 * 审计结果状态。
 */
export type AuditResultStatus = "success" | "error" | "pending";

/**
 * 结构化审计记录。
 * 每次工具调用（无论成功与否）都会生成一条。
 */
export interface AuditRecord {
    auditId: string;
    sessionId: string;
    toolName: string;
    riskLevel: ToolRiskLevel;
    input: string;            // JSON 序列化的工具输入参数
    decision: AuditDecision;
    approvalId?: string;
    resultStatus: AuditResultStatus;
    resultSummary?: string;   // 简短结果摘要（截断到 500 字符）
    createdAt: string;        // ISO 8601
}

/**
 * 审计查询过滤条件。
 */
export interface AuditQueryFilter {
    sessionId?: string;
    toolName?: string;
    riskLevel?: ToolRiskLevel;
    decision?: AuditDecision;
    /** 时间范围起始（ISO 8601） */
    since?: string;
    /** 时间范围结束（ISO 8601） */
    until?: string;
    /** 最大返回条数（默认 100） */
    limit?: number;
}

/**
 * 审计存储接口。
 */
export interface AuditStore {
    /** 初始化存储（建表等） */
    init(): Promise<void>;
    /** 追加一条审计记录 */
    append(record: AuditRecord): Promise<void>;
    /** 按条件查询审计记录 */
    query(filter: AuditQueryFilter): Promise<AuditRecord[]>;
    /** 关闭存储连接 */
    close(): void;
}
