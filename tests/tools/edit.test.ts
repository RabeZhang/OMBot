import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFile, unlink, mkdir, rmdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createEditTool } from "../../src/tools/local/edit";

describe("edit tool with pi-mom", () => {
	const editTool = createEditTool(process.cwd());
	const testDir = join(tmpdir(), "ombot-edit-test-" + Date.now());

	beforeAll(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterAll(async () => {
		// 清理测试文件
		try {
			const files = ["config.txt", "nginx.conf", "multi.txt", "empty.txt"];
			for (const file of files) {
				try {
					await unlink(join(testDir, file));
				} catch { /* ignore */ }
			}
			await rmdir(testDir);
		} catch { /* ignore */ }
	});

	it("successfully edits a file with exact text match", async () => {
		const originalContent = "server_name localhost;\nlisten 80;\nroot /var/www;";
		const testFile = join(testDir, "config.txt");
		await writeFile(testFile, originalContent, "utf-8");

		const result = await editTool.execute(
			"test-edit-1",
			{
				path: testFile,
				oldText: "listen 80;",
				newText: "listen 8080;",
			},
			undefined,
		);

		// 验证返回内容
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain("Successfully replaced text");

		// 验证文件实际被修改
		const newContent = await readFile(testFile, "utf-8");
		expect(newContent).toContain("listen 8080;");
		expect(newContent).not.toContain("listen 80;");
		expect(newContent).toContain("server_name localhost;");
	});

	it("rejects when oldText is not found", async () => {
		const content = "foo = bar\nbaz = qux";
		const testFile = join(testDir, "config.txt");
		await writeFile(testFile, content, "utf-8");

		await expect(
			editTool.execute(
				"test-edit-2",
				{
					path: testFile,
					oldText: "nonexistent_text",
					newText: "replacement",
				},
				undefined,
			),
		).rejects.toThrow("Could not find the exact text");
	});

	it("rejects when oldText appears multiple times", async () => {
		// oldText "value = " 出现了 3 次
		const content = "value = 1\nvalue = 2\nvalue = 3";
		const testFile = join(testDir, "multi.txt");
		await writeFile(testFile, content, "utf-8");

		await expect(
			editTool.execute(
				"test-edit-3",
				{
					path: testFile,
					oldText: "value = ", // 这个在文件中出现了 3 次
					newText: "new_value = ",
				},
				undefined,
			),
		).rejects.toThrow("Found 3 occurrences");
	});

	it("rejects when replacement produces identical content", async () => {
		const content = "unique_setting = value";
		const testFile = join(testDir, "config.txt");
		await writeFile(testFile, content, "utf-8");

		await expect(
			editTool.execute(
				"test-edit-4",
				{
					path: testFile,
					oldText: "unique_setting = value",
					newText: "unique_setting = value",
				},
				undefined,
			),
		).rejects.toThrow("No changes made");
	});

	it("successfully edits nginx config file", async () => {
		const nginxConfig = `server {
    listen 80;
    server_name example.com;
    location / {
        proxy_pass http://localhost:3000;
    }
}`;
		const testFile = join(testDir, "nginx.conf");
		await writeFile(testFile, nginxConfig, "utf-8");

		const result = await editTool.execute(
			"test-edit-5",
			{
				path: testFile,
				oldText: "proxy_pass http://localhost:3000;",
				newText: "proxy_pass http://localhost:8080;",
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully replaced text");

		const newContent = await readFile(testFile, "utf-8");
		expect(newContent).toContain("proxy_pass http://localhost:8080;");
	});

	it("preserves whitespace when editing", async () => {
		// 测试带缩进的配置文件编辑
		const content = "    listen 80;\n    server_name localhost;";
		const testFile = join(testDir, "config.txt");
		await writeFile(testFile, content, "utf-8");

		// 使用包含缩进的完整文本来匹配
		const result = await editTool.execute(
			"test-edit-7",
			{
				path: testFile,
				oldText: "    listen 80;",  // 包含4个前导空格
				newText: "    listen 8080;",
			},
			undefined,
		);

		expect(result.content[0].text).toContain("Successfully replaced text");

		// 验证文件内容保留了其他行的缩进
		const newContent = await readFile(testFile, "utf-8");
		expect(newContent).toContain("    server_name localhost;");  // 未修改的行保留缩进
		expect(newContent).toContain("    listen 8080;");  // 新内容也保留缩进
	});

	it("returns diff in details", async () => {
		const content = "setting = old_value\nother = data";
		const testFile = join(testDir, "config.txt");
		await writeFile(testFile, content, "utf-8");

		const result = await editTool.execute(
			"test-edit-8",
			{
				path: testFile,
				oldText: "setting = old_value",
				newText: "setting = new_value",
			},
			undefined,
		);

		// 验证返回了 diff 详情
		expect(result.details).toBeDefined();
		expect(result.details?.diff).toBeDefined();
	});

	it("rejects non-existent file", async () => {
		await expect(
			editTool.execute(
				"test-edit-9",
				{
					path: "/nonexistent/path/file.txt",
					oldText: "foo",
					newText: "bar",
				},
				undefined,
			),
		).rejects.toThrow();
	});

	it("supports AbortSignal for cancellation", async () => {
		const content = "test = value";
		const testFile = join(testDir, "config.txt");
		await writeFile(testFile, content, "utf-8");

		const controller = new AbortController();
		controller.abort();  // 立即取消

		await expect(
			editTool.execute(
				"test-edit-10",
				{
					path: testFile,
					oldText: "test = value",
					newText: "test = new_value",
				},
				controller.signal,
			),
		).rejects.toThrow();
	});
});
