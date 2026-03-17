import path from "node:path";

import { describe, expect, it } from "vitest";

import { HostEnvironmentCollector } from "../../src/host/collector";

describe("HostEnvironmentCollector", () => {
  it("collects linux host facts from injected sources", async () => {
    const collector = new HostEnvironmentCollector({
      executionMode: "host",
      workspaceDir: "/workspace",
      dataDir: "/workspace/data",
      platform: "linux",
      arch: "x86_64",
      kernelRelease: "6.8.0",
      hostname: "ops-box",
      userInfo: {
        username: "alice",
        homedir: "/home/alice",
      },
      env: {
        DISPLAY: ":0",
        XDG_SESSION_TYPE: "x11",
        TERM_PROGRAM: "gnome-terminal",
        SHELL: "/bin/bash",
      },
      pathExists: async (targetPath) => {
        return new Set([
          "/home/alice/Desktop",
          "/home/alice/Downloads",
          "/workspace",
          "/workspace/data",
          "/.dockerenv",
        ]).has(targetPath);
      },
      readFile: async (targetPath) => {
        if (targetPath === "/etc/os-release") {
          return 'NAME="Ubuntu"\nVERSION="24.04.1 LTS (Noble Numbat)"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n';
        }
        if (targetPath === "/proc/1/cgroup") {
          return "0::/docker/123456";
        }
        throw new Error(`unexpected file read: ${targetPath}`);
      },
      exec: async (file, args = []) => {
        if (file !== "sh") {
          throw new Error(`unexpected exec: ${file}`);
        }

        const command = args[1] ?? "";
        const resolved = new Map<string, string>([
          ["python3", "/usr/bin/python3"],
          ["node", "/usr/bin/node"],
          ["npm", "/usr/bin/npm"],
          ["git", "/usr/bin/git"],
          ["bash", "/usr/bin/bash"],
          ["sh", "/usr/bin/sh"],
        ]);

        const name = command.replace("command -v ", "").trim();
        return {
          stdout: resolved.get(name) ? `${resolved.get(name)}\n` : "",
          stderr: "",
        };
      },
    });

    const snapshot = await collector.collect();

    expect(snapshot.platform.osFamily).toBe("linux");
    expect(snapshot.platform.distribution).toBe("Ubuntu 24.04.1 LTS");
    expect(snapshot.platform.version).toBe("24.04");
    expect(snapshot.platform.architecture).toBe("x86_64");
    expect(snapshot.runtime.insideDocker).toBe(true);
    expect(snapshot.runtime.gui.available).toBe(true);
    expect(snapshot.runtime.gui.sessionType).toBe("x11");
    expect(snapshot.user.username).toBe("alice");
    expect(snapshot.paths.desktop.path).toBe(path.join("/home/alice", "Desktop"));
    expect(snapshot.paths.documents.exists).toBe(false);
    expect(snapshot.capabilities.python3?.available).toBe(true);
    expect(snapshot.capabilities.docker?.available).toBe(false);
  });
});
