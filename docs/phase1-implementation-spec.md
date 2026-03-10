# OMBot Phase 1 实现规格

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-06

---

## 一、文档目标

本文档在 `docs/phase1-design.md` 的基础上，继续收敛出可直接编码的 Phase 1 实现规格，覆盖三部分：

- 配置 schema 草案
- TypeScript 接口与数据模型草案
- 首批脚手架文件清单

本文档的目标不是定义所有实现细节，而是确保项目开始编码时，模块边界、配置字段和核心类型已经足够稳定。

---

## 二、Phase 1 最小实现范围

本规格只覆盖以下能力：

- 本地单进程启动
- 内嵌式 Gateway Core
- CLI 交互入口
- 本机监控工具
- 监控规则调度
- Session / Transcript / Audit 持久化
- 最小审批流

不包含：

- WebSocket 对外协议落地
- 远程适配器
- 通知渠道
- 向量记忆
- 插件动态发现与加载

---

## 三、配置 Schema 草案

Phase 1 建议保留 4 份配置文件：

```text
config/
├── ombot.yaml
├── monitors.yaml
├── tool_policy.yaml
└── .env.example
```

其中：

- `ombot.yaml` 保存业务配置
- LLM 连接信息统一放在环境变量中，不写入 `ombot.yaml`

### 3.1 `ombot.yaml`

#### YAML 示例

```yaml
app:
  name: OMBot
  env: development
  host_id: local-dev

agent:
  max_context_messages: 30
  auto_summary_threshold: 24
  system_prompt_template: "config/prompts/system.txt"
  workspace_files:
    - "workspace/RUNBOOK.md"
    - "workspace/HOST_PROFILE.md"
    - "workspace/TOOLS.md"

gateway:
  mode: embedded
  local_cli_enabled: true
  approval_timeout_sec: 300

logging:
  level: info
  pretty: true

paths:
  data_dir: "./data"
  workspace_dir: "./workspace"
  transcripts_dir: "./data/sessions"
  audit_db_path: "./data/audit/audit.db"
```

#### TypeScript 接口

```ts
export interface OmbotConfig {
  app: {
    name: string;
    env: "development" | "test" | "production";
    hostId: string;
  };
  agent: {
    maxContextMessages: number;
    autoSummaryThreshold: number;
    systemPromptTemplate: string;
    workspaceFiles: string[];
  };
  gateway: {
    mode: "embedded";
    localCliEnabled: boolean;
    approvalTimeoutSec: number;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    pretty: boolean;
  };
  paths: {
    dataDir: string;
    workspaceDir: string;
    transcriptsDir: string;
    auditDbPath: string;
  };
}
```

#### 校验规则

- `app.host_id` 不能为空
- `agent.auto_summary_threshold` 必须小于等于 `agent.max_context_messages`
- `gateway.mode` Phase 1 只允许 `embedded`
- 所有路径字段在启动时需要标准化为绝对路径

### 3.1.1 LLM 环境变量

LLM 统一从环境变量读取，建议使用以下变量：

```bash
LLM_PROVIDER=openai
LLM_MODEL_NAME=gpt-4o
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0.1
LLM_TIMEOUT_MS=120000
```

对应接口：

```ts
export interface LlmConfig {
  provider: "openai";
  modelName: string;
  apiKey: string;
  baseUrl: string;
  temperature: number;
  timeoutMs: number;
}
```

### 3.2 `monitors.yaml`

#### YAML 示例

```yaml
monitors:
  - id: nginx-process
    name: nginx 进程存活
    enabled: true
    type: process
    interval: 60s
    target:
      process_name: nginx
    on_failure:
      severity: warning
      create_incident_session: true

  - id: root-disk-usage
    name: 根分区使用率
    enabled: true
    type: resource
    interval: 300s
    target:
      metric: disk_usage
      mount_point: "/"
    threshold:
      operator: ">"
      value: 85
      unit: percent
    cooldown: 1800s
```

#### TypeScript 接口

```ts
export type MonitorType = "process" | "resource" | "port" | "http";

export interface MonitorsConfig {
  monitors: MonitorRule[];
}

export interface MonitorRule {
  id: string;
  name: string;
  enabled: boolean;
  type: MonitorType;
  interval: string;
  target: Record<string, unknown>;
  threshold?: {
    operator: ">" | ">=" | "<" | "<=" | "==" | "!=";
    value: number | string;
    unit?: "percent" | "ms" | "count" | "status";
  };
  cooldown?: string;
  onFailure?: {
    severity: "info" | "warning" | "critical";
    createIncidentSession: boolean;
  };
}
```

#### 校验规则

- `id` 在配置中必须唯一
- `interval` 必须能被 Duration 解析
- `process` 类型要求 `target.process_name`
- `http` 类型要求 `target.url`
- `resource` 类型要求 `target.metric`

### 3.3 `tool_policy.yaml`

#### YAML 示例

```yaml
profiles:
  readonly:
    default_action: deny
    allow:
      - get_process_status
      - get_cpu_usage
      - get_memory_usage
      - get_disk_usage
      - get_port_status
      - check_http_endpoint
      - get_system_logs

  ops:
    default_action: deny
    allow:
      - restart_service
      - stop_service
    require_confirmation:
      - restart_service
      - stop_service
```

