import type { ToolPolicyConfig } from "../config/schema";
import type { ToolPolicy, ToolPolicyDecision, ToolPolicyInput } from "./types";

function toSet(values?: string[]): Set<string> {
  return new Set(values ?? []);
}

export class ConfigDrivenToolPolicy implements ToolPolicy {
  private readonly config: ToolPolicyConfig;

  constructor(config: ToolPolicyConfig) {
    this.config = config;
  }

  async evaluate(input: ToolPolicyInput): Promise<ToolPolicyDecision> {
    // 未显式指定的 profile 一律回退到 readonly，保持默认最小权限。
    const profile = this.config.profiles[input.profile] ?? this.config.profiles.readonly;
    const allow = toSet(profile.allow);
    const deny = toSet(profile.deny);
    const requireConfirmation = toSet(profile.requireConfirmation);

    if (deny.has(input.toolName)) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `工具 ${input.toolName} 在 profile ${input.profile} 中被拒绝`,
      };
    }

    // defaultAction 定义 profile 的默认姿态，再由 allow/deny 精确收敛。
    let allowed = profile.defaultAction === "allow";

    if (allow.has(input.toolName)) {
      allowed = true;
    }

    if (!allowed) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: `工具 ${input.toolName} 未被 profile ${input.profile} 允许`,
      };
    }

    return {
      allowed: true,
      // 工具自身声明和策略配置任一方要求确认，都应进入确认流。
      requiresConfirmation:
        input.riskLevel !== "readonly" &&
        (requireConfirmation.has(input.toolName) || input.toolRequiresConfirmation === true),
    };
  }
}
