# OMBot Gateway 架构草案

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-06

---

## 一、文档目标

本文档用于明确 OMBot 中 `Gateway / Control Plane` 的职责边界、内部模块、协议模型和分阶段落地范围。

Gateway 不是单纯的 WebSocket 服务器，而是 OMBot 的统一宿主进程，负责将以下能力汇聚到同一控制平面：

- Agent 会话管理
- 监控事件接入与路由
- 客户端连接管理
- 工具调用事件流转发
- 审批与确认流程
- 通知渠道分发
- 配置、状态与运行期元数据的统一管理

---

## 二、为什么需要 Gateway

如果没有 Gateway，OMBot 很容易演变成下面这种分散结构：

- CLI 直接调用 Agent
- WebSocket 服务自己维护会话
- 通知渠道自己拼装消息与上下文
- 监控引擎直接触发 LLM

这种方式会带来几个明显问题：

- 会话历史分散，无法形成单一真相源
- 同一个告警在不同客户端中看到的上下文不一致
- 危险操作的审批无法统一追踪
- 客户端越来越多时，每个入口都要维护一套调用链
- 后续接移动端、企业微信、飞书时协议边界会失控

因此，OMBot 必须采用 **单一 Gateway 进程** 的设计：

- 所有入口都先进入 Gateway
- 所有会话状态都由 Gateway 维护
- 所有 Agent 执行事件都由 Gateway 广播或路由
- 所有高风险操作都由 Gateway 承担审批与审计职责

---

## 三、Gateway 的核心定位

### 3.1 角色定义

Gateway 是 OMBot 的：

- **控制平面**：统一管理连接、协议、会话、审批、运行状态
- **事件路由器**：接收监控事件、用户输入、通知回执，并投递给正确的 Agent 会话
- **宿主协调器**：为 Agent、Monitor Engine、Tool Policy、Memory System、Notification Adapter 提供统一运行上下文
- **状态真相源**：外部客户端不直接读写底层 session/transcript 文件，而通过 Gateway 协议获取数据

### 3.2 非职责

Gateway 不直接承担以下职责：

- 不负责 LLM 推理本身，推理由 Agent Runtime 执行
- 不负责监控采集本身，采集由 Monitor Engine 执行
- 不负责工具业务逻辑本身，工具执行由 Tool Runtime 执行
- 不负责长期记忆的具体存储实现，记忆由 Memory System 执行

Gateway 的职责是 **编排、路由、控制、审计、暴露协议**。

---

## 四、总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│                        OMBot Gateway                        │
│                                                             │
│  ┌────────────────────┐   ┌──────────────────────────────┐  │
│  │ Connection Manager │   │ Session Router               │  │
│  │ - WS / HTTP        │   │ - operator session map       │  │
│  │ - auth / pairing   │   │ - monitor event route        │  │
│  │ - scopes / roles   │   │ - channel binding            │  │
│  └────────────────────┘   └──────────────────────────────┘  │
│                                                             │
│  ┌────────────────────┐   ┌──────────────────────────────┐  │
│  │ Approval Center    │   │ Event Bus                    │  │
│  │ - confirm          │   │ - agent.*                    │  │
│  │ - elevate          │   │ - tool.*                     │  │
│  │ - audit            │   │ - monitor.*                  │  │
│  └────────────────────┘   └──────────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Agent Invocation Bridge                              │  │
│  │ - build context                                      │  │
│  │ - invoke agent runtime                               │  │
│  │ - subscribe stream                                   │  │
│  │ - persist session/transcript metadata                │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
               │               │                 │
               ▼               ▼                 ▼
         Agent Runtime    Monitor Engine    Notification Adapters
               │               │                 │
               ▼               ▼                 ▼
          Tool Runtime      Event Sources      External Channels
