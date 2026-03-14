# OMBot Events Integration Plan

## 目标

将 `pi-mom` 的事件能力以 OMBot 自己的控制面方式接入：

- 保留 `workspace/events/*.json` 的文件驱动模型
- 支持 `immediate`、`one-shot`、`periodic`
- 事件触发后统一进入 `Gateway -> Agent -> Transcript/Audit`
- 不引入 `pi-mom` 的 Slack / ChannelQueue 依赖

## 当前实现状态

已完成：

- `one-shot` 和 `periodic` 事件解析与调度
- `immediate` 事件调度入口
- 启动扫描、文件监听、修改重调度、删除取消
- `scheduled_event` 输入链路
- CLI 最小事件管理命令

待继续增强：

- `immediate` 外部 webhook 示例与适配器
- `one-shot` / `periodic` 的 CLI 创建命令
- 事件失败审计与重试策略
- `[SILENT]` 语义
- 事件并发与队列上限

## 架构

```text
workspace/events/*.json
        |
        v
EventsWatcher
  - startup scan
  - fs.watch
  - setTimeout
  - Croner
        |
        v
Gateway.dispatchScheduledEvent()
        |
        v
Agent Runtime
        |
        v
Transcript / Audit / CLI
```

## 事件类型

### 1. Immediate

用于“现在就处理”的外部事件或手工触发事件。

```json
{
  "type": "immediate",
  "text": "收到一个新的外部告警，请检查 nginx 状态",
  "profile": "readonly",
  "metadata": {
    "source": "webhook"
  }
}
```

可选字段：

- `sessionId`: 复用已有 session
- `title`: 创建新 session 时的标题
- `profile`: 默认 `readonly`
- `metadata`: 透传给 agent/transcript 的扩展信息

### 2. One-Shot

用于某个确定时间触发一次的任务。

```json
{
  "type": "one-shot",
  "text": "今晚 23:30 检查磁盘使用率并给出总结",
  "at": "2026-03-13T23:30:00+08:00",
  "profile": "readonly"
}
```

要求：

- `at` 必须带时区偏移

### 3. Periodic

用于周期任务。

```json
{
  "type": "periodic",
  "text": "每天早上 9 点总结主机 CPU、内存、磁盘状态",
  "schedule": "0 9 * * *",
  "timezone": "Asia/Shanghai",
  "profile": "readonly"
}
```

要求：

- `schedule` 使用标准 cron
- `timezone` 可选，未提供时使用 `ombot.yaml` 中的 `events.default_timezone`

## CLI 命令

当前已支持：

- `/events`
  - 列出事件文件
- `/events show <file>`
  - 查看事件文件内容
- `/event rm <file>`
  - 删除事件文件

说明：

- 事件创建的主入口应是 Agent tool，而不是 CLI 命令。
- CLI 只保留查看和删除这类管理能力。
- 若 `events.enabled=false`，CLI 仍可查看和删除事件文件，但 watcher 不会自动处理它们。

## Agent Tools

Agent 当前应通过以下工具管理事件：

- `create_event`
- `list_events`
- `read_event`
- `delete_event`

## 示例事件文件

推荐放在：

```text
workspace/events/
```

示例：

- `manual-check.json`
- `nightly-disk-check.json`
- `daily-summary.json`

文件命名建议：

- 使用描述性英文名
- 以 `.json` 结尾
- 避免空格和特殊字符

## 配置

`config/ombot.yaml`：

```yaml
events:
  enabled: true
  dir: "./workspace/events"
  default_timezone: "Asia/Shanghai"
  max_queued_per_session: 5
  startup_scan: true
```

## 行为约定

- `immediate`
  - 旧文件在启动时按 stale 文件处理，不重复执行
- `one-shot`
  - 过去时间直接删除
- `periodic`
  - 不补跑 OMBot 停机期间错过的触发
- 文件修改
  - 取消旧调度后重新解析和调度
- 文件删除
  - 对应 timer/cron 一并取消
