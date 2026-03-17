import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { nowIsoString } from "../shared/time";
import type { HostCapabilityStatus, HostEnvironmentSnapshot, HostOsFamily, HostPathInfo } from "./types";

const execFileAsync = promisify(execFile);

const DEFAULT_CAPABILITIES = [
  "python3",
  "python",
  "node",
  "npm",
  "git",
  "docker",
  "bash",
  "sh",
  "tsx",
  "ts-node",
] as const;

interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface HostEnvironmentCollectorOptions {
  executionMode: "host" | "docker";
  workspaceDir: string;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  kernelRelease?: string;
  hostname?: string;
  userInfo?: {
    username: string;
    homedir: string;
  };
  pathExists?: (targetPath: string) => Promise<boolean>;
  readFile?: (targetPath: string) => Promise<string>;
  exec?: (file: string, args?: string[]) => Promise<CommandResult>;
}

async function defaultExec(file: string, args: string[] = []): Promise<CommandResult> {
  const result = await execFileAsync(file, args, {
    encoding: "utf8",
    timeout: 5000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function defaultReadFile(targetPath: string): Promise<string> {
  return fs.readFile(targetPath, "utf8");
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeOsFamily(platform: NodeJS.Platform): HostOsFamily {
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return "unknown";
}

function parseOsRelease(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^"/, "").replace(/"$/, "");
    result[key] = value;
  }
  return result;
}

function parseSwVers(raw: string): { productName?: string; productVersion?: string } {
  const lines = raw.split("\n");
  const parsed: { productName?: string; productVersion?: string } = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("ProductName:")) {
      parsed.productName = trimmed.slice("ProductName:".length).trim();
    }
    if (trimmed.startsWith("ProductVersion:")) {
      parsed.productVersion = trimmed.slice("ProductVersion:".length).trim();
    }
  }

  return parsed;
}

async function safeExec(
  exec: (file: string, args?: string[]) => Promise<CommandResult>,
  file: string,
  args: string[] = [],
): Promise<CommandResult | null> {
  try {
    return await exec(file, args);
  } catch {
    return null;
  }
}

async function safeReadFile(
  readFile: (targetPath: string) => Promise<string>,
  targetPath: string,
): Promise<string | null> {
  try {
    return await readFile(targetPath);
  } catch {
    return null;
  }
}

async function resolveCapability(
  commandName: string,
  exec: (file: string, args?: string[]) => Promise<CommandResult>,
): Promise<HostCapabilityStatus> {
  const result = await safeExec(exec, "sh", ["-lc", `command -v ${commandName}`]);
  const resolvedPath = result?.stdout.trim();
  if (!resolvedPath) {
    return { available: false };
  }
  return {
    available: true,
    resolvedPath,
  };
}

async function buildPathInfo(
  targetPath: string,
  pathExists: (targetPath: string) => Promise<boolean>,
): Promise<HostPathInfo> {
  return {
    path: targetPath,
    exists: await pathExists(targetPath),
  };
}

export class HostEnvironmentCollector {
  private readonly executionMode: "host" | "docker";
  private readonly workspaceDir: string;
  private readonly dataDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly kernelRelease: string;
  private readonly hostname: string;
  private readonly userInfo: {
    username: string;
    homedir: string;
  };
  private readonly pathExists: (targetPath: string) => Promise<boolean>;
  private readonly readFile: (targetPath: string) => Promise<string>;
  private readonly exec: (file: string, args?: string[]) => Promise<CommandResult>;

  constructor(options: HostEnvironmentCollectorOptions) {
    this.executionMode = options.executionMode;
    this.workspaceDir = options.workspaceDir;
    this.dataDir = options.dataDir;
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? os.arch();
    this.kernelRelease = options.kernelRelease ?? os.release();
    this.hostname = options.hostname ?? os.hostname();
    this.userInfo = options.userInfo ?? os.userInfo();
    this.pathExists = options.pathExists ?? defaultPathExists;
    this.readFile = options.readFile ?? defaultReadFile;
    this.exec = options.exec ?? defaultExec;
  }

