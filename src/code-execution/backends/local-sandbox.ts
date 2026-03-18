import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createId } from "../../shared/ids";
import { collectArtifacts, createRunDir, removeRunDir, writeEntryFile, writeInputFiles } from "../sandbox";
import type { CodeExecutionBackend, CodeExecutionRequest, CodeExecutionResult, CodeLanguage } from "../types";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024;

interface SpawnResult {
  stdout: string;
  stderr: string;
}

interface SpawnOptions {
  cwd: string;
  timeout: number;
  env: NodeJS.ProcessEnv;
}

export interface LocalSandboxBackendOptions {
  workdirRoot: string;
  pythonBin: string;
  tsRunner: string;
  timeoutSec: number;
  networkEnabled: boolean;
  cpuTimeSec: number;
  maxMemoryMb: number;
  maxFileKb: number;
  maxProcesses: number;
  maxOpenFiles: number;
  keepRunDir?: boolean;
  execFileImpl?: (
    file: string,
    args: string[],
    options: SpawnOptions,
  ) => Promise<SpawnResult>;
}

function truncateOutput(output: string): string {
  return output.length > MAX_OUTPUT_BYTES
    ? `${output.slice(0, MAX_OUTPUT_BYTES)}\n...[truncated]`
    : output;
}

function createSandboxEnv(baseEnv: NodeJS.ProcessEnv, networkEnabled: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: baseEnv.PATH,
    LANG: baseEnv.LANG ?? "C.UTF-8",
    LC_ALL: baseEnv.LC_ALL ?? baseEnv.LANG ?? "C.UTF-8",
    PYTHONUNBUFFERED: "1",
    PYTHONNOUSERSITE: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    npm_config_update_notifier: "false",
    OMBOT_SANDBOX: "1",
    OMBOT_SANDBOX_NETWORK: networkEnabled ? "enabled" : "disabled",
  };

  return env;
}

async function defaultExecFile(
  file: string,
  args: string[],
  options: SpawnOptions,
): Promise<SpawnResult> {
  const result = await execFileAsync(file, args, {
    cwd: options.cwd,
    timeout: options.timeout,
    env: options.env,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export class LocalSandboxBackend implements CodeExecutionBackend {
  readonly kind = "local_sandbox";

  private readonly workdirRoot: string;
  private readonly pythonBin: string;
  private readonly tsRunner: string;
  private readonly timeoutSec: number;
  private readonly networkEnabled: boolean;
  private readonly cpuTimeSec: number;
  private readonly maxMemoryMb: number;
  private readonly maxFileKb: number;
  private readonly maxProcesses: number;
  private readonly maxOpenFiles: number;
  private readonly keepRunDir: boolean;
  private readonly execFileImpl: NonNullable<LocalSandboxBackendOptions["execFileImpl"]>;

  constructor(options: LocalSandboxBackendOptions) {
    this.workdirRoot = options.workdirRoot;
    this.pythonBin = options.pythonBin;
    this.tsRunner = options.tsRunner;
    this.timeoutSec = options.timeoutSec;
    this.networkEnabled = options.networkEnabled;
    this.cpuTimeSec = options.cpuTimeSec;
    this.maxMemoryMb = options.maxMemoryMb;
    this.maxFileKb = options.maxFileKb;
    this.maxProcesses = options.maxProcesses;
    this.maxOpenFiles = options.maxOpenFiles;
    this.keepRunDir = options.keepRunDir ?? false;
    this.execFileImpl = options.execFileImpl ?? defaultExecFile;
  }

  async run(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const runId = createId("sandbox");
    const runDir = await createRunDir(this.workdirRoot, runId);
    let inputFiles: string[] = [];
    let entryFilename = "";

    try {
      const homeDir = path.join(runDir, ".home");
      const tmpDir = path.join(runDir, ".tmp");
      await fs.mkdir(homeDir, { recursive: true });
      await fs.mkdir(tmpDir, { recursive: true });
      inputFiles = await writeInputFiles(runDir, request.files ?? []);
      const entryPath = await writeEntryFile(runDir, request.language, request.code);
      entryFilename = path.basename(entryPath);
      const command = request.language === "python" ? this.pythonBin : this.tsRunner;
      const timeoutMs = (request.timeoutSec ?? this.timeoutSec) * 1000;
      const env = createSandboxEnv(process.env, this.networkEnabled);
      env.HOME = homeDir;
      env.TMPDIR = tmpDir;
      env.TMP = tmpDir;
      env.TEMP = tmpDir;

      const { executable, args } = this.buildExecutionCommand(command, entryFilename);
      const result = await this.execFileImpl(executable, args, {
        cwd: runDir,
        timeout: timeoutMs,
        env,
      });

      const artifacts = await collectArtifacts(runDir, [...inputFiles, entryFilename]);
      return {
        ok: true,
        language: request.language,
        backend: this.kind,
        isolationLevel: "lightweight",
        summary: buildExecutionSummary(request.language, true, 0, false, artifacts.length),
        exitCode: 0,
        stdout: truncateOutput(result.stdout),
        stderr: truncateOutput(result.stderr),
        timedOut: false,
        artifacts,
      };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        code?: string | number;
        killed?: boolean;
      };
      const excludedArtifacts = entryFilename ? [...inputFiles, entryFilename] : [...inputFiles];
      const artifacts = await collectArtifacts(runDir, excludedArtifacts).catch(() => []);
      const stdout = typeof execError.stdout === "string"
        ? execError.stdout
        : Buffer.isBuffer(execError.stdout)
          ? execError.stdout.toString("utf8")
          : "";
      const stderr = typeof execError.stderr === "string"
        ? execError.stderr
        : Buffer.isBuffer(execError.stderr)
          ? execError.stderr.toString("utf8")
          : execError.message;
      const timedOut = execError.killed === true || execError.code === "ETIMEDOUT";
      const exitCode = typeof execError.code === "number" ? execError.code : timedOut ? 124 : 1;

      return {
        ok: false,
        language: request.language,
        backend: this.kind,
        isolationLevel: "lightweight",
        summary: buildExecutionSummary(request.language, false, exitCode, timedOut, artifacts.length),
        exitCode,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        timedOut,
        artifacts,
      };
    } finally {
      if (!this.keepRunDir) {
        await removeRunDir(runDir);
      }
    }
  }

  private buildExecutionCommand(command: string, entryFilename: string): { executable: string; args: string[] } {
    if (process.platform !== "linux") {
      return {
        executable: command,
        args: [entryFilename],
      };
    }

    const memoryKb = this.maxMemoryMb * 1024;
    const fileBlocks = Math.ceil(this.maxFileKb * 2);
    const shellScript = [
      "umask 077",
      `ulimit -t ${this.cpuTimeSec}`,
      `ulimit -v ${memoryKb}`,
      `ulimit -f ${fileBlocks}`,
      `ulimit -u ${this.maxProcesses}`,
      `ulimit -n ${this.maxOpenFiles}`,
      `exec ${shellQuote(command)} ${shellQuote(entryFilename)}`,
    ].join("; ");

    return {
      executable: "/bin/sh",
      args: ["-lc", shellScript],
    };
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildExecutionSummary(
  language: CodeLanguage,
  ok: boolean,
  exitCode: number,
  timedOut: boolean,
  artifactCount: number,
): string {
  const languageLabel = language === "python" ? "Python" : "TypeScript";
  const status = timedOut ? "执行超时" : ok ? "执行成功" : "执行失败";
  return `${languageLabel} ${status}，退出码 ${exitCode}，生成 ${artifactCount} 个产物`;
}