```

---

## 五、核心设计原则

### 5.1 单一执行主线

无论请求来自：

- CLI
- WebSocket operator client
- 企业微信 / 飞书 等渠道
- Monitor Engine 产生的系统事件

最终都应收敛到同一条执行主线：

1. Gateway 接收输入
2. 路由到目标会话或新建会话
3. 构建执行上下文
4. 调用 Agent Runtime
5. 接收 Agent 事件流
6. 写入会话、审计、记忆
7. 广播给订阅客户端或通知渠道

### 5.2 Gateway 是会话真相源

- 会话元数据由 Gateway 管理
- transcript 由 Gateway 统一创建、定位和归档
- 客户端只能通过 Gateway 获取会话信息
- 任一客户端断开重连后，仍能恢复相同会话视图

### 5.3 事件优于同步调用

Gateway 与外部客户端交互时，优先使用事件流，而不是一次请求只返回一个最终结果。

原因：

- Agent 是流式输出
- 工具执行可能耗时
- 高风险操作可能进入等待审批状态
- 监控告警本身就是主动推送事件

### 5.4 安全优先

Gateway 是高风险动作的最后一道编排边界：

- 危险工具调用不能绕过 Gateway
- 审批必须绑定会话与工具调用 ID
- 客户端权限与工具权限不能混淆
- 本地信任和远程信任要分开建模

---

## 六、内部模块设计

### 6.1 Connection Manager

负责：

- WebSocket 连接管理
- HTTP 接口管理
- 鉴权、配对、token 校验
- 连接角色与 scope 管理
- 心跳、断线重连、连接状态广播

角色建议：

- `operator`
  - 人类运维操作端
  - 可以查询状态、发起对话、审批操作
- `channel`
  - 企业微信 / 飞书 等可对话渠道
  - 权限通常受限于绑定配置
- `worker`
  - 后续可能出现的边缘采集器、专用执行节点、辅助运行时

关键数据：

- `connectionId`
- `deviceId`
- `role`
- `scopes`
- `authContext`
- `sessionBindings`

### 6.2 Session Router

负责：

- 新建会话
- 恢复已有会话
- 将监控事件路由到指定会话或系统会话
- 将通知渠道消息绑定到正确会话
- 控制多用户、多渠道下的上下文隔离

建议的会话隔离维度：

- 用户
- 渠道
- 主机
- 告警源
- Agent profile

### 6.3 Approval Center

负责：

- 接收工具执行前的审批请求
- 将审批请求转发到合适客户端
- 处理 `approve / deny / allow_once / allow_for_session`
- 记录审批日志
- 生成提权窗口的生命周期

审批状态建议字段：

- `approvalId`
- `toolCallId`
- `sessionId`
- `requestedBy`
- `riskLevel`
- `status`
- `expiresAt`
- `resolution`

### 6.4 Event Bus

负责：

- 统一发布和订阅系统内事件
- 降低 Gateway 与 Agent、Monitor、Notification 之间的直接耦合

建议事件主题：

- `agent.start`
- `agent.message_update`
- `agent.end`
- `tool.execution_start`
- `tool.execution_update`
- `tool.execution_end`
- `monitor.alert`
- `monitor.recovered`
- `approval.required`
- `approval.resolved`
- `gateway.connection.changed`

### 6.5 Agent Invocation Bridge

负责：

- 将 Gateway 请求转成 Agent Runtime 可理解的输入
- 在调用前构建上下文
- 监听 Agent 事件流并转换成 Gateway 事件
- 在执行结束后写入会话和审计层

它是 Gateway 与 Agent Runtime 的唯一桥接层，避免其他模块直接调用 Agent。

---

## 七、协议模型

### 7.1 通信形态

OMBot 采用：

- **WebSocket**：主控制协议，承载实时双向通信
- **HTTP**：辅助接口，承载健康检查、只读查询、配置校验、兼容 API

### 7.2 WebSocket 帧模型

统一采用三类帧：

- `req`
- `res`
- `event`

#### `req`

客户端主动请求。

```json
{
  "type": "req",
  "id": "req_001",
  "method": "agent.sendMessage",
  "params": {
    "session_id": "sess_001",
    "content": "现在服务器状态怎么样？"
  }
}
```

#### `res`

对 `req` 的同步响应，只表示请求是否被 Gateway 接受，不代表 Agent 已执行完成。

```json
{
  "type": "res",
  "id": "req_001",
  "ok": true
}
```

#### `event`

服务端主动推送事件，用于流式消息、工具执行、监控告警和审批状态。

```json
{
  "type": "event",
  "event": "agent.message_update",
  "payload": {
    "session_id": "sess_001",
    "content": "正在检查 nginx 与 API 服务状态..."
  }
}
```

### 7.3 握手与配对

连接建立后必须先完成握手。

握手信息至少包含：

- `protocol_version`
- `client_type`
- `role`
- `device_id`
- `auth`
- `scopes`

设计要求：

- 本地 loopback 可配置为自动信任
- 远程新设备默认需配对
- 设备 token 可轮换与吊销
- 角色升级、scope 升级需要重新鉴权或审批

### 7.4 建议的方法空间

推荐的 Gateway 方法前缀：

- `gateway.*`
- `agent.*`
- `session.*`
- `monitor.*`
- `approval.*`
- `config.*`

示例：

- `gateway.ping`
- `agent.sendMessage`
- `session.list`
- `session.get`
- `monitor.listActiveAlerts`
- `approval.resolve`
- `config.validate`

### 7.5 事件命名规范

建议统一使用 `<domain>.<action>` 风格：

- `agent.start`
- `agent.end`
- `tool.execution_start`
- `tool.execution_end`
- `monitor.alert`
- `monitor.recovered`
- `approval.required`
- `approval.resolved`
- `session.updated`

---

## 八、会话与路由设计

### 8.1 会话类型

建议至少区分三类会话：

- **interactive**
  - 人类主动对话
- **incident**
  - 某次告警触发后形成的事件会话
- **system**
  - 系统后台维护、摘要、巡检等内部会话

### 8.2 会话与 transcript 分层

参考 `openclaw` 的做法，建议拆成两层：

- **Session Store**
  - 保存会话元数据、状态、索引、绑定关系
- **Transcript Store**
  - 保存完整 append-only 会话记录

这样做的好处：

- 查询会话列表时不必加载完整 transcript
- 归档与压缩 transcript 更容易
- 会话元数据更适合做路由和权限控制

### 8.3 会话路由规则

初版建议：

- operator 主动发起的消息进入其绑定的 interactive session
- 同一告警在 cooldown 窗口内复用同一个 incident session
- 渠道回执或确认消息路由回对应 session
- 没有匹配会话时，创建新会话并返回 `session_id`

---

## 九、审批与高风险操作模型

### 9.1 审批不是工具逻辑的一部分

工具只声明：

- 风险级别
- 是否需要审批
- 是否允许预授权

真正的审批流程由 Gateway 统一负责。

### 9.2 审批状态机

建议状态：

- `pending`
- `approved_once`
- `approved_session`
- `denied`
- `expired`
- `executed`

### 9.3 高风险动作闭环

示例流程：

1. Agent 决定调用 `restart_service`
2. Tool Policy 判断需要审批
3. Gateway 生成 `approval.required`
4. operator 客户端确认
5. Gateway 记录审批结果
6. Tool Runtime 执行
7. 执行结果写入 transcript 与 audit
8. Gateway 推送 `approval.resolved` 与 `tool.execution_end`

---

## 十、与其他模块的边界

### 10.1 与 Agent Runtime 的边界

Gateway 负责：

- 输入路由
- 会话选择
- 审批编排
- 事件广播

Agent Runtime 负责：

- 推理
- 工具调用决策
- 流式消息产生
- 上下文消费

### 10.2 与 Monitor Engine 的边界

Gateway 不做采集与阈值判断。

Monitor Engine 负责：

- 周期采集
- 阈值检测
- 去重与冷却
- 形成结构化监控事件

Gateway 负责：

- 接收监控事件
- 决定路由到哪个会话
- 触发 Agent 分析或通知

### 10.3 与 Memory System 的边界

Gateway 不做记忆检索算法。

Gateway 负责：

- 决定什么时候写入记忆
- 决定哪些事件需要沉淀为长期记忆
- 为客户端暴露记忆相关查询接口

Memory System 负责：

- 存储
- 检索
- 摘要组织
- 向量召回

---

## 十一、Phase 1 对 Gateway 的最小要求

Phase 1 不追求完整多端控制面，只要求 Gateway 具备最小可用能力：

- 作为本地单进程宿主启动
- 提供 CLI 内部调用入口
- 统一创建与管理 session
- 统一接收 Monitor Engine 事件
- 调用 Agent Runtime 并订阅其事件
- 写入 session transcript 与 audit
- 支持最小审批流
- 预留 WebSocket 协议接口，但可以先不开放远程接入

换言之，**Phase 1 的 Gateway 更像内部控制总线**，而不是完整的远程控制平台。

---

## 十二、Phase 2 以后扩展方向

### 12.1 Phase 2

- 开放 WebSocket 协议
- 接入远程适配器
- 接入最小 Operator 控制台
- 增加连接角色与设备身份

### 12.2 Phase 3

- 记忆查询接口
- 告警流与会话流联动
- 自动摘要与回放支持

### 12.3 Phase 4+

- 企业微信 / 飞书 / 短信 渠道统一接入
- 审批中心 UI
- 多客户端并发查看同一会话
- 只读控制台与移动端控制端

---

## 十三、推荐落地结论

当前阶段，Gateway 应被视为 OMBot 的必选核心，而不是 Phase 2 以后才补的通信层。

推荐实施顺序：

1. 先实现内嵌式 Gateway 内核
2. 再让 CLI 与 Monitor Engine 全部走 Gateway
3. 再补 WebSocket 与 Operator UI
4. 最后再扩展多渠道与移动端

这个顺序可以保证 OMBot 从第一天起就是一个可扩展的控制平面，而不是后期再做“大迁移”。
