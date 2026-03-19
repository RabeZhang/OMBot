import { z } from "zod";

const durationRegex = /^\d+[smhd]$/;

// Phase 1 先把阈值结构固定下来，后面扩展更多单位时不需要改业务层接口。
const thresholdSchema = z.object({
  operator: z.enum([">", ">=", "<", "<=", "==", "!="]),
  value: z.union([z.number(), z.string()]),
  unit: z.enum(["percent", "ms", "count", "status"]).optional(),
});

const onFailureSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  createIncidentSession: z.boolean(),
});

export const ombotConfigSchema = z
  .object({
    app: z.object({
      name: z.string().min(1),
      env: z.enum(["development", "test", "production"]),
      hostId: z.string().min(1),
    }),
    agent: z
      .object({
        maxContextMessages: z.number().int().positive(),
        autoSummaryThreshold: z.number().int().positive(),
        systemPromptTemplate: z.string().min(1),
        workspaceFiles: z.array(z.string().min(1)).min(1),
      })
      .superRefine((value, ctx) => {
        // 提前把上下文预算关系校验掉，避免运行时才发现摘要阈值配置不合理。
        if (value.autoSummaryThreshold > value.maxContextMessages) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "agent.autoSummaryThreshold 必须小于等于 agent.maxContextMessages",
            path: ["autoSummaryThreshold"],
          });
        }
      }),
    gateway: z.object({
      mode: z.literal("embedded"),
      localCliEnabled: z.boolean(),
      approvalTimeoutSec: z.number().int().positive(),
    }),
    logging: z.object({
      level: z.enum(["debug", "info", "warn", "error"]),
      pretty: z.boolean(),
    }),
    execution: z
      .object({
        mode: z.enum(["host", "docker"]).default("host"),
        dockerContainer: z.string().optional(),
        dockerOptions: z.record(z.string(), z.unknown()).optional(),
      })
      .default({ mode: "host" }),
    events: z
      .object({
        enabled: z.boolean().default(false),
        dir: z.string().min(1).default("./workspace/events"),
        defaultTimezone: z.string().min(1).default("UTC"),
        maxQueuedPerSession: z.number().int().positive().default(5),
        startupScan: z.boolean().default(true),
      })
      .default({
        enabled: false,
        dir: "./workspace/events",
        defaultTimezone: "UTC",
        maxQueuedPerSession: 5,
        startupScan: true,
      }),
    hostProfile: z
      .object({
        autoRefreshOnStart: z.boolean().default(true),
        jsonPath: z.string().min(1).default("./data/host/environment.json"),
        workspaceProfilePath: z.string().min(1).default("./workspace/HOST_PROFILE.md"),
      })
      .default({
        autoRefreshOnStart: true,
        jsonPath: "./data/host/environment.json",
        workspaceProfilePath: "./workspace/HOST_PROFILE.md",
      }),
    codeExecution: z
      .object({
        enabled: z.boolean().default(true),
        timeoutSec: z.number().int().positive().default(20),
        networkEnabled: z.boolean().default(false),
        workdirRoot: z.string().min(1).default("./data/code-sandbox"),
        pythonBin: z.string().min(1).default("python3"),
        tsRunner: z.string().min(1).default("tsx"),
        cpuTimeSec: z.number().int().positive().default(10),
        maxMemoryMb: z.number().int().positive().default(512),
        maxFileKb: z.number().int().positive().default(10240),
        maxProcesses: z.number().int().positive().default(32),
        maxOpenFiles: z.number().int().positive().default(64),
      })
      .default({
        enabled: true,
        timeoutSec: 20,
        networkEnabled: false,
        workdirRoot: "./data/code-sandbox",
        pythonBin: "python3",
        tsRunner: "tsx",
        cpuTimeSec: 10,
        maxMemoryMb: 512,
        maxFileKb: 10240,
        maxProcesses: 32,
        maxOpenFiles: 64,
      }),
    paths: z.object({
      dataDir: z.string().min(1),
      workspaceDir: z.string().min(1),
      transcriptsDir: z.string().min(1),
      auditDbPath: z.string().min(1),
    }),
  })
  .strict();

export const monitorRuleSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    type: z.enum(["process", "resource", "port", "http"]),
    interval: z.string().regex(durationRegex, "interval 必须是有效的持续时间，例如 60s、5m"),
    target: z.record(z.string(), z.unknown()),
    threshold: thresholdSchema.optional(),
    failureThreshold: z.number().int().positive().default(2),
    recoveryThreshold: z.number().int().positive().default(2),
    cooldown: z.string().regex(durationRegex, "cooldown 必须是有效的持续时间").optional(),
    onFailure: onFailureSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // 不同监控类型需要不同 target 字段，这里统一在 schema 层约束。
    if (value.type === "process" && typeof value.target.processName !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "process 类型要求 target.processName",
        path: ["target", "processName"],
      });
    }

    if (value.type === "http" && typeof value.target.url !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "http 类型要求 target.url",
        path: ["target", "url"],
      });
    }

    if (value.type === "resource" && typeof value.target.metric !== "string") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "resource 类型要求 target.metric",
        path: ["target", "metric"],
      });
    }
  });

export const monitorsConfigSchema = z
  .object({
    monitors: z.array(monitorRuleSchema),
  })
  .superRefine((value, ctx) => {
    // monitor id 会用于事件归档和 incident 关联，必须在配置层保证唯一。
    const ids = new Set<string>();
    for (const monitor of value.monitors) {
      if (ids.has(monitor.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `monitor id 重复: ${monitor.id}`,
          path: ["monitors"],
        });
      }
      ids.add(monitor.id);
    }
  });

export type OmbotConfig = z.infer<typeof ombotConfigSchema>;
export type MonitorsConfig = z.infer<typeof monitorsConfigSchema>;
