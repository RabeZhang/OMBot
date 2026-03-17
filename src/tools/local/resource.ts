import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

import { z } from "zod";

import type { OmbotToolDefinition } from "../types";

const execFileAsync = promisify(execFile);
const CPU_SAMPLE_WINDOW_MS = 150;

export interface CpuUsageResult {
  coreCount: number;
  sampleWindowMs: number;
  usagePercent: number;
  estimatedUsagePercent: number;
  loadAverage1m: number;
  loadAverage5m: number;
  loadAverage15m: number;
}

export interface MemoryUsageResult {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  availableBytes: number;
  rawFreeBytes?: number;
  cachedBytes?: number;
  swapTotalBytes?: number;
  swapUsedBytes?: number;
  usagePercent: number;
}

export interface DiskUsageInput {
  path?: string;
}

export interface DiskUsageResult {
  filesystem: string;
  filesystemType?: string;
  mountPoint: string;
  totalKb: number;
  usedKb: number;
  availableKb: number;
  usagePercent: number;
  reservedOrSharedKb?: number;
  accountingMode: "posix_df" | "apfs_shared_container";
  accountingNote?: string;
}

interface LinuxMeminfo {
  memTotalKb: number;
  memFreeKb: number;
  memAvailableKb: number;
  cachedKb: number;
  swapTotalKb: number;
  swapFreeKb: number;
}

interface MacVmStat {
  pageSizeBytes: number;
  freePages: number;
  inactivePages: number;
  speculativePages: number;
  purgeablePages: number;
  fileBackedPages: number;
}

const emptyInputSchema = z.object({});
const diskUsageInputSchema = z.object({
  path: z.string().min(1).optional(),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function snapshotCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }

  return {
    coreCount: cpus.length || 1,
    idle,
    total,
  };
}

async function sampleCpuUsage(): Promise<{ coreCount: number; usagePercent: number }> {
  const first = snapshotCpuTimes();
  await sleep(CPU_SAMPLE_WINDOW_MS);
  const second = snapshotCpuTimes();

  const idleDelta = second.idle - first.idle;
  const totalDelta = second.total - first.total;
  const usagePercent = totalDelta <= 0
    ? 0
    : clampPercent(((totalDelta - idleDelta) / totalDelta) * 100);

  return {
    coreCount: second.coreCount,
    usagePercent,
  };
}

function parseNumericKb(rawValue: string | undefined): number {
  if (!rawValue) return 0;
  return Number(rawValue.trim()) || 0;
}

export function parseLinuxMeminfo(raw: string): LinuxMeminfo {
  const values: Record<string, number> = {};

  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (!match) {
      continue;
    }

    values[match[1]] = Number(match[2]);
  }

  return {
    memTotalKb: values.MemTotal ?? 0,
    memFreeKb: values.MemFree ?? 0,
    memAvailableKb: values.MemAvailable ?? values.MemFree ?? 0,
    cachedKb: (values.Cached ?? 0) + (values.Buffers ?? 0) + (values.SReclaimable ?? 0),
    swapTotalKb: values.SwapTotal ?? 0,
    swapFreeKb: values.SwapFree ?? 0,
  };
}

function parseMacVmStatCount(rawValue: string | undefined): number {
  if (!rawValue) return 0;
  return Number(rawValue.replace(/\./g, "").trim()) || 0;
}

export function parseMacVmStat(raw: string): MacVmStat {
  const pageSizeMatch = raw.match(/page size of (\d+) bytes/);
  const pageSizeBytes = Number(pageSizeMatch?.[1] ?? 4096);

  const values: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^([^:]+):\s+(.+)$/);
    if (!match) {
      continue;
    }

    values[match[1].trim()] = parseMacVmStatCount(match[2]);
  }

  return {
    pageSizeBytes,
    freePages: values["Pages free"] ?? 0,
    inactivePages: values["Pages inactive"] ?? 0,
    speculativePages: values["Pages speculative"] ?? 0,
    purgeablePages: values["Pages purgeable"] ?? 0,
    fileBackedPages: values["File-backed pages"] ?? 0,
  };
}

function parseMacSwapUsage(raw: string): { swapTotalBytes?: number; swapUsedBytes?: number } {
  const match = raw.match(/total = ([0-9.]+)([MGT])\s+used = ([0-9.]+)([MGT])/i);
  if (!match) {
    return {};
  }

  const toBytes = (value: number, unit: string) => {
    const multiplier = unit.toUpperCase() === "T"
      ? 1024 ** 4
      : unit.toUpperCase() === "G"
        ? 1024 ** 3
        : 1024 ** 2;
    return Math.round(value * multiplier);
  };

  return {
    swapTotalBytes: toBytes(Number(match[1]), match[2]),
    swapUsedBytes: toBytes(Number(match[3]), match[4]),
  };
}

