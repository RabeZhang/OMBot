# OMBot 项目需求文档

**版本**: v0.4  
**状态**: 草稿（已根据 pi-mono 与 openclaw 源码更新技术路线）  
**最后更新**: 2026-03-06

---

## 一、项目概述

### 配套设计文档

- `docs/gateway-architecture.md`：Gateway / Control Plane 的职责边界、协议模型与控制面设计
- `docs/phase1-design.md`：基于 Gateway 架构的 Phase 1 MVP 详细设计
- `docs/phase1-implementation-spec.md`：Phase 1 的配置 schema、TypeScript 接口草案与脚手架清单

---

### 1.1 项目定位

OMBot 是一个运行在 Unix 类系统（Linux / macOS）上的 **AI Agent 形态运维监控机器人**。

与传统监控工具（Prometheus、Zabbix 等）不同，OMBot 以 LLM + Function Calling 为核心大脑：
- 用自然语言理解用户意图，自主决策调用工具
- 主动感知系统异常，智能判断是否需要告警或自动处理
- 通过记忆系统积累运维经验，支持历史数据的自然语言查询

### 1.2 设计原则

- **原生 Unix**：直接作为系统服务运行（systemd / launchd），无需容器
- **AI-First**：所有交互和决策均经过 LLM 处理，而非传统规则引擎
- **可扩展性**：监控目标、通知渠道、工具能力均以插件/配置方式扩展
- **安全隔离**：远程服务器的监控通过对方暴露的接口/脚本实现，避免 OMBot 直接操控远程机器
- **渐进式实现**：功能分阶段交付，每阶段均可独立运行

### 1.3 与同类项目的差异

| 对比维度 | OMBot | 传统监控工具 | openclaw 类项目 |
|---|---|---|---|
| 核心驱动 | LLM Agent | 规则引擎 | LLM Agent |
| 运行环境 | Unix 原生 | 跨平台/容器 | 跨平台 |
| 主要场景 | 服务器运维监控 | 通用监控 | 通用 AI 助手 |
| 交互方式 | 自然语言双向 | 告警通知单向 | 自然语言双向 |
| 远程监控 | 接口适配器模式 | Agent / SNMP | - |

---

## 二、系统架构

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────┐
│                         OMBot                                │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    Agent Core                         │  │
│  │         LLM (API) + Function Calling + 上下文管理       │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│          ┌──────────────┼───────────────┐                   │
│          ▼              ▼               ▼                   │
│  ┌───────────────┐ ┌──────────┐ ┌────────────────┐         │
│  │ Tool Registry │ │ Monitor  │ │ Memory System  │         │
│  │               │ │ Engine   │ │                │         │
│  │ - 本机工具     │ │          │ │ - 工作记忆      │         │
│  │ - 远程适配器   │ │ - 定时轮询│ │ - 短期记忆      │         │
│  │ - 系统操作     │ │ - 事件驱动│ │ - 长期/异常存储 │         │
│  └───────────────┘ └──────────┘ └────────────────┘         │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                 Communication Layer                   │  │
│  │   WebSocket Server │ 企业微信 Bot │ 飞书 Bot │ 短信      │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         ▲                                    ▲
         │ 本地接口调用                          │ 远程 HTTP 接口
         ▼                                    ▼
   本机系统资源                          远程服务器
   (进程/端口/磁盘等)                  (暴露监控接口/脚本)