#### TypeScript 接口

```ts
export interface ToolPolicyConfig {
  profiles: Record<string, ToolProfilePolicy>;
}

export interface ToolProfilePolicy {
  defaultAction: "allow" | "deny";
  allow?: string[];
  deny?: string[];
  requireConfirmation?: string[];
}
```

#### 校验规则

- Phase 1 必须存在 `readonly` profile
- `require_confirmation` 中的工具必须也存在于 `allow`
- 未声明 profile 时，默认回退到 `readonly`

### 3.4 `.env.example`

```bash
OPENAI_API_KEY=your_api_key_here
```

---

## 四、配置加载模块规格

### 4.1 目标

配置加载模块负责：

- 读取 YAML
- 展开环境变量
- 执行 schema 校验
- 解析相对路径
- 返回标准化配置对象

### 4.2 建议文件

```text
src/config/
├── loader.ts
├── schema.ts
├── env.ts
└── normalize.ts
```

### 4.3 建议接口

```ts
export interface LoadedConfig {
  ombot: OmbotConfig;
  monitors: MonitorsConfig;
  toolPolicy: ToolPolicyConfig;
}

export interface ConfigLoader {
  load(configDir: string): Promise<LoadedConfig>;
}
```

---

## 五、核心 TypeScript 接口草案

### 5.1 Gateway

```ts
export interface GatewayRunHandle {
  sessionId: string;
  runId: string;
  stream: AsyncIterable<GatewayEvent>;
}

export interface Gateway {
  sendUserMessage(input: UserMessageInput): Promise<GatewayRunHandle>;
  dispatchMonitorEvent(input: MonitorEventInput): Promise<GatewayRunHandle>;
  resolveApproval(input: ApprovalResolutionInput): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSnapshot | null>;
}
```

### 5.2 Agent Runtime

```ts
export interface AgentRunInput {
  session: SessionRecord;
  promptContext: PromptContext;
  input:
    | { kind: "user_message"; content: string }
    | { kind: "monitor_event"; event: MonitorEvent };
  toolProfile: string;
}

export type AgentRuntimeEvent =
  | { type: "agent.start"; sessionId: string }
  | { type: "agent.message_update"; sessionId: string; content: string }
  | { type: "tool.call"; sessionId: string; toolCall: ToolCallRequest }
  | { type: "tool.result"; sessionId: string; toolResult: ToolExecutionResult }
  | { type: "agent.summary"; sessionId: string; summary: string }
  | { type: "agent.end"; sessionId: string };

export interface AgentRuntimeAdapter {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}
```

### 5.3 Tool Registry / Tool Policy

```ts
export type ToolRiskLevel = "readonly" | "mutating" | "privileged";

export interface OmbotToolDefinition<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  requiresConfirmation?: boolean;
  parametersSchema: unknown;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<TResult>;
}

export interface ToolRegistry {
  register(tool: OmbotToolDefinition): void;
  get(name: string): OmbotToolDefinition | undefined;
  list(): OmbotToolDefinition[];
}

export interface ToolPolicyInput {
  profile: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  sessionId: string;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reason?: string;
}

export interface ToolPolicy {
  evaluate(input: ToolPolicyInput): Promise<ToolPolicyDecision>;
}
```

### 5.4 Monitor Engine

```ts
export interface MonitorCheckResult {
  ruleId: string;
  status: "ok" | "alert" | "recovered" | "error";
  observedAt: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface MonitorEvent {
  eventId: string;
  ruleId: string;
  severity: "info" | "warning" | "critical";
  type: "monitor.alert" | "monitor.recovered";
  observedAt: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface MonitorEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### 5.5 Session / Transcript

```ts
export type SessionType = "interactive" | "incident" | "system";
export type SessionStatus = "active" | "idle" | "closed";

export interface SessionRecord {
  sessionId: string;
  type: SessionType;
  status: SessionStatus;
  hostId: string;
  channel: "cli" | "internal";
  createdAt: string;
  updatedAt: string;
  title?: string;
  relatedMonitorKey?: string;
}

export interface SessionSummary {
  sessionId: string;
  type: SessionType;
  status: SessionStatus;
  title?: string;
  updatedAt: string;
}

export interface SessionSnapshot {
  session: SessionRecord;
  transcript: TranscriptEntry[];
}

