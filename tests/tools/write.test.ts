import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFile, unlink, mkdir, rmdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createWriteTool } from "../../src/tools/local/write";

describe("write tool with pi-mom", () => {
	const writeTool = createWriteTool(process.cwd());
	const testDir = join(tmpdir(), "ombot-write-test-" + Date.now());

	beforeAll(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		// 清理测试文件
		try {
			const files = ["new-file.txt", "overwrite.txt", "special-chars.txt", "multiline.txt", "nested/dir/file.txt"];
			for (const file of files) {
				try {
					await unlink(join(testDir, file));
				} catch { /* ignore */ }
			}
			// 清理嵌套目录
			try {
				await rmdir(join(testDir, "nested/dir"));
				await rmdir(join(testDir, "nested"));
			} catch { /* ignore */ }
			await rmdir(testDir);
		} catch { /* ignore */ }
	});

	it("successfully creates a new file", async () => {
		const testFile = join(testDir, "new-file.txt");
		const content = "Hello, World!";

		const result = await writeTool.execute(
			"test-write-1",
			{
				label: "Create test file",
				path: testFile,
				content: content,
			},
			undefined,
		);

		// 验证返回内容
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("Successfully wrote");
		expect(result.content[0].text).toContain("bytes");

		// 验证文件实际被创建
		const fileContent = await readFile(testFile, "utf-8");
		expect(fileContent).toBe(content);
	});

	it("successfully overwrites an existing file", async () => {
		const testFile = join(testDir, "overwrite.txt");
		const originalContent = "Original content";
		const newContent = "New replacement content";

		// 先创建原始文件
		await writeFile(testFile, originalContent, "utf-8");

		const result = await writeTool.execute(
			"test-write-2",
			{
				label: "Overwrite test file",
				path: testFile,
				content: newContent,
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully wrote");

		// 验证文件内容已被替换
		const fileContent = await readFile(testFile, "utf-8");
		expect(fileContent).toBe(newContent);
		expect(fileContent).not.toBe(originalContent);
	});

	it("automatically creates parent directories", async () => {
		const testFile = join(testDir, "nested/dir/file.txt");
		const content = "File in nested directory";

		const result = await writeTool.execute(
			"test-write-3",
			{
				label: "Create nested file",
				path: testFile,
				content: content,
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully wrote");

		// 验证文件被创建在嵌套目录中
		const fileContent = await readFile(testFile, "utf-8");
		expect(fileContent).toBe(content);
	});

	it("handles special characters in content", async () => {
		const testFile = join(testDir, "special-chars.txt");
		const content = "Special chars: $HOME `command` \"quotes\" 'single' \\backslash\nNewline\tTab";

		const result = await writeTool.execute(
			"test-write-4",
			{
				label: "Write special characters",
				path: testFile,
				content: content,
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully wrote");

		const fileContent = await readFile(testFile, "utf-8");
		expect(fileContent).toBe(content);
	});

	it("handles multiline content", async () => {
		const testFile = join(testDir, "multiline.txt");
		const content = `Line 1
Line 2
Line 3
  Indented line
Last line`;

		const result = await writeTool.execute(
			"test-write-5",
			{
				label: "Write multiline content",
				path: testFile,
				content: content,
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully wrote");

		const fileContent = await readFile(testFile, "utf-8");
		expect(fileContent).toBe(content);
	});

	it("returns correct byte count", async () => {
		const testFile = join(testDir, "byte-count.txt");
		const content = "Hello, 世界!"; // 包含 UTF-8 字符

		const result = await writeTool.execute(
			"test-write-6",
			{
				label: "Write UTF-8 content",
				path: testFile,
				content: content,
			},
			undefined,
		);

		// 验证返回的字节数
		expect(result.content[0].text).toContain(`${content.length} bytes`);
	});

	it("supports AbortSignal for cancellation", async () => {
		const testFile = join(testDir, "cancel.txt");

		const controller = new AbortController();
		controller.abort(); // 立即取消

		await expect(
			writeTool.execute(
				"test-write-7",
				{
					label: "Cancelled write",
					path: testFile,
					content: "This should not be written",
				},
				controller.signal,
			),
		).rejects.toThrow();
	});

	it("writes empty content", async () => {
		const testFile = join(testDir, "empty.txt");
		const content = "";

		const result = await writeTool.execute(
			"test-write-8",
			{
				label: "Write empty file",
				path: testFile,
				content: content,
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully wrote");
		expect(result.content[0].text).toContain("0 bytes");

		const fileContent = await readFile(testFile, "utf-8");
		expect(fileContent).toBe(content);
	});
});
