import fs from "node:fs/promises";
import path from "node:path";

import type { CodeExecutionArtifact, CodeExecutionInputFile, CodeLanguage } from "./types";

const RESERVED_DIRECTORIES = new Set([".home", ".tmp"]);

export async function createRunDir(rootDir: string, runId: string): Promise<string> {
  const runDir = path.join(rootDir, "runs", runId);
  await fs.mkdir(runDir, { recursive: true });
  return runDir;
}

export async function writeInputFiles(runDir: string, files: CodeExecutionInputFile[] = []): Promise<string[]> {
  const writtenPaths: string[] = [];

  for (const file of files) {
    const normalized = validateInputFilePath(file.path);
    const targetPath = path.join(runDir, normalized);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, file.content, "utf8");
    writtenPaths.push(path.relative(runDir, targetPath));
  }

  return writtenPaths.sort();
}

export async function writeEntryFile(runDir: string, language: CodeLanguage, code: string): Promise<string> {
  const entryFilename = language === "python" ? "__entry__.py" : "__entry__.ts";
  const entryPath = path.join(runDir, entryFilename);
  await fs.writeFile(entryPath, code, "utf8");
  return entryPath;
}

export async function collectArtifacts(
  runDir: string,
  excludedRelativePaths: string[],
): Promise<CodeExecutionArtifact[]> {
  const excluded = new Set(excludedRelativePaths.map((value) => path.normalize(value)));
  const artifacts: CodeExecutionArtifact[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(runDir, absolutePath);
      if (entry.isDirectory()) {
        if (RESERVED_DIRECTORIES.has(entry.name) && currentDir === runDir) {
          continue;
        }
        await walk(absolutePath);
        continue;
      }

      if (excluded.has(path.normalize(relativePath))) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      artifacts.push({
        path: relativePath,
        sizeBytes: stat.size,
      });
    }
  }

  await walk(runDir);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

export async function removeRunDir(runDir: string): Promise<void> {
  await fs.rm(runDir, { recursive: true, force: true });
}

function validateInputFilePath(filePath: string): string {
  if (filePath.includes("\0")) {
    throw new Error(`Invalid sandbox input file path: ${filePath}`);
  }

  const normalized = path.normalize(filePath);
  if (!normalized || normalized === "." || path.isAbsolute(normalized)) {
    throw new Error(`Invalid sandbox input file path: ${filePath}`);
  }

  const segments = normalized.split(path.sep).filter((segment) => segment.length > 0);
  if (segments.length === 0 || segments.includes("..")) {
    throw new Error(`Invalid sandbox input file path: ${filePath}`);
  }

  if (RESERVED_DIRECTORIES.has(segments[0] ?? "")) {
    throw new Error(`Sandbox input file path uses reserved directory: ${filePath}`);
  }

  return segments.join(path.sep);
}
