import http from "node:http";
import os from "node:os";

const SERVERS: Record<string, { port: number; createHandler: () => http.RequestListener }> = {
  healthy: {
    port: 9001,
    createHandler: () => createHealthyHandler(),
  },
  slow: {
    port: 9002,
    createHandler: () => createSlowHandler(),
  },
  flaky: {
    port: 9003,
    createHandler: () => createFlakyHandler(),
  },
  leaky: {
    port: 9004,
    createHandler: () => createLeakyHandler(),
  },
  "cpu-stress": {
    port: 9005,
    createHandler: () => createCpuStressHandler(),
  },
};

function createHealthyHandler(): http.RequestListener {
  return (req, res) => {
    const start = Date.now();
    const url = new URL(req.url ?? "/", `http://localhost`);
    
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          service: "healthy-server",
          timestamp: new Date().toISOString(),
          responseTimeMs: Date.now() - start,
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

function createSlowHandler(): http.RequestListener {
  return (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (url.pathname === "/health") {
      const delayMs = 3000 + Math.random() * 2000;
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "slow",
            service: "slow-server",
            timestamp: new Date().toISOString(),
            delayMs,
          }),
        );
      }, delayMs);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

function createFlakyHandler(): http.RequestListener {
  let requestCount = 0;

  return (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    requestCount++;

    if (url.pathname === "/health") {
      const shouldFail = Math.random() > 0.5;
      const statusCode = shouldFail ? 500 : 200;
      const status = shouldFail ? "error" : "ok";

      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status,
          service: "flaky-server",
          requestCount,
          statusCode,
          message: shouldFail ? "Internal server error (simulated)" : "Request succeeded",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === "/stats") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          service: "flaky-server",
          totalRequests: requestCount,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

function createLeakyHandler(): http.RequestListener {
  const leakyArrays: number[][] = [];
  let totalLeakedMb = 0;

  return (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (url.pathname === "/health") {
      const leakMb = 1;
      const newArray = new Array(leakMb * 1024 * 1024).fill(0);
      leakyArrays.push(newArray);
      totalLeakedMb += leakMb;

      const memUsage = process.memoryUsage();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "leaky-server",
          message: `Leaked ${leakMb}MB, total: ${totalLeakedMb}MB`,
          memory: {
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMb: Math.round(memUsage.rss / 1024 / 1024),
            externalMb: Math.round(memUsage.external / 1024 / 1024),
          },
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === "/stats") {
      const memUsage = process.memoryUsage();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          service: "leaky-server",
          totalLeakedMb,
          arraysCount: leakyArrays.length,
          memory: {
            heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
            rssMb: Math.round(memUsage.rss / 1024 / 1024),
          },
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === "/reset") {
      leakyArrays.length = 0;
      totalLeakedMb = 0;
      if (global.gc) {
        global.gc();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "reset", message: "Memory cleared" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

function createCpuStressHandler(): http.RequestListener {
  return (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost`);

    if (url.pathname === "/health") {
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "cpu-stress-server",
          loadAverage: {
            "1m": loadAvg[0].toFixed(2),
            "5m": loadAvg[1].toFixed(2),
            "15m": loadAvg[2].toFixed(2),
          },
          cpuCount,
          estimatedUsagePercent: Math.round((loadAvg[0] / cpuCount) * 100),
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    if (url.pathname === "/stress") {
      const duration = parseInt(url.searchParams.get("duration") ?? "1", 10);
      const intensity = parseInt(url.searchParams.get("intensity") ?? "1", 10);

      const start = Date.now();
      let iterations = 0;

      while (Date.now() - start < duration * 1000) {
        for (let i = 0; i < intensity * 1000000; i++) {
          Math.sqrt(Math.random());
        }
        iterations++;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "stressed",
          service: "cpu-stress-server",
          durationSec: duration,
          intensity,
          iterations,
          message: `CPU stressed for ${duration}s`,
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  };
}

function startServer(name: string, config: { port: number; createHandler: () => http.RequestListener }) {
  const server = http.createServer(config.createHandler());

  server.listen(config.port, () => {
    console.log(`[${name}] Server running at http://localhost:${config.port}`);
  });

  server.on("error", (err) => {
    console.error(`[${name}] Error:`, err);
  });

  return server;
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Starting all test servers...\n");
    for (const [name, config] of Object.entries(SERVERS)) {
      startServer(name, config);
    }
    console.log("\nAll servers started. Press Ctrl+C to stop.\n");
  } else {
    for (const name of args) {
      const config = SERVERS[name];
      if (!config) {
        console.error(`Unknown server: ${name}`);
        console.log(`Available servers: ${Object.keys(SERVERS).join(", ")}`);
        process.exit(1);
      }
      startServer(name, config);
    }
  }
}

main();