  async collect(): Promise<HostEnvironmentSnapshot> {
    const osFamily = normalizeOsFamily(this.platform);
    const basePlatform = {
      osFamily,
      distribution: osFamily === "macos" ? "macOS" : osFamily === "linux" ? "Linux" : this.platform,
      version: undefined as string | undefined,
      kernel: this.kernelRelease,
      architecture: this.arch,
      hostname: this.hostname,
    };

    if (osFamily === "linux") {
      const rawOsRelease = await safeReadFile(this.readFile, "/etc/os-release");
      if (rawOsRelease) {
        const parsed = parseOsRelease(rawOsRelease);
        basePlatform.distribution = parsed.PRETTY_NAME ?? parsed.NAME ?? "Linux";
        basePlatform.version = parsed.VERSION_ID ?? parsed.VERSION;
      }
    }

    if (osFamily === "macos") {
      const swVers = await safeExec(this.exec, "sw_vers");
      if (swVers?.stdout) {
        const parsed = parseSwVers(swVers.stdout);
        basePlatform.distribution = parsed.productName ?? "macOS";
        basePlatform.version = parsed.productVersion;
      }
    }

    const insideDocker = await this.detectInsideDocker(osFamily);
    const gui = await this.detectGui(osFamily);
    const homeDir = this.userInfo.homedir;

    const paths = {
      desktop: await buildPathInfo(path.join(homeDir, "Desktop"), this.pathExists),
      downloads: await buildPathInfo(path.join(homeDir, "Downloads"), this.pathExists),
      documents: await buildPathInfo(path.join(homeDir, "Documents"), this.pathExists),
      workspace: await buildPathInfo(this.workspaceDir, this.pathExists),
      data: await buildPathInfo(this.dataDir, this.pathExists),
    };

    const capabilities = await this.collectCapabilities();

    return {
      collectedAt: nowIsoString(),
      platform: basePlatform,
      runtime: {
        executionMode: this.executionMode,
        insideDocker,
        gui,
        terminal: {
          termProgram: this.env.TERM_PROGRAM,
          shell: this.env.SHELL,
        },
      },
      user: {
        username: this.userInfo.username,
        homeDir,
      },
      paths,
      capabilities,
    };
  }

  private async detectInsideDocker(osFamily: HostOsFamily): Promise<boolean> {
    if (await this.pathExists("/.dockerenv")) {
      return true;
    }

    if (this.env.container) {
      return true;
    }

    if (osFamily !== "linux") {
      return false;
    }

    const cgroup = await safeReadFile(this.readFile, "/proc/1/cgroup");
    if (!cgroup) {
      return false;
    }

    return /docker|containerd|kubepods|podman/i.test(cgroup);
  }

  private async detectGui(osFamily: HostOsFamily): Promise<{ available: boolean; sessionType?: string }> {
    if (osFamily === "macos") {
      const desktopExists = await this.pathExists(path.join(this.userInfo.homedir, "Desktop"));
      return {
        available: desktopExists,
        sessionType: desktopExists ? "aqua" : undefined,
      };
    }

    const xdgSessionType = this.env.XDG_SESSION_TYPE?.trim();
    if (this.env.WAYLAND_DISPLAY) {
      return {
        available: true,
        sessionType: xdgSessionType || "wayland",
      };
    }

    if (this.env.DISPLAY) {
      return {
        available: true,
        sessionType: xdgSessionType || "x11",
      };
    }

    if (xdgSessionType === "x11" || xdgSessionType === "wayland") {
      return {
        available: true,
        sessionType: xdgSessionType,
      };
    }

    return { available: false };
  }

  private async collectCapabilities(): Promise<Record<string, HostCapabilityStatus>> {
    const entries = await Promise.all(
      DEFAULT_CAPABILITIES.map(async (commandName) => [commandName, await resolveCapability(commandName, this.exec)] as const),
    );

    return Object.fromEntries(entries);
  }
}