```

### 2.2 技术栈

| 层次 | 技术选型 | 备注 |
|---|---|---|
| 开发语言 | TypeScript | 主语言 |
| Agent Runtime | `@mariozechner/pi-agent-core` | 作为 Agent 主循环与 tool-calling 运行时 |
| LLM 接入 | `@mariozechner/pi-ai` + OpenAI API | 初期使用 OpenAI，后续可切换其他 provider |
| 会话编排 | 借鉴 `pi-coding-agent` 的 session / compaction / queue 设计 | 选择性吸收，不直接照搬完整 CLI/TUI |
| 运行时 | Node.js 20+ | Phase 1 先以 Node.js 为主 |
| 配置文件 | YAML + `.env` | 业务配置用 YAML，敏感信息经环境变量注入 |
| 会话持久化 | JSONL Session Log | 参考 pi-mono 的 append-only session 方案 |
| 结构化存储 | SQLite | 存储异常事件、操作审计、趋势摘要 |
| 语义记忆 | 向量数据库（Phase 3 再引入） | 用于日志/对话/历史检索增强 |
| 通信协议 | WebSocket | 对外双向通信，内部事件模型参考 pi-mono RPC |

### 2.3 基于 pi-mono 的技术路线

结合对 `pi-mono` 源码的分析，OMBot 的技术路线明确如下：

- **底层能力复用**：优先借鉴 `pi-agent-core` 的 Agent 主循环，以及 `pi-ai` 的 provider / transport 抽象，而不是从零实现一套 tool-calling runtime
- **产品层选择性吸收**：参考 `pi-coding-agent` 的 session tree、自动压缩、扩展机制、SDK / RPC 事件模型，但不直接引入其偏编码助手的 TUI 交互形态
- **事件驱动设计**：参考 `pi-mom` 的事件触发和队列思路，让监控引擎将异常事件投递到 Agent 输入队列，而不是把监控逻辑直接塞进 Agent 主循环
- **安全策略内建**：与 pi-mono 默认的弱权限内建设计不同，OMBot 必须在工具执行前引入统一的风险分级、确认、拦截和审计能力
- **记忆分阶段实现**：先落地 session 持久化与结构化事件仓库，再扩展为长期记忆和语义检索，不在 MVP 阶段一次性上完整向量记忆系统

> **技术原则**：OMBot 借鉴 pi-mono 的分层架构与运行机制，但不会直接把 `pi-coding-agent` 当成完整成品框架照搬。

### 2.4 基于 openclaw 补充的产品层设计

结合对 `openclaw` 的分析，OMBot 在产品层和宿主层需要进一步明确以下设计：

- **Gateway / Control Plane**：OMBot 采用单一常驻 Gateway 进程作为系统控制平面，统一承载会话、监控事件路由、客户端接入、工具执行事件、审批状态与通知分发
- **Gateway 是唯一真相源**：CLI、Web、移动端、Bot 渠道都不直接维护各自上下文，而通过 Gateway 协议访问同一套会话和运行状态
- **上下文、记忆、工作区分层**：送给模型的上下文、磁盘上的长期记忆、运维知识工作区三者分开设计，避免把记忆系统与 prompt 注入混为一谈
- **三层安全模型**：工具运行环境、工具策略、审批提权分别建模，而不只用"是否确认"这一个安全开关
- **协议先于客户端**：先定义 Gateway 的 WebSocket / HTTP 协议和角色模型，再逐步落地 CLI、控制台和移动端，而不是先做某一个客户端再倒推协议

---

## 三、功能模块详细需求

### 3.1 Agent Core（核心大脑）

**功能描述**

- 以 pi-mono 框架为基础构建 Agent
- 接收两类输入：用户消息（自然语言）、监控引擎推送的事件
- 维护多轮对话上下文，结合 Memory System 提供连贯的交互体验
- 自主决策：根据输入决定调用哪些工具、是否告警、是否自动处理

**实现路线**

- 参考 `createAgentSession()` 的思路，为 OMBot 设计单一的组合入口（Composition Root），统一组装模型、工具、配置、会话、扩展、记忆与通信层
- Agent Core 内部采用"消息 -> LLM -> tool call -> tool result -> 下一轮"的标准循环，不额外发明第二套编排逻辑
- 将监控事件、用户输入、后续追问统一建模为 Agent 输入事件，并通过队列管理，避免并发事件直接冲撞主循环
- 上下文不直接原地修改，而是从 session entries 重建，便于回放、分支、摘要和审计

**运行时能力**

- 支持流式输出
- 支持工具执行中的进度更新
- 支持自动重试、上下文压缩、分支会话
- 支持按不同渠道或会话维度隔离上下文
- 支持 `steer`、`followup`、`interrupt` 等不同输入队列语义，区分用户插话、监控事件和后续追问

**上下文构建策略**

- `上下文 != 记忆`，上下文仅表示当前这一轮真正送给模型的材料
- 每轮推理的上下文由宿主系统构建，至少包含：system prompt、当前会话历史、工具调用结果、当前监控事件载荷、按需召回的记忆片段、固定注入的工作区文件
- 固定注入的运维工作区文件建议包括：`RUNBOOK.md`、`HOST_PROFILE.md`、`ALERT_POLICY.md`、`TOOLS.md`、`USER.md`
- 需要具备上下文可观测能力，能看到哪些消息、文件和工具 schema 占用了上下文预算

**运维工作区**

- OMBot 拥有独立的 Agent Workspace，用于沉淀运维知识和行为约束
- 工作区用于存放运行手册、主机画像、告警策略、经验总结等文档型知识
- 运行时状态、凭据、审计日志与工作区分离存储，避免将敏感数据与提示词材料混放
- 工作区内容允许被 Agent 读取，但不应默认允许被 Agent 任意改写

**LLM 配置需求**

- 支持通过配置文件切换 LLM 提供商和模型
- 支持设置 system prompt（定义 OMBot 的角色和行为边界）
- 支持 function calling / tool use

**安全约束**

- 破坏性操作（重启服务、执行 shell 命令等）需要明确的用户确认，或在配置中预先授权
- 保留完整的操作日志供审计
- Agent 不直接拥有无限制系统能力，所有高风险能力必须通过受控工具暴露

---

### 3.2 Tool / Plugin Registry（工具注册系统）

工具分为**内置工具**和**远程适配器**两类，统一注册到 Agent 的工具链中。

**技术设计**

- 工具采用"声明与执行分离"设计：注册阶段提供 `name`、`description`、`parameters schema`，执行阶段实现 `execute()`
- 本机工具、远程工具、通知工具在 Agent 看来都是统一的可调用工具
- 所有工具在真正执行前都经过统一的 `Tool Policy Layer`，用于确认、阻断、审计和结果改写
- Phase 2 起支持通过扩展机制注册额外工具，但运维安全相关拦截能力应内建，不完全依赖插件

**三层安全模型**

1. **Execution Environment**：决定工具运行在哪，例如宿主机本地、受限沙箱、远程 HTTP 适配器
2. **Tool Policy**：决定工具是否暴露给模型，以及是否允许在当前渠道、会话、主机和参数条件下调用
3. **Approval / Elevation**：决定高风险操作是否需要用户确认、一次性授权或临时提权执行

> `sandbox` 解决"在哪跑"，`tool policy` 解决"能不能给模型用"，`approval/elevation` 解决"是否允许这次高风险执行"。

**策略层需求**

- 每个工具必须声明风险级别：`readonly`、`mutating`、`privileged`
- 高风险工具必须支持 `requires_confirmation`
- 策略层支持按工具名、参数、调用来源、目标主机进行细粒度控制
- 所有 `mutating` / `privileged` 工具调用必须记录结构化审计日志
- 策略层支持按 agent profile、provider、channel、session 动态收缩工具暴露面

**工具分组与 Profile**

- `readonly`：仅监控查询、日志读取、端口检查、HTTP 健康检查
- `ops`：允许受控 shell、服务控制、本机排障与远程适配器调用
- `notify`：只允许通知、会话查询和摘要生成
- `repair`：允许自动修复动作，但必须经过审批或预授权

#### 3.2.1 内置本机监控工具

| 工具名 | 功能描述 | 所需权限 |
|---|---|---|
| `get_process_status` | 查询指定进程是否存活、PID、启动时长 | 普通 |
| `get_cpu_usage` | 获取当前 CPU 占用率（整体 + 各核心）| 普通 |
| `get_memory_usage` | 获取内存和 Swap 使用情况 | 普通 |
| `get_disk_usage` | 获取各磁盘分区使用情况 | 普通 |
| `get_network_stats` | 获取网络流量、连接数 | 普通 |
| `get_port_status` | 检查指定端口是否处于监听状态 | 普通 |
| `check_http_endpoint` | 对 HTTP/HTTPS 端点发起健康检查 | 普通 |
| `get_system_logs` | 获取系统日志片段（journald / syslog）| 普通/root |
| `restart_service` | 通过 systemd / launchd 重启服务 | root |
| `stop_service` | 停止服务 | root |
| `execute_shell` | 执行受限 shell 命令（白名单控制）| root / 配置授权 |

#### 3.2.2 远程服务器适配器（可配置）

**设计原则**：远程服务器自行暴露监控接口，OMBot 通过 HTTP 调用。不直接 SSH 登录远程机器，避免单点失控风险。

**配置文件驱动**：通过 YAML 配置文件注册远程工具，无需修改代码即可增删监控目标。

```yaml
# config/remote_adapters.yaml 示例
remote_servers:
  - name: "web-server-01"
    description: "主 Web 服务器（上海机房）"
    base_url: "http://192.168.1.10:9090"
    auth:
      type: bearer_token
      token: "${WEB_SERVER_01_TOKEN}"
    tools:
      - name: "get_service_status"
        path: "/status"
        method: GET
        description: "获取服务器上各服务的运行状态"
      - name: "get_resource_usage"
        path: "/resources"
        method: GET
        description: "获取 CPU、内存、磁盘使用情况"
      - name: "restart_service"
        path: "/services/{service_name}/restart"
        method: POST
        description: "重启指定服务"
        requires_confirmation: true
