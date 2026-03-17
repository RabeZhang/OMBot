import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HostEnvironmentCollector } from "../../src/host/collector";
import { HostProfileManager, readHostEnvironmentSnapshot, readHostProfileMarkdown } from "../../src/host/files";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-host-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("HostProfileManager", () => {
  it("refreshes and writes both snapshot json and host profile markdown", async () => {
    const root = await createTempDir();
    const jsonPath = path.join(root, "data/host/environment.json");
    const workspaceProfilePath = path.join(root, "workspace/HOST_PROFILE.md");

    const collector = new HostEnvironmentCollector({
      executionMode: "host",
      workspaceDir: path.join(root, "workspace"),
      dataDir: path.join(root, "data"),
      platform: "darwin",
      arch: "arm64",
      kernelRelease: "24.6.0",
      hostname: "local-dev",
      userInfo: {
        username: "zhangliang",
        homedir: "/Users/zhangliang",
      },
      env: {
        TERM_PROGRAM: "iTerm.app",
        SHELL: "/bin/zsh",
      },
      pathExists: async (targetPath) => {
        return new Set([
          "/Users/zhangliang/Desktop",
          "/Users/zhangliang/Downloads",
          "/Users/zhangliang/Documents",
          path.join(root, "workspace"),
          path.join(root, "data"),
        ]).has(targetPath);
      },
      readFile: async () => {
        throw new Error("unexpected read");
      },
      exec: async (file, args = []) => {
        if (file === "sw_vers") {
          return {
            stdout: "ProductName:\tmacOS\nProductVersion:\t15.6.1\nBuildVersion:\t24G90\n",
            stderr: "",
          };
        }

        if (file === "sh") {
          const name = (args[1] ?? "").replace("command -v ", "").trim();
          if (name === "node") {
            return { stdout: "/opt/homebrew/bin/node\n", stderr: "" };
          }
          if (name === "git") {
            return { stdout: "/usr/bin/git\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        }

        throw new Error(`unexpected exec: ${file}`);
      },
    });

    const manager = new HostProfileManager({
      collector,
      paths: {
        jsonPath,
        workspaceProfilePath,
      },
    });

    const snapshot = await manager.refresh();
    const storedSnapshot = await readHostEnvironmentSnapshot(jsonPath);
    const markdown = await readHostProfileMarkdown(workspaceProfilePath);

    expect(snapshot.platform.osFamily).toBe("macos");
    expect(storedSnapshot?.platform.version).toBe("15.6.1");
    expect(markdown).toContain("# Host Profile");
    expect(markdown).toContain("OS: macOS 15.6.1");
    expect(markdown).toContain("Architecture: arm64");
    expect(markdown).toContain("node: yes");
  });
});
