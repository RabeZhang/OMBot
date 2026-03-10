import fs from "node:fs/promises";
import path from "node:path";

import { createId } from "../shared/ids";
import { nowIsoString } from "../shared/time";
import type {
  SessionCreateInput,
  SessionRecord,
  SessionStore,
  SessionSummary,
} from "./types";

interface FileSessionStoreOptions {
  indexFilePath: string;
  hostId: string;
  defaultChannel?: "cli" | "internal";
}

async function ensureParentDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readIndexFile(filePath: string): Promise<SessionRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    if (!content.trim()) {
      return [];
    }
    const parsed = JSON.parse(content) as SessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: unknown) {
    // 第一次启动时索引文件不存在是正常情况，这里直接视为空列表。
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    // JSON 解析失败（文件损坏）：备份损坏文件并从空列表重新开始
    if (error instanceof SyntaxError) {
      const backupPath = `${filePath}.corrupted.${Date.now()}`;
      console.warn(`[session-store] 会话索引文件损坏，已备份到 ${backupPath}，将重新创建`);
      try {
        await fs.rename(filePath, backupPath);
      } catch {
        // 备份失败也不影响恢复
      }
      return [];
    }

    throw error;
  }
}

async function writeIndexFile(filePath: string, records: SessionRecord[]): Promise<void> {
  await ensureParentDir(filePath);
  // 原子写入：先写临时文件再 rename，避免写入过程中断导致文件损坏
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

/**
 * 简单的互斥锁，防止并发读写索引文件导致数据损坏。
 * 当多条监控规则同时触发时，所有 session 操作必须排队执行。
 */
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

export class FileSessionStore implements SessionStore {
  private readonly indexFilePath: string;
  private readonly hostId: string;
  private readonly defaultChannel: "cli" | "internal";
  private readonly mutex = new Mutex();

  constructor(options: FileSessionStoreOptions) {
    this.indexFilePath = options.indexFilePath;
    this.hostId = options.hostId;
    this.defaultChannel = options.defaultChannel ?? "cli";
  }

  async create(input: SessionCreateInput): Promise<SessionRecord> {
    await this.mutex.acquire();
    try {
      const records = await readIndexFile(this.indexFilePath);
      const timestamp = nowIsoString();

      const record: SessionRecord = {
        sessionId: createId("sess"),
        type: input.type,
        status: "active",
        hostId: this.hostId,
        channel: input.channel ?? this.defaultChannel,
        createdAt: timestamp,
        updatedAt: timestamp,
        title: input.title,
        relatedMonitorKey: input.relatedMonitorKey,
      };

      records.push(record);
      await writeIndexFile(this.indexFilePath, records);
      return record;
    } finally {
      this.mutex.release();
    }
  }

  async get(sessionId: string): Promise<SessionRecord | null> {
    await this.mutex.acquire();
    try {
      const records = await readIndexFile(this.indexFilePath);
      return records.find((record) => record.sessionId === sessionId) ?? null;
    } finally {
      this.mutex.release();
    }
  }

  async list(): Promise<SessionSummary[]> {
    await this.mutex.acquire();
    try {
      const records = await readIndexFile(this.indexFilePath);
      return records
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map<SessionSummary>((record) => ({
          sessionId: record.sessionId,
          type: record.type,
          status: record.status,
          title: record.title,
          updatedAt: record.updatedAt,
        }));
    } finally {
      this.mutex.release();
    }
  }

  async update(session: SessionRecord): Promise<void> {
    await this.mutex.acquire();
    try {
      const records = await readIndexFile(this.indexFilePath);
      const index = records.findIndex((record) => record.sessionId === session.sessionId);

      if (index === -1) {
        throw new Error(`Session not found: ${session.sessionId}`);
      }

      records[index] = {
        ...session,
        updatedAt: nowIsoString(),
      };

      await writeIndexFile(this.indexFilePath, records);
    } finally {
      this.mutex.release();
    }
  }
}
