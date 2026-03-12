# OMBot Phase 1 详细设计

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-06

---

## 一、文档目标

本文档定义 OMBot 的 **Phase 1（MVP）** 详细设计，目标是在不引入完整多端体系的前提下，完成一个本地可运行、具备最小监控与 AI 运维闭环的版本。

Phase 1 以 `docs/gateway-architecture.md` 为前提，采用 **内嵌式 Gateway + Agent Runtime + Monitor Engine + Tool Policy + Session/Audit** 的最小组合。

如需继续进入编码准备，请配合阅读 `docs/phase1-implementation-spec.md`，其中定义了配置 schema、核心 TypeScript 接口和首批脚手架文件清单。

---

## 二、Phase 1 的目标与边界

### 2.1 核心目标

Phase 1 必须做到：

- OMBot 作为本地单进程服务启动
- 能读取配置并加载本机监控规则
- 能通过 CLI 与用户进行自然语言交互
- 能由监控引擎主动触发异常事件
- 能调用本机只读监控工具
- 能对高风险操作执行确认与审计
- 能保存会话 transcript 和结构化审计记录

### 2.2 非目标

Phase 1 暂不实现：

- 远程服务器适配器
- 对外开放的 WebSocket 远程接入
- 企业微信、飞书、短信等通知渠道
- 向量数据库语义记忆
- 多设备配对与远程 operator client
- 多 Agent 编排

Phase 1 的重点不是“做全”，而是跑通一条最小主线：

**CLI / 监控事件 -> Gateway -> Agent -> Tool -> 审计 / Session -> 结果返回**

---

## 三、Phase 1 的系统组成

```text
┌────────────────────────────────────────────────────┐
│                   OMBot Process                    │
│                                                    │
│  CLI  ───────┐                                     │
│              ▼                                     │
│         Gateway Core                               │
│         - session manager                          │
│         - event bus                                │
│         - approval center                          │
│         - agent invocation bridge                  │
│              │                                     │
│              ▼                                     │
│         Agent Runtime                              │
│         - prompt builder                           │
│         - context assembly                         │
│         - tool loop                                │
│              │                                     │
│              ▼                                     │
│         Tool Runtime                               │
│         - readonly monitor tools                   │
│         - privileged ops tools                     │
│         - tool policy layer                        │
│                                                    │
│  Monitor Engine ────────> Gateway Event Bus        │
│                                                    │
│  Session Store / Transcript Store / Audit Store    │
└────────────────────────────────────────────────────┘
```

---

## 四、用户故事与最小闭环

### 4.1 故事 A：用户主动查询

用户在本地 CLI 中输入：

> “现在 nginx 和系统资源怎么样？”

系统流程：

1. CLI 把输入发送给 Gateway
2. Gateway 选择或创建 interactive session
3. Agent Runtime 构建上下文
4. Agent 调用 `get_process_status`、`get_cpu_usage`、`get_memory_usage`
5. Gateway 接收事件流并打印到 CLI
6. transcript 与 tool result 被写入 Session Store
7. 最终结果返回给用户

### 4.2 故事 B：监控异常触发

监控规则检测到 `nginx` 进程异常。

系统流程：

1. Monitor Engine 产生 `monitor.alert` 事件
2. Gateway 路由到 incident session
3. Agent 分析状态并生成告警结论
4. 如策略允许，触发审批或建议动作
5. 事件、摘要和后续动作被写入 transcript 与 audit

### 4.3 故事 C：高风险操作确认

用户要求：

> “重启 nginx”

系统流程：

1. Agent 决定调用 `restart_service`
2. Tool Policy 标记该工具需要确认
3. Gateway 生成审批请求
4. CLI 要求用户确认
5. 用户确认后执行工具
6. 结果写入 transcript 和 audit

---

## 五、模块设计

### 5.1 Gateway Core

Phase 1 中，Gateway Core 是进程内模块，不要求单独网络暴露。

职责：

- 接收 CLI 消息
- 接收 Monitor Engine 事件
- 管理会话生命周期
- 分发审批请求
- 桥接 Agent Runtime
- 写入 session / transcript / audit

建议接口：

```ts
interface Gateway {
  sendUserMessage(input: UserMessageInput): Promise<GatewayRunHandle>;
  dispatchMonitorEvent(event: MonitorEvent): Promise<GatewayRunHandle>;
  resolveApproval(input: ApprovalResolution): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
}
```

### 5.2 Agent Runtime Adapter

职责：

