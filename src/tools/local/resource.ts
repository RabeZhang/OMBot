import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import { z } from "zod";

import type { OmbotToolDefinition } from "../types";

const execFileAsync = promisify(execFile);

export interface CpuUsageResult {
  coreCount: number;
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
  estimatedUsagePercent: number;
}

export interface MemoryUsageResult {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usagePercent: number;
}

export interface DiskUsageInput {
  path?: string;
}

export interface DiskUsageResult {
  filesystem: string;
  mountPoint: string;
  totalKb: number;
  usedKb: number;
  availableKb: number;
  usagePercent: number;
}

const emptyInputSchema = z.object({});
const diskUsageInputSchema = z.object({
  path: z.string().min(1).optional(),
});

export const getCpuUsageTool: OmbotToolDefinition<Record<string, never>, CpuUsageResult> = {
  name: "get_cpu_usage",
  description: "获取 CPU 负载和估算占用率",
  riskLevel: "readonly",
  parametersSchema: emptyInputSchema,
  async execute() {
    const [load1m, load5m, load15m] = os.loadavg();
    const coreCount = os.cpus().length || 1;
    const estimatedUsagePercent = Math.max(0, Math.min(100, (load1m / coreCount) * 100));

    // 这里先用 load average 做保守估算，后续再替换为更精细的采样统计。
    return {
      coreCount,
      loadAverage1m: load1m,
      loadAverage5m: load5m,
      loadAverage15m: load15m,
      estimatedUsagePercent,
    };
  },
};

export const getMemoryUsageTool: OmbotToolDefinition<Record<string, never>, MemoryUsageResult> = {
  name: "get_memory_usage",
  description: "获取物理内存使用情况",
  riskLevel: "readonly",
  parametersSchema: emptyInputSchema,
  async execute() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = totalBytes - freeBytes;
    // Phase 1 先只统计物理内存，不展开 swap 和更细粒度进程内存分布。
    const usagePercent = totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100;

    return {
      totalBytes,
      freeBytes,
      usedBytes,
      usagePercent,
    };
  },
};

function parseDfLine(line: string): DiskUsageResult | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    filesystem: match[1],
    totalKb: Number(match[2]),
    usedKb: Number(match[3]),
    availableKb: Number(match[4]),
    usagePercent: Number(match[5]),
    mountPoint: match[6],
  };
}

export const getDiskUsageTool: OmbotToolDefinition<DiskUsageInput, DiskUsageResult> = {
  name: "get_disk_usage",
  description: "获取指定路径所在分区的磁盘使用情况",
  riskLevel: "readonly",
  parametersSchema: diskUsageInputSchema,
  async execute(input) {
    const targetPath = input.path ?? "/";
    const { stdout } = await execFileAsync("df", ["-k", targetPath]);
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // `df -k <path>` 的最后一行就是目标路径所在分区，足够满足 Phase 1 的使用场景。
    const parsed = parseDfLine(lines.at(-1) ?? "");
    if (!parsed) {
      throw new Error(`无法解析磁盘使用信息: ${stdout}`);
    }

    return parsed;
  },
};