```

**动态注册机制**

- OMBot 启动时，自动读取配置文件，将所有远程工具注册到 Agent 工具链
- 支持热重载：修改配置文件后，无需重启 OMBot 即可生效
- 远程工具在 Agent 中的表现形式与本机工具一致（统一的 Function Calling 接口）
- 远程工具仍经过统一的风险策略层，不因为是 HTTP 调用而绕过确认与审计

---

### 3.3 Monitor Engine（监控调度引擎）

**功能描述**

- 读取监控规则配置，按规则定时或事件触发执行检查
- 检测到异常时，将事件推送给 Agent Core 处理
- Agent 决定是否告警、告警内容、是否自动执行修复操作

**运行机制**

- Monitor Engine 独立于 Agent 主循环运行，负责定时调度、阈值计算、状态缓存和异常去重
- 监控结果以结构化事件形式投递给 Agent，例如 `monitor.triggered`、`monitor.recovered`、`monitor.action_required`
- Agent 只负责理解事件语义、生成响应和决策，不负责底层调度本身
- 事件投递需要具备排队与限流能力，防止大量告警同时压垮 Agent

**监控规则配置**

```yaml
# config/monitors.yaml 示例
monitors:
  - name: "nginx 进程存活"
    enabled: true
    type: process
    target: nginx
    interval: 60s
    on_failure:
      notify: true
      channels: [wechat_work, feishu]
      message_template: "⚠️ nginx 进程已停止，正在尝试重启..."
      auto_actions:
        - tool: restart_service
          params:
            service: nginx

  - name: "CPU 高负载告警"
    enabled: true
    type: resource
    metric: cpu_percent
    threshold: ">90"
    duration: 5m        # 持续超过阈值才触发
    interval: 30s
    on_trigger:
      notify: true
      channels: [wechat_work]
      cooldown: 30m     # 同一告警的冷却时间，避免告警轰炸

  - name: "磁盘空间告警"
    enabled: true
    type: resource
    metric: disk_usage
    target: "/"
    threshold: ">85%"
    interval: 5m
    on_trigger:
      notify: true
      channels: [feishu]

  - name: "API 服务健康检查"
    enabled: true
    type: http
    url: "http://localhost:8080/health"
    expected_status: 200
    timeout: 10s
    interval: 30s
    on_failure:
      notify: true
      channels: [wechat_work, feishu]