export interface TranscriptEntry {
  id: string;
  parentId?: string;
  sessionId: string;
  kind:
    | "message"
    | "tool_call"
    | "tool_result"
    | "monitor_event"
    | "approval"
    | "summary";
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SessionStore {
  create(input: { type: SessionType; title?: string; relatedMonitorKey?: string }): Promise<SessionRecord>;
  get(sessionId: string): Promise<SessionRecord | null>;
  list(): Promise<SessionSummary[]>;
  update(session: SessionRecord): Promise<void>;
}

export interface TranscriptStore {
  append(entry: TranscriptEntry): Promise<void>;
  listBySession(sessionId: string, limit?: number): Promise<TranscriptEntry[]>;
}
```

### 5.6 Audit / Approval

```ts
export interface AuditRecord {
  auditId: string;
  sessionId: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  decision: "allowed" | "denied" | "approved_once" | "approved_session";
  resultStatus: "pending" | "success" | "error";
  createdAt: string;
  inputJson: string;
  approvalId?: string;
}

export interface ApprovalRequest {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  reason: string;
  expiresAt: string;
}

export interface ApprovalResolutionInput {
  approvalId: string;
  action: "approve_once" | "deny";
  resolvedBy: string;
}

export interface AuditStore {
  insert(record: AuditRecord): Promise<void>;
}

export interface ApprovalCenter {
  request(input: ApprovalRequest): Promise<void>;
  resolve(input: ApprovalResolutionInput): Promise<void>;
}
```

### 5.7 CLI

```ts
export interface CliApp {
  start(): Promise<void>;
}
```

---

## 六、事件模型草案

### 6.1 Gateway 内部事件

```ts
export type GatewayEvent =
  | { type: "gateway.run.started"; sessionId: string; runId: string }
  | { type: "gateway.run.completed"; sessionId: string; runId: string }
  | { type: "agent.message_update"; sessionId: string; content: string }
  | { type: "tool.execution_start"; sessionId: string; toolName: string; toolCallId: string }
  | { type: "tool.execution_end"; sessionId: string; toolName: string; toolCallId: string; status: "success" | "error" }
  | { type: "approval.required"; sessionId: string; approvalId: string; toolName: string; reason: string }
  | { type: "monitor.alert"; sessionId: string; summary: string };
```

### 6.2 事件总线接口

```ts
export interface EventBus {
  publish(event: GatewayEvent): Promise<void>;
  subscribe(handler: (event: GatewayEvent) => void | Promise<void>): () => void;
}
```

---

## 七、首批脚手架文件清单

下面这批文件建议作为第一轮脚手架直接创建：

```text
OMBot/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── config/
│   ├── ombot.yaml
│   ├── monitors.yaml
│   ├── tool_policy.yaml
│   └── .env.example
├── workspace/
│   ├── RUNBOOK.md
│   ├── HOST_PROFILE.md
│   └── TOOLS.md
├── src/
│   ├── index.ts
│   ├── bootstrap.ts
│   ├── shared/
│   │   ├── types.ts
│   │   ├── errors.ts
│   │   ├── time.ts
│   │   └── ids.ts
│   ├── config/
│   │   ├── loader.ts
│   │   ├── schema.ts
│   │   ├── env.ts
│   │   └── normalize.ts
│   ├── gateway/
│   │   ├── core.ts
│   │   ├── event-bus.ts
│   │   ├── approvals.ts
│   │   ├── sessions.ts
│   │   └── types.ts
│   ├── agent/
│   │   ├── runtime.ts
│   │   ├── context.ts
│   │   ├── prompts.ts
│   │   └── types.ts
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── policy.ts
│   │   ├── types.ts
│   │   └── local/
│   │       ├── process.ts
│   │       ├── resource.ts
│   │       ├── network.ts
│   │       └── service.ts
│   ├── monitor/
│   │   ├── engine.ts
│   │   ├── runner.ts
│   │   ├── rules.ts
│   │   └── types.ts
│   ├── memory/
│   │   ├── session-store.ts
│   │   ├── transcript-store.ts
│   │   ├── summaries.ts
│   │   └── types.ts
│   ├── audit/
│   │   ├── sqlite-audit.ts
│   │   └── types.ts
│   └── cli/
│       ├── repl.ts
│       └── render.ts
└── data/
    ├── .gitkeep
    ├── sessions/.gitkeep
    └── audit/.gitkeep
```

---

## 八、首批实现顺序建议

建议按以下顺序编码：

1. `config/`
   - 先把配置读起来并完成校验
2. `shared/`
   - 放基础类型、ID 生成、错误模型、时间工具
3. `memory/session-store` + `memory/transcript-store`
   - 让 session 可创建、可写日志
4. `audit/sqlite-audit`
   - 让高风险调用可留痕
5. `tools/registry` + `tools/policy`
   - 先把工具定义和策略跑通
6. `tools/local/*`
   - 从只读工具开始
7. `agent/runtime`
   - 接入 `pi-agent-core` / `pi-ai`
8. `gateway/core`
   - 接 CLI、Agent、Tool、Store
9. `monitor/engine`
   - 最后再把告警事件接进 Gateway
10. `cli/repl`
   - 补用户交互壳

---

## 九、验收清单

开始正式写代码前，应确认下面这些点没有分歧：

- `embedded gateway` 是 Phase 1 唯一运行模式
- `tool_policy.yaml` 在 Phase 1 独立存在
- `SessionStore` 与 `TranscriptStore` 分离
- 审批流由 Gateway 负责，而不是工具自己决定
- 高风险工具初版仅保留 `restart_service` / `stop_service`
- 工作区固定文件初版只启用 3 个

如果以上都确认，就可以直接进入项目脚手架搭建阶段。