- 组装 system prompt
- 装载工具列表
- 读取最近 session context
- 将 Gateway 输入转成 agent input
- 监听流式事件并映射回 Gateway 事件

建议接口：

```ts
interface AgentRuntimeAdapter {
  run(input: AgentRunInput): AsyncIterable<AgentRuntimeEvent>;
}
```

### 5.3 Tool Registry + Tool Policy

Phase 1 工具分为两类：

- **只读监控工具**
- **高风险运维工具**

建议最小工具集：

**监控类（readonly）**：
- `get_process_status`
- `get_cpu_usage`
- `get_memory_usage`
- `get_disk_usage`
- `get_port_status`
- `check_http_endpoint`
- `get_system_logs`

**运维类（mutating，需确认）**：
- `restart_service`
- `stop_service`

**通用执行（通过 pi-mom 嵌入）**：
- `bash` - 主机命令执行（pi-mom，支持输出截断、超时）
- `grep` - 文件内容搜索
- `find` - 文件查找

**扩展工具（可选，未来嵌入 pi-mom）**：
- `read` - 文件读取（支持 offset/limit 分页）
- `write` - 文件写入
- `edit` - 精确文本编辑（带 diff 预览）
- `docker_bash` - 在隔离容器内执行命令（高风险操作隔离）

Phase 1 中，`docker_bash` 作为可选增强，需用户预先创建 Docker 容器。

建议接口：

```ts
interface OmbotToolDefinition {
  name: string;
  description: string;
  riskLevel: "readonly" | "mutating" | "privileged";
  requiresConfirmation?: boolean;
  parameters: unknown;
  execute(input: unknown, ctx: ToolExecutionContext): Promise<ToolResult>;
}
```

策略层接口：

```ts
interface ToolPolicy {
  evaluate(input: ToolPolicyInput): Promise<ToolPolicyDecision>;
}
```

### 5.4 Monitor Engine

职责：

- 读取 `config/monitors.yaml`
- 周期执行监控任务
- 做阈值判断、cooldown、恢复检测
- 将结果转成结构化监控事件投递到 Gateway

建议接口：

```ts
interface MonitorEngine {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

### 5.5 Session / Transcript Store

建议拆成两层：

- `SessionStore`
  - 会话索引、状态、类型、绑定关系
- `TranscriptStore`
  - append-only JSONL transcript

Session metadata 示例：

```ts
interface SessionRecord {
  sessionId: string;
  type: "interactive" | "incident" | "system";
  status: "active" | "idle" | "closed";
  createdAt: string;
  updatedAt: string;
  hostId: string;
  channel: "cli" | "internal";
  title?: string;
  relatedMonitorKey?: string;
}
```

Transcript entry 示例：

```ts
interface TranscriptEntry {
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
```

### 5.6 Audit Store

审计不等于 transcript，Phase 1 必须单独保留结构化审计记录。

建议先用 SQLite。

审计记录至少包含：

- `audit_id`
- `session_id`
- `tool_name`
- `risk_level`
- `input`
- `decision`
- `approval_id`
- `result_status`
- `created_at`

---

## 六、Phase 1 的上下文构建

### 6.1 上下文组成

Phase 1 每轮送给模型的上下文建议包含：

1. 固定 system prompt
2. 当前主机信息摘要
3. 当前 session 最近消息窗口
4. 最近工具调用结果
5. 当前 monitor event（若有）
6. 工作区固定文档的最小子集

### 6.2 Phase 1 固定注入文件

Phase 1 不必一次注入很多文档，建议只保留：

- `workspace/RUNBOOK.md`
- `workspace/HOST_PROFILE.md`
- `workspace/TOOLS.md`

其余文档可以先占位，不强制启用。

### 6.3 压缩策略

Phase 1 采用简单策略：

- 保留最近 N 轮消息
- 在达到上下文阈值前生成一次 summary entry
- 不做复杂记忆召回

---

## 七、配置设计

### 7.1 `config/ombot.yaml`

最小字段建议：

```yaml
llm:
  provider: openai
  model: gpt-4o
  api_key: "${OPENAI_API_KEY}"

agent:
  system_prompt_file: "workspace/RUNBOOK.md"
  max_context_messages: 30
  auto_summary_threshold: 24

gateway:
  mode: embedded
  local_cli_enabled: true

security:
  default_tool_profile: readonly
  require_confirmation_for:
    - restart_service
    - stop_service

paths:
  data_dir: "./data"
  workspace_dir: "./workspace"
```

### 7.2 `config/monitors.yaml`

Phase 1 支持的监控类型建议限制为：

- `process`
- `http`
- `resource`
- `port`

### 7.3 `config/tool_policy.yaml`

建议新增独立工具策略文件。

示例：

```yaml
profiles:
  readonly:
    allow:
      - get_process_status
      - get_cpu_usage
      - get_memory_usage
      - get_disk_usage
      - get_port_status
      - check_http_endpoint
      - get_system_logs

