import net from "node:net";

import { z } from "zod";

import type { OmbotToolDefinition } from "../types";

export interface PortStatusInput {
  host?: string;
  port: number;
  timeoutMs?: number;
}

export interface PortStatusResult {
  host: string;
  port: number;
  open: boolean;
  timeoutMs: number;
  error?: string;
}

export interface HttpEndpointInput {
  url: string;
  method?: "GET" | "HEAD";
  timeoutMs?: number;
}

export interface HttpEndpointResult {
  url: string;
  method: "GET" | "HEAD";
  ok: boolean;
  status: number;
  statusCode: number;
  statusText: string;
  responseTimeMs: number;
}

const portStatusInputSchema = z.object({
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535),
  timeoutMs: z.number().int().positive().optional(),
});

const httpEndpointInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "HEAD"]).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

function probePort(input: Required<PortStatusInput>): Promise<PortStatusResult> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const finish = (result: PortStatusResult) => {
      if (resolved) {
        return;
      }
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(input.timeoutMs);

    socket.once("connect", () => {
      finish({
        host: input.host,
        port: input.port,
        open: true,
        timeoutMs: input.timeoutMs,
      });
    });

    socket.once("timeout", () => {
      finish({
        host: input.host,
        port: input.port,
        open: false,
        timeoutMs: input.timeoutMs,
        error: "timeout",
      });
    });

    socket.once("error", (error) => {
      finish({
        host: input.host,
        port: input.port,
        open: false,
        timeoutMs: input.timeoutMs,
        error: error.message,
      });
    });

    socket.connect(input.port, input.host);
  });
}

export const getPortStatusTool: OmbotToolDefinition<PortStatusInput, PortStatusResult> = {
  name: "get_port_status",
  description: "检查指定主机端口是否可连接",
  riskLevel: "readonly",
  parametersSchema: portStatusInputSchema,
  async execute(input) {
    const normalized: Required<PortStatusInput> = {
      host: input.host ?? "127.0.0.1",
      port: input.port,
      timeoutMs: input.timeoutMs ?? 1000,
    };

    return probePort(normalized);
  },
};

export const checkHttpEndpointTool: OmbotToolDefinition<HttpEndpointInput, HttpEndpointResult> = {
  name: "check_http_endpoint",
  description: "发起 HTTP/HTTPS 健康检查请求",
  riskLevel: "readonly",
  parametersSchema: httpEndpointInputSchema,
  async execute(input) {
    const method = input.method ?? "GET";
    const start = Date.now();
    const response = await fetch(input.url, {
      method,
      signal: AbortSignal.timeout(input.timeoutMs ?? 3000),
    });
    const responseTimeMs = Date.now() - start;

    return {
      url: input.url,
      method,
      ok: response.ok,
      status: response.status,
      statusCode: response.status,
      statusText: response.statusText,
      responseTimeMs,
    };
  },
};
