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

export const toolProfilePolicySchema = z
  .object({
    defaultAction: z.enum(["allow", "deny"]),
    allow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
    requireConfirmation: z.array(z.string().min(1)).optional(),
  })
  .superRefine((value, ctx) => {
    // 只有已显式允许的工具，才允许继续声明“需要确认”。
    const allow = new Set(value.allow ?? []);
    for (const toolName of value.requireConfirmation ?? []) {
      if (!allow.has(toolName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `requireConfirmation 中的工具必须同时出现在 allow 中: ${toolName}`,
          path: ["requireConfirmation"],
        });
      }
    }
  });

export const toolPolicyConfigSchema = z
  .object({
    profiles: z.record(z.string(), toolProfilePolicySchema),
  })
  .superRefine((value, ctx) => {
    // readonly 是整个系统的安全回退档，Phase 1 强制要求存在。
    if (!value.profiles.readonly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Phase 1 必须存在 readonly profile",
        path: ["profiles", "readonly"],
      });
    }
  });

export type OmbotConfig = z.infer<typeof ombotConfigSchema>;
export type MonitorsConfig = z.infer<typeof monitorsConfigSchema>;
export type ToolPolicyConfig = z.infer<typeof toolPolicyConfigSchema>;
