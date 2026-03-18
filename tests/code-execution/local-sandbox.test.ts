import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalSandboxBackend } from "../../src/code-execution/backends/local-sandbox";
import { CodeExecutionGateway } from "../../src/code-execution/gateway";

const tempDirs: string[] = [];

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-code-"));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("LocalSandboxBackend", () => {
  it("runs python code in an isolated run directory", async () => {
    const root = await createTempRoot();
    const backend = new LocalSandboxBackend({
      workdirRoot: root,
      pythonBin: "python3",
      tsRunner: "tsx",
      timeoutSec: 5,
      networkEnabled: false,
      cpuTimeSec: 5,
      maxMemoryMb: 256,
      maxFileKb: 1024,
      maxProcesses: 16,
      maxOpenFiles: 32,
      execFileImpl: async (_file, _args, options) => {
        const files = await fs.readdir(options.cwd);
        return {
          stdout: JSON.stringify({
            cwd: options.cwd,
            files: files.sort(),
            network: options.env.OMBOT_SANDBOX_NETWORK,
            home: options.env.HOME,
            tmp: options.env.TMPDIR,
          }),
          stderr: "",
        };
      },
    });

    const result = await backend.run({
      language: "python",
      code: "print('hello')",
      files: [{ path: "input/data.txt", content: "demo" }],
    });

    expect(result.ok).toBe(true);
    expect(result.language).toBe("python");
    expect(result.backend).toBe("local_sandbox");
    expect(result.isolationLevel).toBe("lightweight");
    expect(result.summary).toContain("Python 执行成功");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.files).toContain("__entry__.py");
    expect(parsed.files).toContain("input");
    expect(parsed.network).toBe("disabled");
    expect(parsed.home).toContain(".home");
    expect(parsed.tmp).toContain(".tmp");
  });

  it("returns generated artifacts and preserves failure output", async () => {
    const root = await createTempRoot();
    const backend = new LocalSandboxBackend({
      workdirRoot: root,
      pythonBin: "python3",
      tsRunner: "tsx",
      timeoutSec: 5,
      networkEnabled: false,
      cpuTimeSec: 5,
      maxMemoryMb: 256,
      maxFileKb: 1024,
      maxProcesses: 16,
      maxOpenFiles: 32,
      execFileImpl: async (_file, _args, options) => {
        await fs.writeFile(path.join(options.cwd, "report.txt"), "artifact", "utf8");
        const error = new Error("failed") as Error & { stdout?: string; stderr?: string; code?: number };
        error.stdout = "partial";
        error.stderr = "traceback";
        error.code = 2;
        throw error;
      },
    });

    const result = await backend.run({
      language: "typescript",
      code: "console.log('hi')",
    });

    expect(result.ok).toBe(false);
    expect(result.language).toBe("typescript");
    expect(result.isolationLevel).toBe("lightweight");
    expect(result.summary).toContain("TypeScript 执行失败");
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("partial");
    expect(result.stderr).toContain("traceback");
    expect(result.artifacts).toEqual([{ path: "report.txt", sizeBytes: 8 }]);
  });

  it("rejects absolute and parent-traversal input file paths", async () => {
    const root = await createTempRoot();
    const backend = new LocalSandboxBackend({
      workdirRoot: root,
      pythonBin: "python3",
      tsRunner: "tsx",
      timeoutSec: 5,
      networkEnabled: false,
      cpuTimeSec: 5,
      maxMemoryMb: 256,
      maxFileKb: 1024,
      maxProcesses: 16,
      maxOpenFiles: 32,
      execFileImpl: async () => ({ stdout: "", stderr: "" }),
    });

    const result = await backend.run({
      language: "python",
      code: "print('hello')",
      files: [{ path: "../outside.txt", content: "x" }],
    });

    expect(result.ok).toBe(false);
    expect(result.language).toBe("python");
    expect(result.summary).toContain("Python 执行失败");
    expect(result.stderr).toContain("Invalid sandbox input file path");
    expect(result.artifacts).toEqual([]);
  });

  it("does not expose sandbox internal directories as artifacts", async () => {
    const root = await createTempRoot();
    const backend = new LocalSandboxBackend({
      workdirRoot: root,
      pythonBin: "python3",
      tsRunner: "tsx",
      timeoutSec: 5,
      networkEnabled: false,
      cpuTimeSec: 5,
      maxMemoryMb: 256,
      maxFileKb: 1024,
      maxProcesses: 16,
      maxOpenFiles: 32,
      execFileImpl: async (_file, _args, options) => {
        await fs.writeFile(path.join(options.cwd, ".home", "secret.txt"), "hidden", "utf8");
        await fs.writeFile(path.join(options.cwd, ".tmp", "cache.txt"), "tmp", "utf8");
        await fs.writeFile(path.join(options.cwd, "visible.txt"), "ok", "utf8");
        return { stdout: "", stderr: "" };
      },
    });

    const result = await backend.run({
      language: "python",
      code: "print('hello')",
    });

    expect(result.artifacts).toEqual([{ path: "visible.txt", sizeBytes: 2 }]);
  });
});

describe("CodeExecutionGateway", () => {
  it("delegates to the configured backend", async () => {
    const gateway = new CodeExecutionGateway({
      backend: {
        kind: "local_sandbox",
        async run(request) {
          return {
            ok: true,
            language: request.language,
            backend: "local_sandbox",
            isolationLevel: "lightweight",
            summary: "Python 执行成功，退出码 0，生成 0 个产物",
            exitCode: 0,
            stdout: request.code,
            stderr: "",
            timedOut: false,
            artifacts: [],
          };
        },
      },
    });

    const result = await gateway.execute({
      language: "python",
      code: "print('x')",
    });

    expect(result.stdout).toBe("print('x')");
    expect(result.language).toBe("python");
    expect(result.summary).toContain("执行成功");
    expect(result.backend).toBe("local_sandbox");
  });
});
