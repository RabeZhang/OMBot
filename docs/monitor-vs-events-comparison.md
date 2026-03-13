# OMBot 监控系统 vs pi-mom 事件系统对比分析

## 目录

1. [架构定位对比](#架构定位对比)
2. [核心能力对比](#核心能力对比)
3. [实现机制对比](#实现机制对比)
4. [使用场景对比](#使用场景对比)
5. [OMBot 监控系统详解](#ombot-监控系统详解)
6. [pi-mom 事件系统详解](#pi-mom-事件系统详解)
7. [融合建议](#融合建议)

---

## 架构定位对比

| 维度 | OMBot Monitor | pi-mom Events |
|------|---------------|---------------|
| **定位** | 系统健康监控引擎 | 通用事件调度系统 |
| **触发方式** | 主动轮询（Pull） | 事件驱动（Push） |
| **时间精度** | 分钟级（interval） | 秒级（cron） |
| **持久化** | 配置文件（YAML） | 事件文件（JSON） |
| **与 Agent 关系** | 旁路通知（通过 Gateway） | 直接入队（ChannelQueue） |

### 架构图示

```
OMBot Monitor 架构:
┌─────────────────────────────────────────────────────────────┐
│                    Monitor Engine                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ setInterval │  │ setInterval │  │ setInterval │  ...     │
│  │   (CPU)     │  │  (Memory)   │  │   (HTTP)    │          │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
└─────────┼────────────────┼────────────────┼─────────────────┘
          │                │                │
          ▼                ▼                ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  Check CPU  │ │ Check Memory│ │  Check HTTP │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                           ▼
                  ┌─────────────────┐
                  │  State Machine  │
                  │ (cooldown/recover)
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │  TUI显示  │    │  Gateway  │    │  日志记录 │
    └──────────┘    └──────────┘    └──────────┘

pi-mom Events 架构:
┌─────────────────────────────────────────────────────────────┐
│                  Events Watcher                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           fs.watch('workspace/events/')             │   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │immediate │    │ one-shot │    │ periodic │
    │  (JSON)  │    │  (JSON)  │    │  (JSON)  │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │立即执行  │    │setTimeout│    │  Croner  │
    └────┬─────┘    └────┬─────┘    └────┬─────┘
         │               │               │
         └───────────────┼───────────────┘
                         ▼
                ┌─────────────────┐
                │  ChannelQueue   │
                │  (最多5个排队)   │
                └────────┬────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │ Agent 执行   │
                  └──────────────┘
```

---

## 核心能力对比

### 1. 事件类型支持

| 类型 | OMBot Monitor | pi-mom Events | 说明 |
|------|---------------|---------------|------|
| **定时轮询** | ✅ `interval: 60s` | ✅ `periodic: "*/1 * * * *"` | 两者都支持 |
| **一次性任务** | ❌ 不支持 | ✅ `one-shot` | 指定时间执行一次 |
| **即时事件** | ❌ 不支持 | ✅ `immediate` | 文件创建立即触发 |
| **Cron 表达式** | ❌ 不支持 | ✅ 支持标准 cron | 更灵活的调度 |
| **动态添加** | ❌ 需重启 | ✅ 文件即创建 | pi-mom 支持运行时添加 |
| **动态修改** | ❌ 需重启 | ✅ 修改即更新 | pi-mom 监听文件变化 |

### 2. 检查能力对比

| 检查项 | OMBot Monitor | pi-mom Events |
|--------|---------------|---------------|
| **进程监控** | ✅ 内置 | ❌ 需自行实现 |
| **资源监控** | ✅ CPU/内存/磁盘 | ❌ 需自行实现 |
| **端口监控** | ✅ 内置 | ❌ 需自行实现 |
| **HTTP 监控** | ✅ 内置 | ❌ 需自行实现 |
| **日志监控** | ❌ 不支持 | ✅ 可用 immediate |
| **文件变化** | ❌ 不支持 | ✅ fs.watch |
| **外部 Webhook** | ❌ 不支持 | ✅ immediate 事件 |

### 3. 状态管理对比

| 特性 | OMBot Monitor | pi-mom Events |
|------|---------------|---------------|
| **Cooldown** | ✅ 内置 | ❌ 需自行实现 |
| **恢复通知** | ✅ 自动 | ❌ 需自行实现 |
| **连续失败统计** | ✅ 支持 | ❌ 需自行实现 |
| **状态持久化** | ✅ 内存状态 | ❌ 无状态 |

---

## 实现机制对比

### OMBot Monitor 实现

```typescript
// 1. 配置驱动（config/ombot.yaml）
monitors:
  - id: cpu_high
    name: CPU 使用率告警
    type: resource
    target:
      metric: cpu_usage
    threshold:
      operator: ">"
      value: 80
    interval: 60s      # 每60秒检查
    cooldown: 5m       # 5分钟内不重复告警

// 2. 状态机管理
interface MonitorRuleState {
  lastRunAt: string | null;
  lastOk: boolean | null;
  cooldownUntil: string | null;
  consecutiveFailures: number;
}

// 3. 独立引擎运行
class MonitorEngine {
  async start() {
    for (const rule of rules) {
      // 每个规则一个 setInterval
      const timer = setInterval(() => this.runCheck(rule), intervalMs);
    }
  }
}
```

**特点**：
- 配置文件集中管理
- 启动时加载，修改需重启
- 内置状态机（cooldown、恢复检测）
- 独立于 Agent 运行

### pi-mom Events 实现

```typescript
// 1. 文件驱动（workspace/events/*.json）
// cpu-check.json
{
  "type": "periodic",
  "channelId": "monitor",
  "text": "Check CPU usage",
  "schedule": "*/1 * * * *",
  "timezone": "Asia/Shanghai"
}

// 2. 文件系统监听
class EventsWatcher {
  start() {
    fs.watch(this.eventsDir, (event, filename) => {
      if (event === 'add') this.handleFile(filename);
      if (event === 'change') this.handleFile(filename);
      if (event === 'unlink') this.handleDelete(filename);
    });
  }
}

// 3. 入队等待执行
execute(filename, event) {
  const message = `[EVENT:${filename}:${event.type}] ${event.text}`;
  slack.enqueueEvent({ channelId: event.channelId, text: message });
}
```

**特点**：
- 文件分散管理
- 运行时动态增删改
- 无内置状态管理
- 直接入队 Agent 执行

---

## 使用场景对比

### OMBot Monitor 适合场景

1. **系统健康监控**
   - CPU/内存/磁盘使用率
   - 关键进程存活检查
   - 服务端口监听状态

2. **固定周期检查**
   - 每5分钟检查一次
   - 需要 cooldown 防止告警风暴
   - 需要自动恢复通知

3. **运维监控大屏**
   - TUI 实时显示监控状态
   - 集中管理所有监控规则

### pi-mom Events 适合场景

1. **定时任务调度**
   - 每天9点生成报告
   - 每周一清理日志
   - 工作日每15分钟检查邮箱

2. **事件驱动响应**
   - 新邮件到达通知
   - GitHub webhook 触发
   - 日志文件变化处理

3. **动态任务管理**
   - 临时添加一次性提醒
   - 动态调整检查频率
   - 外部系统触发

---

## OMBot 监控系统详解

### 核心组件

```
src/monitor/
├── types.ts      # 类型定义 + 状态管理
├── engine.ts     # 监控引擎（调度器）
└── runners.ts    # 具体检查执行器
```

### 状态机设计

```
         ┌─────────────┐
         │   初始状态   │
         └──────┬──────┘
                │
                ▼
    ┌───────────────────────┐
    │      第一次检查        │
    └───────┬───────┬───────┘
            │       │
        正常 ▼       ▼ 失败
    ┌──────────┐  ┌──────────┐
    │ 正常状态  │  │ 告警状态  │◄──────┐
    └────┬─────┘  └────┬─────┘       │
         │             │             │
    失败 ▼        继续失败           │
    ┌──────────┐  ┌──────────┐       │
    │ 告警状态  │  │ cooldown │───────┘
    └────┬─────┘  └──────────┘ (静默)
         │
    恢复 ▼
    ┌──────────┐
    │ 恢复通知  │
    └────┬─────┘
         │
         ▼
    ┌──────────┐
    │ 正常状态  │
    └──────────┘
```

### 配置示例

```yaml
monitors:
  # 资源监控
  - id: cpu_high
    name: CPU 使用率过高
    type: resource
    target:
      metric: cpu_usage
    threshold:
      operator: ">"
      value: 80
    interval: 60s
    cooldown: 5m
    severity: warning

  # 进程监控
  - id: nginx_down
    name: Nginx 进程异常
    type: process
    target:
      processName: nginx
    interval: 30s
    cooldown: 2m
    severity: critical

  # HTTP 监控
  - id: api_health
    name: API 健康检查
    type: http
    target:
      url: http://localhost:3000/health
      expectedStatus: 200
      timeoutMs: 5000
    threshold:
      operator: ">"
      value: 1000
    interval: 30s
    cooldown: 1m
```

---

## pi-mom 事件系统详解

### 事件类型

#### 1. Immediate（即时事件）

```json
{
  "type": "immediate",
  "channelId": "alerts",
  "text": "收到新的支持工单 #12345"
}
```

- 文件创建立即触发
- 执行后自动删除
- 适合：Webhook、文件变化通知

#### 2. One-Shot（一次性事件）

```json
{
  "type": "one-shot",
  "channelId": "reminders",
  "text": "提醒：下午3点有会议",
  "at": "2026-03-13T15:00:00+08:00"
}
```

- 指定时间执行一次
- 支持时区偏移
- 执行后自动删除

#### 3. Periodic（周期性事件）

```json
{
  "type": "periodic",
  "channelId": "reports",
  "text": "生成每日系统报告",
  "schedule": "0 9 * * *",
  "timezone": "Asia/Shanghai"
}
```

- Cron 表达式调度
- 持久化到文件
- 需手动删除才停止

### 执行流程

```
1. 文件创建/修改
        │
        ▼
2. EventsWatcher 检测
        │
        ├── immediate → 立即入队
        ├── one-shot  → setTimeout
        └── periodic  → Cron 定时器
        │
        ▼
3. 事件入队 (ChannelQueue)
        │
        ├── 队列满（5个）→ 丢弃
        └── 队列有空位 → 等待
        │
        ▼
4. Agent 执行
        │
        ├── 返回 [SILENT] → 删除状态消息
        └── 正常返回 → 显示结果
```

---

## 融合建议

### 方案 A：保留 Monitor，扩展 Events（推荐）

**思路**：OMBot Monitor 专注于系统健康监控，引入 pi-mom Events 处理定时任务和外部事件。

**融合架构**：

```
┌─────────────────────────────────────────────────────────────┐
│                      OMBot                                  │
│  ┌─────────────────────┐  ┌─────────────────────────────┐  │
│  │   Monitor Engine    │  │     Events Watcher          │  │
│  │   (系统健康监控)     │  │     (定时任务+外部事件)      │  │
│  │                     │  │                             │  │
│  │ • CPU/Mem/Disk      │  │ • Cron 定时任务             │  │
│  │ • Process/Port/HTTP │  │ • One-shot 提醒             │  │
│  │ • Cooldown/Recover  │  │ • Immediate Webhook         │  │
│  └──────────┬──────────┘  └──────────────┬──────────────┘  │
│             │                            │                 │
│             └────────────┬───────────────┘                 │
│                          ▼                                 │
│                 ┌─────────────────┐                        │
│                 │  Gateway/EventBus│                       │
│                 └────────┬────────┘                        │
│                          │                                 │
│             ┌────────────┼────────────┐                   │
│             ▼            ▼            ▼                   │
│       ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│       │  TUI显示 │  │  Agent  │  │  日志   │              │
│       └─────────┘  └─────────┘  └─────────┘              │
└─────────────────────────────────────────────────────────────┘
```

**实施步骤**：

1. **引入 Events Watcher**
   ```typescript
   // src/events/watcher.ts
   import { EventsWatcher } from './events/watcher';

   const watcher = new EventsWatcher({
     eventsDir: './workspace/events',
     gateway,
   });
   await watcher.start();
   ```

2. **扩展 Gateway 支持事件入队**
   ```typescript
   interface Gateway {
     // 现有方法
     dispatchMonitorEvent(input: MonitorEventInput): Promise<...>;
     // 新增方法
     dispatchEvent(input: EventInput): Promise<...>;
   }
   ```

3. **Agent 消费事件**
   ```typescript
   // Agent 接收的消息格式
   "[EVENT:cpu-check.json:periodic:*/1 * * * *] Check CPU usage"
   ```

**优势**：
- Monitor 专注系统健康（自带状态机）
- Events 处理灵活调度（cron、webhook）
- 两者互补，不冲突

### 方案 B：Monitor 基于 Events 重构

**思路**：将 Monitor 的检查逻辑改为生成 periodic 事件文件。

```typescript
// Monitor 不再用 setInterval，而是生成事件文件
class MonitorEngine {
  start() {
    for (const rule of rules) {
      // 生成 periodic 事件文件
      const event = {
        type: 'periodic',
        channelId: 'monitor',
        text: `Check ${rule.name}`,
        schedule: this.convertIntervalToCron(rule.interval),
      };
      writeFile(`./workspace/events/${rule.id}.json`, JSON.stringify(event));
    }
  }
}
```

**缺点**：
- 失去 cooldown、恢复通知等状态管理能力
- 每个检查点需独立实现状态逻辑
- 状态分散在多个 Agent Session 中

### 方案 C：混合模式（监控专用通道）

**思路**：Monitor 保持独立，但支持生成 Events 供外部扩展。

```typescript
// Monitor 检测到异常时，可选择生成 Immediate Event
class MonitorEngine {
  async runCheck(rule) {
    if (!result.ok) {
      // 标准流程：通过 Gateway 通知
      await this.gateway.dispatchMonitorEvent({...});

      // 扩展：生成事件文件供外部系统消费
      await this.events.createImmediate({
        channelId: 'external-alerts',
        text: `Alert: ${rule.name}`,
      });
    }
  }
}
```

---

## 结论

| 维度 | 建议 |
|------|------|
| **系统健康监控** | 保留 OMBot Monitor（状态机、 cooldown） |
| **定时任务调度** | 引入 pi-mom Events（cron、one-shot） |
| **外部事件响应** | 引入 pi-mom Events（immediate、webhook） |
| **24小时监控** | **Monitor + Events 结合** |

### 24 小时自动监控实现

OMBot **已经具备** 24 小时自动监控能力：

```yaml
# config/ombot.yaml
monitors:
  # 每30秒检查关键进程
  - id: critical_processes
    name: 关键进程监控
    type: process
    target: { processName: nginx }
    interval: 30s
    cooldown: 2m

  # 每分钟检查资源
  - id: resource_check
    name: 资源使用监控
    type: resource
    target: { metric: cpu_usage }
    threshold: { operator: ">", value: 80 }
    interval: 60s
    cooldown: 5m

  # 每30秒检查HTTP
  - id: health_check
    name: 服务健康检查
    type: http
    target: { url: "http://localhost:3000/health" }
    interval: 30s
    cooldown: 1m
```

**启动后**：
- Monitor Engine 独立于 CLI 运行
- 即使不登录 CLI，监控也在后台运行
- 告警通过 EventBus 分发（可扩展 webhook、邮件通知）

**如需增强定时任务能力**，建议引入 pi-mom Events 系统作为补充。