```

**调度机制需求**

- 支持 cron 表达式和简单间隔（`30s` / `5m` / `1h`）两种调度方式
- 支持告警冷却期（cooldown），防止同一问题反复告警
- 支持告警恢复通知（问题解除后自动通知）
- 监控任务运行不影响 Agent 的正常响应性能（独立调度线程/协程）
- 支持将一组监控结果聚合为单个事件批次，降低高频场景下的上下文噪音

---

### 3.4 Memory System（记忆系统）

**设计目标**：让 OMBot 具备"运维经验"，能够回答"上周 CPU 有几次超载？""这个服务上个月重启了多少次？"等历史性问题。

**设计调整**

基于对 `pi-mono` 的分析，OMBot 的记忆系统不在 MVP 阶段直接依赖完整的向量记忆方案，而采用"先会话、后长期、再语义"的分阶段路线。

结合 `openclaw` 的经验，OMBot 进一步明确：**上下文、会话记录、长期记忆、工作区文档不是同一层能力**，必须分别建模。

**三层记忆架构**

| 层级 | 存储内容 | 保留时长 | 存储介质 | 查询方式 |
|---|---|---|---|---|
| **工作记忆** | 当前对话上下文、本次会话的工具调用记录 | 会话结束即清除 | 内存 | - |
| **短期记忆** | Session Log、工具结果、上下文摘要、近期监控快照 | 滚动保留 1 个月 | JSONL + 本地文件 | 会话回放、摘要重建 |
| **长期记忆** | 异常事件、重要操作记录、系统变化趋势摘要 | 永久保留 | SQLite | 结构化查询 |
| **语义记忆** | 日志片段、历史问答、操作经验摘要 | Phase 3 引入 | 向量数据库 | 语义相似度检索 |

**Session 设计**

- 参考 pi-mono 的 append-only session tree 设计，使用 `entry + parentId` 的方式持久化会话，而不是只保留平铺消息数组
- 支持 `message`、`tool_result`、`compaction_summary`、`custom_event`、`audit_record` 等 entry 类型
- 通过从当前叶子节点回溯构建上下文，支持分支会话、回放、压缩和审计

**长期记忆形态**

- 结构化长期记忆：保存在 SQLite 中，记录异常、操作、趋势摘要、审批记录等
- 文档型长期记忆：保存在工作区 Markdown 文档中，用于沉淀经验、结论、运行手册更新
- 语义记忆：对日志片段、历史问答、经验摘要做 embedding，供 `memory_search` 类工具按需召回

**记忆写入时机**

- 每次监控异常事件发生
- 每次执行了系统操作（重启服务等）
- 用户与 OMBot 的对话（可配置是否记录）
- Monitor Engine 的定期状态快照（可配置频率）
- Agent 生成阶段性摘要或自动压缩上下文时

**记忆检索**

- Agent 在回答用户问题时，自动检索相关记忆作为上下文
- 支持用户直接提问："帮我看看上周磁盘使用情况的变化趋势"
- 长期记忆和故障案例不默认全部注入上下文，而是通过检索工具按需召回

**压缩前沉淀**

- 当上下文接近压缩阈值时，先触发一次静默整理
- 将本轮运维判断、已执行动作、待跟踪事项和可复用经验写入长期记忆或工作区
- 再进行上下文压缩，避免重要运维结论在压缩过程中丢失

**实现路线**

- **Phase 1**：先落地工作记忆 + Session Log + SQLite 审计/异常仓库
- **Phase 2**：增加自动摘要、趋势聚合、按服务/主机维度的结构化查询
- **Phase 3**：再接入向量数据库，为自然语言问答补充语义检索能力

> **实现参考**：会话层优先借鉴 pi-mono 的 session / compaction 思路；长期记忆与语义记忆的技术细节，待结合 openclaw 再进一步完善。

---

### 3.5 Communication Layer（通信层）

**分阶段实现**

**Phase 1（当前）**：本地 CLI 交互，日志输出  
**Phase 2**：WebSocket Server，为后续客户端提供双向通信接口  
**Phase 3**：接入企业微信 Bot、飞书 Bot、短信等通知渠道

**设计原则**

- 外部协议采用 WebSocket，但事件粒度参考 pi-mono 的 RPC / event stream 设计，并结合 openclaw 的 Gateway req/res/event 模型
- 一个会话对应一个上下文实例；通知型消息与可对话型消息通道要区分
- 通信层只负责消息编排、认证、会话路由和事件转发，不承载业务决策
- Gateway 持有客户端连接、审批状态、会话映射和事件订阅关系，是通信与控制的统一宿主

**Gateway 协议设计（Phase 2）**

```
Client (App / Web)
    ↕ WebSocket
