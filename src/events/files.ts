import fs from "node:fs/promises";
import path from "node:path";

export interface EventFileSummary {
  filename: string;
  size: number;
  updatedAt: string;
}

export async function ensureEventsDir(eventsDir: string): Promise<void> {
  await fs.mkdir(eventsDir, { recursive: true });
}

export async function listEventFiles(eventsDir: string): Promise<EventFileSummary[]> {
  await ensureEventsDir(eventsDir);
  const entries = await fs.readdir(eventsDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const fullPath = path.join(eventsDir, entry.name);
        const stat = await fs.stat(fullPath);
        return {
          filename: entry.name,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      }),
  );

  return files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readEventFile(eventsDir: string, filename: string): Promise<string> {
  return fs.readFile(path.join(eventsDir, sanitizeFilename(filename)), "utf8");
}

export async function deleteEventFile(eventsDir: string, filename: string): Promise<void> {
  await fs.unlink(path.join(eventsDir, sanitizeFilename(filename)));
}

export async function createImmediateEventFile(
  eventsDir: string,
  input: {
    text: string;
    title?: string;
    sessionId?: string;
    profile?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<string> {
  await ensureEventsDir(eventsDir);
  const filename = `${makeTimestampPrefix()}-immediate.json`;
  const payload = {
    type: "immediate",
    text: input.text,
    ...(input.title ? { title: input.title } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };

  await fs.writeFile(path.join(eventsDir, filename), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filename;
}

function makeTimestampPrefix(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFilename(filename: string): string {
  return path.basename(filename);
}
