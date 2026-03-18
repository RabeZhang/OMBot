import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

import type { CodeExecutionGateway } from "../../code-execution/gateway";
import type { CodeLanguage } from "../../code-execution/types";

interface CodeExecutionToolsOptions {
  gateway: CodeExecutionGateway;
  timeoutSec: number;
}

function asTextResult(details: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

const codeExecutionParameters = Type.Object({
  language: Type.Union([
    Type.Literal("python"),
    Type.Literal("typescript"),
    Type.Literal("ts"),
  ]),
  code: Type.String({ minLength: 1 }),
  files: Type.Optional(Type.Array(Type.Object({
    path: Type.String({ minLength: 1 }),
    content: Type.String(),
  }))),
  timeoutSec: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
});

function normalizeLanguage(value: string): CodeLanguage {
  return value === "ts" ? "typescript" : value as CodeLanguage;
}

export function createCodeRunTool(options: CodeExecutionToolsOptions): AgentTool {
  return {
    name: "code_run",
    label: "运行代码",
    description:
      "在受控执行环境中运行 Python 或 TypeScript 代码。" +
      "适用于数据处理、文本解析、报告生成和小型脚本任务。",
    parameters: codeExecutionParameters,
    async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const input = params as {
        language: "python" | "typescript" | "ts";
        code: string;
        files?: Array<{ path: string; content: string }>;
        timeoutSec?: number;
      };

      const result = await options.gateway.execute({
        language: normalizeLanguage(input.language),
        code: input.code,
        files: input.files,
        timeoutSec: input.timeoutSec ?? options.timeoutSec,
      });

      return asTextResult(result);
    },
  };
}
