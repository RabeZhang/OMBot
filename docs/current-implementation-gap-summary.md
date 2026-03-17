# OMBot 当前实现与主要缺口总结

**版本**: v0.1  
**状态**: 工作总结  
**最后更新**: 2026-03-17

---

## 一、文档目标

本文档用于总结：

- 当前 OMBot 已经实际落地的主要能力
- 文档中仍然存在、但代码主链尚未完整实现的能力
- 各项缺口的优先级与建议推进顺序

本文档不是重新定义需求，而是作为“当前阶段真实完成度”的盘点。

---

## 二、当前已经实现的主要能力

### 2.1 基础运行形态

当前 OMBot 已经具备：

- 本地单进程启动
- CLI/TUI 交互入口
- 多 session
- Gateway 控制面骨架
- Transcript / Session / Audit 持久化

相关代码：

- [src/index.ts](/Users/zhangliang/PycharmProjects/OMBot/src/index.ts)
- [src/bootstrap.ts](/Users/zhangliang/PycharmProjects/OMBot/src/bootstrap.ts)
- [src/gateway/core.ts](/Users/zhangliang/PycharmProjects/OMBot/src/gateway/core.ts)
- [src/memory/session-store.ts](/Users/zhangliang/PycharmProjects/OMBot/src/memory/session-store.ts)
- [src/memory/transcript-store.ts](/Users/zhangliang/PycharmProjects/OMBot/src/memory/transcript-store.ts)
- [src/audit/sqlite-store.ts](/Users/zhangliang/PycharmProjects/OMBot/src/audit/sqlite-store.ts)

### 2.2 Agent 与工具调用

当前主运行链路已经是：

```text
CLI / Event -> Gateway -> PiAgentRuntimeAdapter -> Tools
```

当前已经可用的主要工具包括：

- 本机只读监控工具
  - `get_process_status`
  - `get_cpu_usage`
  - `get_memory_usage`
  - `get_disk_usage`
  - `get_port_status`
  - `check_http_endpoint`
- 文件与命令工具
  - `bash`
  - `read`
  - `edit`
  - `write`
  - `grep`
  - `find`
- 事件工具
  - `create_event`
  - `list_events`
  - `read_event`
  - `delete_event`

相关代码：

- [src/agent/pi-runtime.ts](/Users/zhangliang/PycharmProjects/OMBot/src/agent/pi-runtime.ts)
- [src/tools/pi-tools.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/pi-tools.ts)
- [src/tools/local/index.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/local/index.ts)
- [src/tools/local/events.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/local/events.ts)

### 2.3 Event 能力

当前 event 能力已经形成最小闭环：

- 支持 `immediate / one-shot / periodic`
- 支持事件文件监听与调度
- 支持 Agent 自然语言创建 event
- event 与创建它的 session 强绑定
- 删除 session 时会清理其绑定 event

相关代码：

- [src/events/watcher.ts](/Users/zhangliang/PycharmProjects/OMBot/src/events/watcher.ts)
- [src/events/parser.ts](/Users/zhangliang/PycharmProjects/OMBot/src/events/parser.ts)
- [src/events/files.ts](/Users/zhangliang/PycharmProjects/OMBot/src/events/files.ts)

### 2.4 安全执行第一版

当前 `bash / edit / write` 已经不是完全裸奔状态。

已经具备：

- 统一安全执行包装层
- 基础风险判断
- 审批中心
- `/approve` / `/deny`
- `/approval auto` / `/approval default`
- `deny` 后终止当前 run
- pending 审批持久化
- transcript / audit 中记录审批事实

相关代码：

- [src/tools/secure-execution.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/secure-execution.ts)
- [src/tools/risk-inspector.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/risk-inspector.ts)
- [src/gateway/approvals.ts](/Users/zhangliang/PycharmProjects/OMBot/src/gateway/approvals.ts)
- [src/tools/approval-mode.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/approval-mode.ts)
- [src/cli/repl.ts](/Users/zhangliang/PycharmProjects/OMBot/src/cli/repl.ts)

### 2.5 宿主环境认知第一版

当前已经有：

- 宿主环境快照采集
- `HOST_PROFILE.md` 自动刷新
- `environment.json` 落盘
- `/host`、`/host refresh`、`/host show`
- system prompt 知道 `HOST_PROFILE.md` 是宿主环境信息来源

相关代码：

- [src/host/collector.ts](/Users/zhangliang/PycharmProjects/OMBot/src/host/collector.ts)
- [src/host/files.ts](/Users/zhangliang/PycharmProjects/OMBot/src/host/files.ts)
- [src/host/render.ts](/Users/zhangliang/PycharmProjects/OMBot/src/host/render.ts)
- [config/prompts/system.txt](/Users/zhangliang/PycharmProjects/OMBot/config/prompts/system.txt)

---

## 三、部分实现但尚未闭环的能力

这些能力已经有一部分实现，但还没有达到文档中设想的完整状态。

### 3.1 安全执行与 Human-in-the-Loop

当前已经实现的是“第一版可用审批门禁”，但还没达到完整形态。

仍然缺少：

- 统一的参数级策略判断
- 更强的 `bash` 白名单 / 黑名单
- 执行环境选择层
- 面向未来 Python/TS 执行环境的统一安全抽象
- 更细粒度的高风险审计结构

对照文档：

- [safe-tool-execution-plan.md](/Users/zhangliang/PycharmProjects/OMBot/docs/safe-tool-execution-plan.md)
- [production-gap-analysis.md](/Users/zhangliang/PycharmProjects/OMBot/docs/production-gap-analysis.md)

### 3.2 本机资源监控准确性

