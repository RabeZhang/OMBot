import fs from "node:fs/promises";
import path from "node:path";

import type { TranscriptEntry, TranscriptStore } from "./types";

interface FileTranscriptStoreOptions {
  transcriptsDir: string;
}

function getTranscriptFilePath(transcriptsDir: string, sessionId: string): string {
  return path.join(transcriptsDir, `${sessionId}.jsonl`);
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

export class FileTranscriptStore implements TranscriptStore {
  private readonly transcriptsDir: string;

  constructor(options: FileTranscriptStoreOptions) {
    this.transcriptsDir = options.transcriptsDir;
  }

  async append(entry: TranscriptEntry): Promise<void> {
    await ensureDir(this.transcriptsDir);
    const filePath = getTranscriptFilePath(this.transcriptsDir, entry.sessionId);
    // transcript 采用 append-only JSONL，便于回放、调试和后续压缩。
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async listBySession(sessionId: string, limit?: number): Promise<TranscriptEntry[]> {
    const filePath = getTranscriptFilePath(this.transcriptsDir, sessionId);

    try {
      const content = await fs.readFile(filePath, "utf8");
      const entries = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as TranscriptEntry);

      if (limit === undefined) {
        return entries;
      }

      // 这里先返回最近 N 条，后面再视需要优化为倒序读取大文件。
      return entries.slice(-limit);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async deleteBySession(sessionId: string): Promise<void> {
    const filePath = getTranscriptFilePath(this.transcriptsDir, sessionId);
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}
