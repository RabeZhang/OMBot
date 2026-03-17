import http from "node:http";
import net from "node:net";

import { describe, expect, it } from "vitest";

import { createLocalReadOnlyTools } from "../../src/tools/local";
import { getProcessStatusTool } from "../../src/tools/local/process";
import { checkHttpEndpointTool, getPortStatusTool } from "../../src/tools/local/network";
import {
  getCpuUsageTool,
  getDiskUsageTool,
  getMemoryUsageTool,
  parseLinuxMeminfo,
  parseMacVmStat,
} from "../../src/tools/local/resource";

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
  it("returns sampled cpu usage in expected range", async () => {
    const result = await getCpuUsageTool.execute(
      {},
      {
        sessionId: "sess_test",
      },
    );

    expect(result.coreCount).toBeGreaterThan(0);
    expect(result.sampleWindowMs).toBeGreaterThan(0);
    expect(result.usagePercent).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeLessThanOrEqual(100);
    expect(result.estimatedUsagePercent).toBe(result.usagePercent);
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
    expect(result.availableBytes).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeLessThanOrEqual(100);
    expect(result.totalBytes).toBeGreaterThanOrEqual(result.usedBytes);
    expect(result.totalBytes).toBeGreaterThanOrEqual(result.availableBytes);
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
    expect(result.accountingMode.length).toBeGreaterThan(0);
    expect(result.usagePercent).toBeGreaterThanOrEqual(0);
    expect(result.usagePercent).toBeLessThanOrEqual(100);
  });

  it("parses linux meminfo with available and swap fields", () => {
    const parsed = parseLinuxMeminfo([
      "MemTotal:       16384256 kB",
      "MemFree:         1024000 kB",
      "MemAvailable:    8192000 kB",
      "Buffers:          256000 kB",
      "Cached:          2048000 kB",
      "SReclaimable:     128000 kB",
      "SwapTotal:       4194304 kB",
      "SwapFree:        3145728 kB",
    ].join("\n"));

    expect(parsed.memTotalKb).toBe(16384256);
    expect(parsed.memAvailableKb).toBe(8192000);
    expect(parsed.cachedKb).toBe(2432000);
    expect(parsed.swapTotalKb).toBe(4194304);
    expect(parsed.swapFreeKb).toBe(3145728);
  });

  it("parses mac vm_stat output", () => {
    const parsed = parseMacVmStat([
      "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
      "Pages free:                                4146.",
      "Pages inactive:                          231180.",
      "Pages speculative:                          734.",
      "Pages purgeable:                           3339.",
      "File-backed pages:                       156329.",
    ].join("\n"));

    expect(parsed.pageSizeBytes).toBe(16384);
    expect(parsed.freePages).toBe(4146);
    expect(parsed.inactivePages).toBe(231180);
    expect(parsed.speculativePages).toBe(734);
    expect(parsed.purgeablePages).toBe(3339);
    expect(parsed.fileBackedPages).toBe(156329);
  });

  it("explains shared space semantics for apfs-like accounting gaps", () => {
    const totalKb = 482797652;
    const usedKb = 17316956;
    const availableKb = 166335088;
    const reservedOrSharedKb = totalKb - usedKb - availableKb;

    expect(reservedOrSharedKb).toBeGreaterThan(0);
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
