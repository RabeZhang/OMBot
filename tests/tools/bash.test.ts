import { describe, expect, it } from "vitest";

import { createBashTool } from "../../src/tools/local/bash";

describe("bash tool with pi-mom", () => {
  const bashTool = createBashTool(process.cwd());

  it("executes a simple echo command", async () => {
    const result = await bashTool.execute(
      "test-call-1",
      { command: "echo 'hello world'" },
      undefined,
    );

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("hello world");
  });

  it("captures stdout and stderr", async () => {
    const result = await bashTool.execute(
      "test-call-2",
      { command: "echo 'stdout content' && echo 'stderr content' >&2" },
      undefined,
    );

    const text = result.content[0].text as string;
    expect(text).toContain("stdout content");
    expect(text).toContain("stderr content");
  });

  it("returns non-zero exit code as error", async () => {
    await expect(
      bashTool.execute(
        "test-call-3",
        { command: "exit 42" },
        undefined,
      ),
    ).rejects.toThrow("42");
  });

  it("respects timeout parameter", async () => {
    await expect(
      bashTool.execute(
        "test-call-4",
        { command: "sleep 5", timeout: 1 },
        undefined,
      ),
    ).rejects.toThrow();
  }, 10000);

  it("handles large output truncation", async () => {
    // Generate output larger than 50KB
    const result = await bashTool.execute(
      "test-call-5",
      { command: "yes 'line content' | head -n 3000" },
      undefined,
    );

    const text = result.content[0].text as string;
    // Should be truncated (pi-mom uses "Showing lines" format, not "...")
    expect(text.length).toBeLessThan(60 * 1024);
    // Should indicate truncation with pi-mom format
    expect(text).toContain("Showing lines");
    expect(text).toContain("Full output:");
  });

  it("handles command with special characters", async () => {
    const result = await bashTool.execute(
      "test-call-6",
      { command: "echo 'special chars: $HOME \"quoted\" $(echo nested)'" },
      undefined,
    );

    expect(result.content[0].text).toContain("special chars:");
  });

  it("returns '(no output)' for empty output", async () => {
    const result = await bashTool.execute(
      "test-call-7",
      { command: "true" },  // true 命令无输出
      undefined,
    );

    expect(result.content[0].text).toBe("(no output)");
  });

  it("supports AbortSignal for cancellation", async () => {
    const controller = new AbortController();

    // Start a long-running command
    const promise = bashTool.execute(
      "test-call-8",
      { command: "sleep 10" },
      controller.signal,
    );

    // Cancel immediately
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it("executes pwd to verify working directory context", async () => {
    const result = await bashTool.execute(
      "test-call-9",
      { command: "pwd" },
      undefined,
    );

    const text = result.content[0].text as string;
    // Should return a valid absolute path
    expect(text.trim()).toMatch(/^\/[\s\S]+/);
  });
});
