import fs from "node:fs/promises";
import path from "node:path";

import { HostEnvironmentCollector } from "./collector";
import { renderHostProfile } from "./render";
import type { HostEnvironmentSnapshot, HostProfilePaths } from "./types";

async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeHostEnvironmentSnapshot(
  jsonPath: string,
  snapshot: HostEnvironmentSnapshot,
): Promise<void> {
  await ensureParentDir(jsonPath);
  await fs.writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

export async function writeHostProfileMarkdown(
  workspaceProfilePath: string,
  snapshot: HostEnvironmentSnapshot,
): Promise<void> {
  await ensureParentDir(workspaceProfilePath);
  await fs.writeFile(workspaceProfilePath, `${renderHostProfile(snapshot)}\n`, "utf8");
}

export async function readHostEnvironmentSnapshot(jsonPath: string): Promise<HostEnvironmentSnapshot | null> {
  try {
    const content = await fs.readFile(jsonPath, "utf8");
    return JSON.parse(content) as HostEnvironmentSnapshot;
  } catch {
    return null;
  }
}

export async function readHostProfileMarkdown(workspaceProfilePath: string): Promise<string | null> {
  try {
    return await fs.readFile(workspaceProfilePath, "utf8");
  } catch {
    return null;
  }
}

export class HostProfileManager {
  private readonly collector: HostEnvironmentCollector;
  private readonly paths: HostProfilePaths;

  constructor(options: { collector: HostEnvironmentCollector; paths: HostProfilePaths }) {
    this.collector = options.collector;
    this.paths = options.paths;
  }

  async refresh(): Promise<HostEnvironmentSnapshot> {
    const snapshot = await this.collector.collect();
    await writeHostEnvironmentSnapshot(this.paths.jsonPath, snapshot);
    await writeHostProfileMarkdown(this.paths.workspaceProfilePath, snapshot);
    return snapshot;
  }

  async readSnapshot(): Promise<HostEnvironmentSnapshot | null> {
    return readHostEnvironmentSnapshot(this.paths.jsonPath);
  }

  async readProfileMarkdown(): Promise<string | null> {
    return readHostProfileMarkdown(this.paths.workspaceProfilePath);
  }
}