  ops:
    allow:
      - restart_service
      - stop_service
    require_confirmation:
      - restart_service
      - stop_service
```

---

## 八、运行流程设计

### 8.1 启动流程

```text
1. 读取配置
2. 初始化日志系统
3. 初始化 SessionStore / TranscriptStore / AuditStore
4. 初始化 Tool Registry 与 Tool Policy
5. 初始化 Agent Runtime Adapter
6. 初始化 Gateway Core
7. 初始化 Monitor Engine
8. 启动 CLI Loop
```

### 8.2 用户消息流程

```text
CLI -> Gateway.sendUserMessage()
    -> Session Router 选会话
    -> Agent Invocation Bridge 构建上下文
    -> Agent Runtime.run()
    -> Tool Policy / Tool Execute
    -> Transcript append
    -> Audit append
    -> CLI 输出事件
```

### 8.3 监控告警流程

```text
MonitorEngine -> Gateway.dispatchMonitorEvent()
    -> route to incident session
    -> append monitor_event
    -> Agent Runtime.run()
    -> summary / action suggestion
    -> append transcript + audit
```

### 8.4 审批流程

```text
Agent decides tool call
    -> ToolPolicy requires confirmation
    -> Gateway emits approval request
    -> CLI prompt user
    -> resolve approval
    -> execute tool
    -> persist result
```

---

## 九、目录与文件落地建议

Phase 1 建议先落地以下文件：

```text
src/
├── index.ts
├── gateway/
│   ├── index.ts
│   ├── core.ts
│   ├── event-bus.ts
│   ├── approvals.ts
│   └── sessions.ts
├── agent/
│   ├── runtime.ts
│   ├── prompts.ts
│   └── context.ts
├── tools/
│   ├── registry.ts
│   ├── policy.ts
│   ├── types.ts
│   └── local/
│       ├── process.ts
│       ├── resource.ts
│       ├── network.ts
│       └── service.ts
├── monitor/
│   ├── engine.ts
│   ├── runner.ts
│   ├── rules.ts
│   └── events.ts
├── memory/
│   ├── session-store.ts
│   ├── transcript-store.ts
│   └── summaries.ts
├── audit/
│   └── sqlite-audit.ts
├── config/
│   ├── loader.ts
│   └── schema.ts
└── cli/
    └── repl.ts
```

---

## 十、依赖建议

Phase 1 建议只引入必要依赖：

- `@mariozechner/pi-agent-core`
- `@mariozechner/pi-ai`
- `yaml`
- `zod`
- `pino`
- `better-sqlite3`
- `node-cron`
- `undici`
- `tsx`
- `typescript`

暂不建议引入：

- Web 框架
- 向量数据库 SDK
- 复杂消息队列
- 多余的 UI 库

---

## 十一、测试策略

### 11.1 单元测试

覆盖：

- 配置解析
- 工具策略判断
- 会话路由规则
- transcript append / read
- 审批状态机

### 11.2 集成测试

至少覆盖：

- CLI 查询系统状态
- 监控事件触发 incident session
- 高风险工具确认后执行
- transcript 与 audit 同步落盘

### 11.3 手工验证

至少验证：

- 本地启动
- nginx 进程异常时能触发事件
- CLI 中能看到工具执行过程
- 重启服务前会要求确认

---

## 十二、Phase 1 完成标准

当满足以下条件时，可认为 Phase 1 完成：

- 可以通过 CLI 与 OMBot 稳定对话
- OMBot 能调用本机监控工具回答基础运维问题
- 监控引擎能主动触发异常分析
- 高风险动作有确认与审计
- transcript 可回放，audit 可查询
- Gateway 已作为统一宿主工作，即使暂未开放远程协议

---

## 十三、Phase 1 之后的直接延伸

完成 Phase 1 后，最自然的下一步是：

1. 开放 WebSocket Gateway 最小协议
2. 引入远程适配器
3. 增加 Operator 控制台原型
4. 再补长期记忆与语义检索

这样可以保证 Phase 2 不是推翻重做，而是在 Phase 1 的 Gateway 主线上自然扩展。
