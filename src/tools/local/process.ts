import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import type { OmbotToolDefinition } from "../types";

const execFileAsync = promisify(execFile);

const getProcessStatusInputSchema = z
  .object({
    pid: z.number().int().positive().optional(),
    processName: z.string().min(1).optional(),
  })
  .refine((value) => value.pid !== undefined || value.processName !== undefined, {
    message: "pid 和 processName 至少提供一个",
  });

export interface ProcessStatusInput {
  pid?: number;
  processName?: string;
}

export interface ProcessStatusResult {
  running: boolean;
  query: ProcessStatusInput;
  matches: Array<{
    pid: number;
    command: string;
    args: string;
  }>;
}

function parsePsLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+)\s+(\S+)\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    pid: Number(match[1]),
    command: match[2],
    args: match[3] ?? "",
  };
}

async function listProcesses(): Promise<ProcessStatusResult["matches"]> {
  const { stdout } = await execFileAsync("ps", ["-ax", "-o", "pid=,comm=,args="]);
  return stdout
    .split("\n")
    .map((line) => parsePsLine(line))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export const getProcessStatusTool: OmbotToolDefinition<ProcessStatusInput, ProcessStatusResult> = {
  name: "get_process_status",
  description: "查询进程是否存活以及匹配列表",
  riskLevel: "readonly",
  parametersSchema: getProcessStatusInputSchema,
  async execute(input) {
    // 先用 ps 做跨 Linux/macOS 的最小实现，后面再按需要补更丰富的字段。
    const processes = await listProcesses();
    const normalizedName = input.processName ? path.basename(input.processName).toLowerCase() : undefined;

    const matches = processes.filter((processInfo) => {
      // pid 匹配优先级更高；只有没给 pid 时才走 processName 模糊匹配。
      if (input.pid !== undefined) {
        return processInfo.pid === input.pid;
      }

      if (!normalizedName) {
        return false;
      }

      return (
        processInfo.command.toLowerCase() === normalizedName ||
        path.basename(processInfo.command).toLowerCase() === normalizedName ||
        processInfo.args.toLowerCase().includes(normalizedName)
      );
    });

    return {
      running: matches.length > 0,
      query: input,
      matches,
    };
  },
};