OMBot Gateway (ws://localhost:PORT)
    ↕
Agent Core
```

**握手与角色**

- 首帧应完成 `connect` / `challenge` 握手
- 握手信息至少包含：`client_type`、`role`、`auth`、`device_id`、`scopes`
- 角色初步分为：
  - `operator`：CLI、Web、移动端等运维操作端
  - `channel`：企业微信、飞书等可对话接入端
  - `worker`：后续可能引入的专用执行节点、边缘采集器或辅助运行节点
- 本地 loopback 可配置为自动信任，远程客户端默认需要配对或审批

**消息格式（JSON，Phase 2 建议版）**

- `req`：客户端主动请求
- `res`：对请求的响应
- `event`：服务端主动推送事件
- 对有副作用的请求建议携带 `idempotency_key`

```jsonc
// 客户端 -> Gateway 请求
{
  "type": "req",
  "id": "req_001",
  "method": "agent.sendMessage",
  "params": {
    "session_id": "xxx",
    "content": "现在服务器状态怎么样？"
  }
}

// Gateway -> 客户端响应
{
  "type": "res",
  "id": "req_001",
  "ok": true
}

// Gateway -> 客户端事件：Agent 启动
{
  "type": "event",
  "event": "agent.start",
  "payload": {
    "session_id": "xxx"
  }
}

// Gateway -> 客户端事件：流式消息片段
{
  "type": "event",
  "event": "agent.message_update",
  "payload": {
    "session_id": "xxx",
    "content": "正在检查各服务状态..."
  }
}

// Gateway -> 客户端事件：工具开始执行
{
  "type": "event",
  "event": "tool.execution_start",
  "payload": {
    "session_id": "xxx",
    "tool_name": "get_process_status",
    "tool_call_id": "call_001"
  }
}

// Gateway -> 客户端事件：需要确认
{
  "type": "event",
  "event": "approval.required",
  "payload": {
    "session_id": "xxx",
    "action": "restart_service",
    "reason": "该操作将重启 nginx 服务"
  }
}

// Gateway -> 客户端事件：主动推送告警
{
  "type": "event",
  "event": "monitor.alert",
  "payload": {
    "severity": "warning",
    "content": "nginx 进程已停止，已自动尝试重启",
    "timestamp": "2026-03-06T10:00:00Z"
  }
}
```

**HTTP 辅助接口**

- WebSocket 作为主控制协议
- HTTP 提供辅助接口，例如健康检查、配置验证、只读查询、OpenAI/OpenResponses 兼容层
- 所有协议入口最终收敛到同一 Agent / Session / Tool 执行主线

**通知渠道适配器（Phase 3）**

- 每个渠道实现统一的 `NotificationAdapter` 接口
- 支持在告警规则中指定使用哪个渠道
- 渠道配置存于独立配置文件，包含 token、webhook 等敏感信息（支持环境变量引用）
- 可对话渠道与纯通知渠道分开建模，短信默认只作为通知 sink，不承载复杂多轮上下文

```yaml
# config/notification_channels.yaml 示例
channels:
  wechat_work:
    type: wechat_work_bot
    webhook_url: "${WECHAT_WORK_WEBHOOK}"

  feishu:
    type: feishu_bot
    webhook_url: "${FEISHU_WEBHOOK}"

  sms:
    type: sms_aliyun
    access_key: "${ALIYUN_ACCESS_KEY}"
    secret: "${ALIYUN_SECRET}"
    sign_name: "OMBot"
    template_code: "SMS_XXXXXX"
    phones:
      - "138xxxxxxxx"
```

---

## 四、配置文件体系

OMBot 的所有行为通过配置文件控制，配置文件存放于 `config/` 目录：

```
config/
├── ombot.yaml            # 主配置（LLM 设置、系统参数等）
├── monitors.yaml         # 监控规则
├── remote_adapters.yaml  # 远程服务器适配器
├── notification_channels.yaml  # 通知渠道
└── .env                  # 敏感信息（token、api key 等）
```

**配置分层原则**

- `config/` 中的 YAML 负责业务配置
- `.env` 负责密钥、token、地址等敏感信息
- 运行时生成的 session、审计和状态文件独立存放于 `data/` 目录，不与业务配置混放
- 后续如需项目级覆盖，可借鉴 pi-mono 的全局/项目双层配置合并思路
- 插件、渠道、记忆后端等可扩展组件必须有独立 manifest 与 schema 校验，不依赖运行插件代码后才发现配置错误
- 对 secrets 的热重载应保留 `last-known-good` 快照，避免临时配置错误直接打崩常驻进程

**插件 / 扩展约束**

- 每个插件必须提供 manifest，至少声明：`id`、`kind`、`version`、`configSchema`
- manifest 需要声明可注册的能力类型，例如工具、通知渠道、记忆后端、Gateway 方法
- 插件发现阶段就应完成路径边界、来源可信度、manifest 合法性检查
- `memory` 这类核心后端能力建议采用 slot 模型，同一时间只激活一个实现

**主配置示例**：

```yaml
# config/ombot.yaml
llm:
  provider: openai
  model: gpt-4o
  api_key: "${OPENAI_API_KEY}"
  base_url: "https://api.openai.com/v1"  # 可替换为代理地址

agent:
  system_prompt: |
    你是 OMBot，一个专业的服务器运维监控助手。
    你运行在 [hostname] 上，拥有该服务器的 root 权限。
    你的职责是监控服务器状态，在发现问题时主动告警，
    并协助运维人员分析和解决问题。
  max_context_length: 32000

memory:
  short_term_retention_days: 30
  snapshot_interval: 1h   # 状态快照频率

server:
  ws_port: 8765
  http_port: 8766          # 可选的 HTTP API 端口

logging:
  level: info
  file: logs/ombot.log
  max_size_mb: 100
  retention_days: 30
```

---

## 五、目录结构规划（初步）

```
OMBot/
├── docs/
│   └── requirements.md        # 本文件
├── src/
│   ├── gateway/               # Gateway / Control Plane
│   │   ├── index.ts
│   │   ├── ws_server.ts
│   │   ├── http_server.ts
│   │   ├── protocol.ts
│   │   └── sessions.ts
│   ├── agent/                 # Agent Core
│   │   ├── index.ts
│   │   ├── prompts.ts
│   │   ├── runtime.ts         # Agent runtime 组装
│   │   └── session.ts         # Session 上下文管理
│   ├── tools/                 # 工具注册
│   │   ├── registry.ts        # 工具注册中心
│   │   ├── policy.ts          # 工具风险策略层
│   │   ├── local/             # 内置本机工具
│   │   │   ├── process.ts
│   │   │   ├── resource.ts
│   │   │   ├── network.ts
│   │   │   └── service.ts
│   │   └── remote/            # 远程适配器
│   │       └── adapter.ts
│   ├── monitor/               # 监控调度引擎
│   │   ├── engine.ts
│   │   ├── scheduler.ts
│   │   └── events.ts          # 监控事件模型
│   ├── memory/                # 记忆系统
│   │   ├── index.ts
│   │   ├── working.ts
│   │   ├── session_store.ts   # JSONL session log
│   │   ├── long_term.ts       # SQLite 仓库
│   │   ├── summaries.ts       # 自动摘要/压缩
│   │   └── vector_store.ts    # Phase 3 引入
│   ├── communication/         # 通信层
│   │   ├── routing.ts         # 渠道路由与连接管理
│   │   ├── approvals.ts       # 审批与确认流程
│   │   └── channels/          # 通知渠道适配器
│   │       ├── base.ts
│   │       ├── wechat_work.ts
│   │       ├── feishu.ts
│   │       └── sms.ts
│   ├── config/                # 配置加载与校验
│   │   └── loader.ts
│   ├── llm/                   # 模型/provider 管理
│   │   └── provider.ts
│   ├── extensions/            # 扩展与插件挂载点
│   │   ├── index.ts
│   │   ├── loader.ts
│   │   ├── manifest.ts
│   │   └── runtime.ts
│   ├── audit/                 # 审计与操作留痕
│   │   └── logger.ts
│   └── index.ts               # 入口文件
├── config/                    # 配置文件
│   ├── ombot.yaml
│   ├── monitors.yaml
│   ├── remote_adapters.yaml
│   ├── notification_channels.yaml
│   └── .env.example
├── data/
│   ├── sessions/              # JSONL 会话日志
│   ├── audit/                 # 审计日志 / SQLite
│   ├── memory/                # 记忆与摘要数据
│   └── runtime/               # 运行态快照、队列与缓存
├── workspace/
│   ├── RUNBOOK.md
│   ├── HOST_PROFILE.md
│   ├── ALERT_POLICY.md
│   ├── TOOLS.md
│   └── USER.md
├── plugins/
│   └── README.md              # 插件与 manifest 约定
├── scripts/                   # 安装/卸载/管理脚本
│   ├── install.sh
│   └── uninstall.sh
├── package.json
├── tsconfig.json
└── README.md
```

---

## 六、开发阶段规划

### Phase 1：本机监控核心（MVP）

**目标**：OMBot 可以作为本地 CLI 工具运行，具备完整的本机监控和 AI 对话能力。

**交付内容**：
- [ ] 项目脚手架搭建（基于 `pi-agent-core` / `pi-ai` 的最小集成）
- [ ] 配置文件加载系统
- [ ] 内置本机监控工具集
- [ ] Tool Policy Layer（风险分级、确认、审计）
- [ ] Monitor Engine（定时调度 + 阈值告警 + 事件投递）
- [ ] Agent Core（LLM + Function Calling + 工具调用 + Session）
- [ ] CLI 交互界面（本地测试用）
- [ ] Session Log 与基础审计系统

### Phase 2：远程服务器接入

**目标**：支持通过配置文件注册远程监控接口，统一纳入 Agent 工具链。

**交付内容**：
- [ ] 远程适配器配置解析
- [ ] 远程工具动态注册机制
- [ ] 热重载支持
- [ ] 远程接口鉴权（Bearer Token / Basic Auth）
- [ ] 监控事件队列与会话路由
- [ ] WebSocket 流式协议初版
- [ ] Gateway 握手、角色与配对模型
- [ ] Operator 控制台最小原型（会话列表 + 告警流）

### Phase 3：记忆系统

**目标**：OMBot 具备历史记忆，支持自然语言查询历史状态。

**交付内容**：
- [ ] 工作记忆管理
- [ ] 长期记忆存储（SQLite）
- [ ] 自动摘要与趋势聚合
- [ ] 语义记忆存储（向量数据库）
- [ ] Agent 记忆检索工具

### Phase 4：通信层

**目标**：支持实时双向通信和多渠道通知。

**交付内容**：
- [ ] WebSocket Server 完整化
- [ ] HTTP 辅助接口与协议适配层
- [ ] 企业微信 Bot 适配器
- [ ] 飞书 Bot 适配器
- [ ] 短信适配器（阿里云/腾讯云）
- [ ] 多渠道会话隔离与权限策略
- [ ] 审批中心与工具执行过程展示

### Phase 5：移动端接入

**目标**：移动端 App 通过 WebSocket 与 OMBot 实现完整的双向交互。

**交付内容**：
- [ ] 告警接收与确认
- [ ] 只读排障查询
- [ ] 高风险操作二次确认
- [ ] 移动端会话与设备身份管理

---

## 七、已明确的技术路线（基于 pi-mono + openclaw）

### 7.1 明确采用的架构模式

- **Agent Runtime**：以 `pi-agent-core` 的主循环模型作为 OMBot 的 Agent Core 基础
- **LLM Provider 抽象**：以 `pi-ai` 的 provider / transport 抽象管理 OpenAI 及后续模型扩展
- **Session 持久化**：借鉴 `pi-coding-agent` 的 append-only session tree 与上下文重建机制
- **工具体系**：采用 schema 注册 + `execute()` 执行 + wrapper/policy 拦截的三层模型
- **Gateway 控制面**：借鉴 openclaw 的单一 Gateway 进程作为会话、连接、路由与事件的唯一真相源
- **事件通信**：对外 WebSocket 协议参考 `pi-mono` RPC 与 openclaw Gateway 的细粒度事件流设计
- **事件驱动监控**：监控引擎独立运行，以结构化事件方式触发 Agent 决策
- **插件宿主**：扩展能力通过 manifest + runtime facade 暴露，避免插件直接耦合内核实现

### 7.2 不直接照搬的部分

- 不直接引入 `pi-coding-agent` 的 TUI、主题、编码助手交互模式
- 不采用 `pi-mom` 偏全能 shell 自动化的高权限哲学
- 不把权限确认完全外包给扩展，OMBot 必须内建安全策略层
- 不在 MVP 阶段照搬完整记忆系统，而是先实现可审计、可回放、可摘要的基础会话层
- 不照搬 openclaw 的超宽聊天渠道生态、Canvas、移动节点与多媒体能力
- 不在早期引入过重的多 Agent 编排 DSL，而优先保证单 Agent + Gateway + 监控事件闭环

### 7.3 推荐依赖方向（初稿）

- Agent / LLM：`@mariozechner/pi-agent-core`、`@mariozechner/pi-ai`
- 配置与校验：`yaml`、`zod` 或 TypeBox
- WebSocket：`ws` 或基于 `fastify` / `fastify-websocket`
- 数据持久化：`better-sqlite3` 或 `sqlite3`
- 调度：`node-cron` 或 `cron-parser` + 自定义调度器
- 日志：`pino`
- HTTP 远程工具：`undici` 或 `axios`

### 7.4 仍待 openclaw 补充的内容

- [ ] OMBot Gateway 控制面设计：单一进程、会话真相源、客户端协议职责边界
- [ ] 上下文构建策略：system prompt、固定工作区注入、按需记忆召回、上下文可观测性
- [ ] 三层安全模型：execution environment / tool policy / approval-elevation
- [ ] 会话隔离与路由策略：按用户、按渠道、按主机、按事件源隔离
- [ ] 多角色 Agent 设计：问答 agent、巡检 agent、修复 agent、通知 agent
- [ ] 插件 manifest 与 schema 校验机制
- [ ] Operator Client / Control UI 的协议与权限模型

---

## 八、非功能性需求

| 需求 | 描述 |
|---|---|
| **性能** | 监控调度不影响 Agent 响应，告警延迟 < 5s |
| **稳定性** | OMBot 自身崩溃后可通过 systemd 自动重启 |
| **安全性** | 危险操作需确认；敏感配置通过环境变量注入；操作日志完整保留 |
| **可观测性** | OMBot 自身提供健康检查接口；完整结构化日志 |
| **易部署** | 提供一键安装脚本，支持注册为 systemd / launchd 服务 |