async function safeExec(file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(file, args, {
      encoding: "utf8",
      timeout: 5000,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function collectLinuxMemory(): Promise<MemoryUsageResult | null> {
  const raw = await safeExec("cat", ["/proc/meminfo"]);
  if (!raw) {
    return null;
  }

  const parsed = parseLinuxMeminfo(raw);
  if (parsed.memTotalKb <= 0) {
    return null;
  }

  const totalBytes = parsed.memTotalKb * 1024;
  const availableBytes = parsed.memAvailableKb * 1024;
  const rawFreeBytes = parsed.memFreeKb * 1024;
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapTotalBytes = parsed.swapTotalKb * 1024;
  const swapUsedBytes = Math.max(0, swapTotalBytes - parsed.swapFreeKb * 1024);

  return {
    totalBytes,
    freeBytes: availableBytes,
    usedBytes,
    availableBytes,
    rawFreeBytes,
    cachedBytes: parsed.cachedKb * 1024,
    swapTotalBytes,
    swapUsedBytes,
    usagePercent: clampPercent((usedBytes / totalBytes) * 100),
  };
}

async function collectMacMemory(): Promise<MemoryUsageResult | null> {
  const totalRaw = await safeExec("sh", ["-lc", "sysctl -n hw.memsize"]);
  const totalBytes = Number((totalRaw ?? "").trim()) || os.totalmem();
  if (totalBytes <= 0) {
    return null;
  }

  const vmStatRaw = await safeExec("vm_stat", []);
  if (!vmStatRaw) {
    const freeBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return {
      totalBytes,
      freeBytes,
      usedBytes,
      availableBytes: freeBytes,
      usagePercent: clampPercent((usedBytes / totalBytes) * 100),
    };
  }

  const parsed = parseMacVmStat(vmStatRaw);
  const availablePages = parsed.freePages + parsed.inactivePages + parsed.speculativePages;
  const availableBytes = availablePages * parsed.pageSizeBytes;
  const freeBytes = availableBytes;
  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapRaw = await safeExec("sh", ["-lc", "sysctl vm.swapusage"]);
  const swap = swapRaw ? parseMacSwapUsage(swapRaw) : {};

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    availableBytes,
    rawFreeBytes: parsed.freePages * parsed.pageSizeBytes,
    cachedBytes: (parsed.fileBackedPages + parsed.purgeablePages) * parsed.pageSizeBytes,
    swapTotalBytes: swap.swapTotalBytes,
    swapUsedBytes: swap.swapUsedBytes,
    usagePercent: clampPercent((usedBytes / totalBytes) * 100),
  };
}

async function collectGenericMemory(): Promise<MemoryUsageResult> {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  return {
    totalBytes,
    freeBytes,
    usedBytes,
    availableBytes: freeBytes,
    usagePercent: totalBytes === 0 ? 0 : clampPercent((usedBytes / totalBytes) * 100),
  };
}

async function collectMemory(): Promise<MemoryUsageResult> {
  if (process.platform === "linux") {
    const linux = await collectLinuxMemory();
    if (linux) {
      return linux;
    }
  }

  if (process.platform === "darwin") {
    const mac = await collectMacMemory();
    if (mac) {
      return mac;
    }
  }

  return collectGenericMemory();
}

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
    accountingMode: "posix_df",
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function detectFilesystemType(mountPoint: string): Promise<string | undefined> {
  const mountOutput = await safeExec("mount", []);
  if (!mountOutput) {
    return undefined;
  }

  const pattern = new RegExp(` on ${escapeRegExp(mountPoint)} \\(([^,\\)]+)`);
  for (const line of mountOutput.split("\n")) {
    const match = line.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

export const getCpuUsageTool: OmbotToolDefinition<Record<string, never>, CpuUsageResult> = {
  name: "get_cpu_usage",
  description: "获取 CPU 实时采样占用率和负载信息",
  riskLevel: "readonly",
  parametersSchema: emptyInputSchema,
  async execute() {
    const { coreCount, usagePercent } = await sampleCpuUsage();
    const [load1m, load5m, load15m] = os.loadavg();

    return {
      coreCount,
      sampleWindowMs: CPU_SAMPLE_WINDOW_MS,
      usagePercent,
      estimatedUsagePercent: usagePercent,
      loadAverage1m: load1m,
      loadAverage5m: load5m,
      loadAverage15m: load15m,
    };
  },
};

export const getMemoryUsageTool: OmbotToolDefinition<Record<string, never>, MemoryUsageResult> = {
  name: "get_memory_usage",
  description: "获取更接近系统真实可用内存的使用情况",
  riskLevel: "readonly",
  parametersSchema: emptyInputSchema,
  async execute() {
    return collectMemory();
  },
};

export const getDiskUsageTool: OmbotToolDefinition<DiskUsageInput, DiskUsageResult> = {
  name: "get_disk_usage",
  description: "获取指定路径所在分区的磁盘使用情况",
  riskLevel: "readonly",
  parametersSchema: diskUsageInputSchema,
  async execute(input) {
    const targetPath = input.path ?? "/";
    const { stdout } = await execFileAsync("df", ["-Pk", targetPath], {
      encoding: "utf8",
      timeout: 5000,
    });
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsed = parseDfLine(lines.at(-1) ?? "");
    if (!parsed) {
      throw new Error(`无法解析磁盘使用信息: ${stdout}`);
    }

    const filesystemType = await detectFilesystemType(parsed.mountPoint);
    const reservedOrSharedKb = Math.max(0, parsed.totalKb - parsed.usedKb - parsed.availableKb);

    if (process.platform === "darwin" && filesystemType === "apfs") {
      return {
        ...parsed,
        filesystemType,
        reservedOrSharedKb,
        accountingMode: "apfs_shared_container",
        accountingNote: reservedOrSharedKb > 0
          ? "APFS 卷与容器共享空间，df 的 available 是当前卷可立即写入空间，total-used-available 的差值通常来自共享/保留/快照等空间语义。"
          : "APFS 卷空间由容器共享，available 表示当前卷可立即写入空间。",
      };
    }

    return {
      ...parsed,
      filesystemType,
      reservedOrSharedKb,
      accountingMode: "posix_df",
    };
  },
};
