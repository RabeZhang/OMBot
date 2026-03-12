import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFile, unlink, mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createReadTool } from "../../src/tools/local/read";

describe("read tool with pi-mom", () => {
	const readTool = createReadTool(process.cwd());
	const testDir = join(tmpdir(), "ombot-read-test-" + Date.now());

	beforeAll(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		// 清理测试文件
		try {
			const files = ["small.txt", "large.txt", "oneline.txt", "image.png", "empty.txt", "verylarge.txt", "huge.txt"];
			for (const file of files) {
				try {
					await unlink(join(testDir, file));
				} catch { /* ignore */ }
			}
			await rmdir(testDir);
		} catch { /* ignore */ }
	});

	it("reads a small text file", async () => {
		const content = "Hello, World!\nThis is a test file.\nLine 3.";
		const testFile = join(testDir, "small.txt");
		await writeFile(testFile, content, "utf-8");

		const result = await readTool.execute(
			"test-read-1",
			{ path: testFile },
			undefined,
		);

		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("Hello, World!");
		expect(result.content[0].text).toContain("This is a test file.");
	});

	it("reads file with offset and limit", async () => {
		// 创建 20 行的文件
		const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
		const testFile = join(testDir, "large.txt");
		await writeFile(testFile, lines.join("\n"), "utf-8");

		// 读取第 6-10 行（offset=6, limit=5）
		const result = await readTool.execute(
			"test-read-2",
			{ path: testFile, offset: 6, limit: 5 },
			undefined,
		);

		const text = result.content[0].text as string;
		expect(text).toContain("Line 6");
		expect(text).toContain("Line 10");
		expect(text).not.toContain("Line 5");
		expect(text).not.toContain("Line 11");
	});

	it("handles offset beyond file length", async () => {
		const content = "Line 1\nLine 2\nLine 3";
		const testFile = join(testDir, "small.txt");
		await writeFile(testFile, content, "utf-8");

		await expect(
			readTool.execute(
				"test-read-3",
				{ path: testFile, offset: 100 },
				undefined,
			),
		).rejects.toThrow("beyond end of file");
	});

	it("reads a single line file", async () => {
		const testFile = join(testDir, "oneline.txt");
		await writeFile(testFile, "Only one line", "utf-8");

		const result = await readTool.execute(
			"test-read-4",
			{ path: testFile },
			undefined,
		);

		expect(result.content[0].text).toContain("Only one line");
	});

	it("handles empty file", async () => {
		const testFile = join(testDir, "empty.txt");
		await writeFile(testFile, "", "utf-8");

		const result = await readTool.execute(
			"test-read-5",
			{ path: testFile },
			undefined,
		);

		expect(result.content[0].text).toBe("");
	});

	it("truncates large files and shows continuation hint", async () => {
		// 创建 5000 行的文件（超过 2000 行限制）
		const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i + 1} with some content to make it longer`);
		const testFile = join(testDir, "verylarge.txt");
		await writeFile(testFile, lines.join("\n"), "utf-8");

		const result = await readTool.execute(
			"test-read-6",
			{ path: testFile },
			undefined,
		);

		const text = result.content[0].text as string;
		// 应该被截断
		expect(text.length).toBeLessThan(100 * 1024);
		// 应该显示截断提示
		expect(text).toContain("Use offset=");
		// 应该显示行号范围
		expect(text).toMatch(/Showing lines \d+-\d+ of 5000/);
	}, 10000);

	it("reads system file /etc/hosts", async () => {
		// 读取系统文件测试
		const result = await readTool.execute(
			"test-read-7",
			{ path: "/etc/hosts" },
			undefined,
		);

		expect(result.content[0].type).toBe("text");
		// /etc/hosts 通常包含 localhost
		const text = result.content[0].text as string;
		expect(text.toLowerCase()).toContain("localhost");
	});

	it("rejects non-existent file", async () => {
		await expect(
			readTool.execute(
				"test-read-8",
				{ path: "/nonexistent/path/file.txt" },
				undefined,
			),
		).rejects.toThrow();
	});

	it("supports AbortSignal for cancellation", async () => {
		const controller = new AbortController();

		// 创建一个较大的文件
		const lines = Array.from({ length: 10000 }, (_, i) => `Line ${i + 1}`);
		const testFile = join(testDir, "huge.txt");
		await writeFile(testFile, lines.join("\n"), "utf-8");

		// 开始读取并立即取消
		const promise = readTool.execute(
			"test-read-9",
			{ path: testFile },
			controller.signal,
		);

		controller.abort();

		await expect(promise).rejects.toThrow();
	}, 5000);

	it("reads image file and returns base64", async () => {
		// 创建一个简单的 PNG 文件头（不是有效的 PNG，但用于测试路径）
		const testFile = join(testDir, "image.png");
		// 写入 PNG 文件头魔术数字
		const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
		await writeFile(testFile, pngHeader);

		const result = await readTool.execute(
			"test-read-10",
			{ path: testFile },
			undefined,
		);

		// 图片返回两个 content：文本说明 + 图片数据
		expect(result.content.length).toBeGreaterThanOrEqual(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("image");
	});
});
