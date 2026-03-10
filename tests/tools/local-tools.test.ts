import http from "node:http";
import net from "node:net";

import { describe, expect, it } from "vitest";

import { createLocalReadOnlyTools } from "../../src/tools/local";
import { getProcessStatusTool } from "../../src/tools/local/process";
import { checkHttpEndpointTool, getPortStatusTool } from "../../src/tools/local/network";
import { getCpuUsageTool, getDiskUsageTool, getMemoryUsageTool } from "../../src/tools/local/resource";

describe("local readonly tools", () => {
  it("exports the first batch of local readonly tools", () => {
    const tools = createLocalReadOnlyTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual([
      "get_process_status",
      "get_cpu_usage",
      "get_memory_usage",
      "get_disk_usage",
      "get_port_status",
      "check_http_endpoint",
    ]);
  });
});

describe("getProcessStatusTool", () => {
  it("finds the current process by pid", async () => {
    const result = await getProcessStatusTool.execute(
      { pid: process.pid },
      {
        sessionId: "sess_test",
      },
    );

    expect(result.running).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some((match) => match.pid === process.pid)).toBe(true);
  });

  it("returns not running for impossible pid", async () => {
    const result = await getProcessStatusTool.execute(
      { pid: 99999999 },
      {
        sessionId: "sess_test",
      },
    );

    expect(result.running).toBe(false);
    expect(result.matches).toEqual([]);
  });
});

describe("resource tools", () => {
  it("returns cpu usage estimate in expected range", async () => {
    const result = await getCpuUsageTool.execute(
      {},
      {
        sessionId: "sess_test",
      },
    );

    expect(result.coreCount).toBeGreaterThan(0);
    expect(result.estimatedUsagePercent).toBeGreaterThanOrEqual(0);
    expect(result.estimatedUsagePercent).toBeLessThanOrEqual(100);
  });

  it("returns memory usage summary", async () => {
    const result = await getMemoryUsageTool.execute(
      {},
      {
        sessionId: "sess_test",
      },
    );

    expect(result.totalBytes).toBeGreaterThan(0);
    expect(result.freeBytes).toBeGreaterThanOrEqual(0);
    expect(result.usedBytes).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeLessThanOrEqual(100);
    expect(result.totalBytes).toBe(result.freeBytes + result.usedBytes);
  });

  it("returns disk usage for current root path", async () => {
    const result = await getDiskUsageTool.execute(
      { path: "/" },
      {
        sessionId: "sess_test",
      },
    );

    expect(result.filesystem.length).toBeGreaterThan(0);
    expect(result.mountPoint.length).toBeGreaterThan(0);
    expect(result.totalKb).toBeGreaterThan(0);
    expect(result.usagePercent).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeLessThanOrEqual(100);
  });
});

describe("network tools", () => {
  it("checks port status against a temporary tcp server", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const result = await getPortStatusTool.execute(
        {
          host: "127.0.0.1",
          port,
          timeoutMs: 1000,
        },
        {
          sessionId: "sess_test",
        },
      );

      expect(result.open).toBe(true);
      expect(result.port).toBe(port);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("checks http endpoint against a temporary http server", async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const result = await checkHttpEndpointTool.execute(
        {
          url: `http://127.0.0.1:${port}/health`,
          method: "GET",
          timeoutMs: 3000,
        },
        {
          sessionId: "sess_test",
        },
      );

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