这一块刚开始重做，现状比最早版本明显更好，但还不算彻底完成。

当前状态：

- CPU 已改为采样计算，不再只靠 load average
- Memory 已开始按 Linux/macOS 分流
- Disk 已补充 APFS 语义说明

仍然缺少：

- 更稳定的平台适配层结构化拆分
- 回答层对资源语义的更稳解释
- 更完整的 Linux/macOS 一致性输出
- 未来可能需要的 network / logs / service 相关本机事实工具

相关代码：

- [src/tools/local/resource.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/local/resource.ts)
- [src/monitor/runners.ts](/Users/zhangliang/PycharmProjects/OMBot/src/monitor/runners.ts)

### 3.3 宿主环境认知

Phase 1 已完成，但文档中更远一步的方向还没做：

- 暂未把宿主快照用于安全策略
- 暂未把宿主快照用于 Python/TS 执行环境选择
- 暂未做更复杂的环境能力建模

说明：

- 当前已明确不新增单独的 host tool
- 仍以 `HOST_PROFILE.md` + `read` 为主

对照文档：

- [host-environment-capability-plan.md](/Users/zhangliang/PycharmProjects/OMBot/docs/host-environment-capability-plan.md)

---

## 四、主要未实现能力

以下能力在文档中有明确规划，但当前代码主链基本还没有真正落地。

### 4.1 Monitor 事件自动进入 Agent 分析闭环

这是当前最明显的未完成项之一。

现状：

- Monitor Engine 能检测规则并产生日志/事件
- Gateway 能接收 monitor event
- 但 monitor event 目前仍未自动触发 LLM 分析

也就是说：

- “监控事件本身也是 Agent 输入”的这条链还没有完成

相关代码：

- [src/monitor/engine.ts](/Users/zhangliang/PycharmProjects/OMBot/src/monitor/engine.ts)
- [src/gateway/core.ts](/Users/zhangliang/PycharmProjects/OMBot/src/gateway/core.ts)

### 4.2 标准代码执行环境

目前 OMBot 还没有正式的：

- `python_run`
- `ts_run`
- 受控脚本运行环境

这意味着：

- 稍复杂的计算和处理逻辑仍容易被塞进 bash
- 未来高阶能力缺少稳定执行宿主

对照文档：

- [production-gap-analysis.md](/Users/zhangliang/PycharmProjects/OMBot/docs/production-gap-analysis.md)

### 4.3 远程服务器适配器

当前主链基本还是本机工具，没有真正实现文档里的远程 HTTP 适配器体系。

未实现内容包括：

- 远程目标配置驱动注册
- 远程监控工具适配
- 远程服务控制调用

对照文档：

- [requirements.md](/Users/zhangliang/PycharmProjects/OMBot/docs/requirements.md)

### 4.4 通信层与远程客户端

当前仍是：

- 本地 CLI / TUI 单进程使用

尚未实现：

- WebSocket Server
- HTTP API
- 远程 operator client
- 移动端
- 企业微信 / 飞书 / 短信渠道

对照文档：

- [gateway-architecture.md](/Users/zhangliang/PycharmProjects/OMBot/docs/gateway-architecture.md)
- [requirements.md](/Users/zhangliang/PycharmProjects/OMBot/docs/requirements.md)

### 4.5 更完整的 Memory System

当前已有：

- session
- transcript
- audit

但还没有：

- 趋势聚合
- 结构化长期记忆
- 语义检索
- 向量数据库

对照文档：

- [requirements.md](/Users/zhangliang/PycharmProjects/OMBot/docs/requirements.md)

### 4.6 输入队列语义与更高级会话控制

文档里提过的这些能力目前都没有真正落地：

- `steer`
- `followup`
- `interrupt`
- 更完整的并发输入队列管理
- 会话压缩/compaction 可观测性

对照文档：

- [requirements.md](/Users/zhangliang/PycharmProjects/OMBot/docs/requirements.md)

### 4.7 文档中提到但代码里尚未具备的本机工具

当前文档里出现过、但当前主链没有完整实现的工具包括：

- `get_network_stats`
- `get_system_logs`
- `restart_service`
- `stop_service`
- `execute_shell`（以受控服务形式出现）

说明：

- 当前真正稳定可用的主工具集，仍以本机只读监控工具 + pi-mom 文件/命令工具 + event tools 为主

---

## 五、当前最主要的功能缺口

如果只按“最影响实际可用性”的标准看，当前最主要的未完成项是：

1. **监控事件自动进入 Agent 分析闭环**
2. **安全执行层从第一版演进到完整门禁体系**
3. **本机资源监控准确性继续收敛**
4. **标准 Python / TS 执行环境**
5. **远程服务器适配器**
6. **WebSocket / 通知渠道 / 远程客户端**

---

## 六、建议优先级

### P0

- Monitor 事件自动进入 Agent 分析
- 安全执行层继续补强
- 本机资源监控准确性继续收敛

### P1

- 标准代码执行环境
- 远程服务器适配器
- 更完整的 Memory System

### P2

- WebSocket / HTTP 通信层
- 通知渠道适配器
- 移动端 / 多客户端接入
- 更高级输入队列语义

---

## 七、结论

当前 OMBot 已经不是“只有设计稿”的状态，而是已经具备：

- 可运行的本地 Agent
- 多 session
- 本机工具调用
- event 调度
- 基础审批
- 宿主环境认知

但距离“可长期稳定用于真实运维场景”的版本，仍然差几条主线：

- **监控闭环**
- **安全闭环**
- **事实可靠性**
- **标准执行环境**

后续开发不应再优先堆零散功能，而应围绕这几条主线继续收口。
