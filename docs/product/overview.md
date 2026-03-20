# Product Overview

**验证状态**

- 产品定位：已稳定
- 主要运行形态：已实现
- 对外形态：当前以本地 CLI 为主

**核心理念**

- OMBot 是一个运行在 Unix 系统上的运维 Agent。
- 它的目标不是做传统监控面板，而是把：
  - 监控
  - 分析
  - 工具调用
  - 审批
  - 调度事件
  统一到一个 Agent 控制面里。

**当前实现方式**

当前 OMBot 的主要能力包括：

- 本地 CLI/TUI 对话
- 多 session 会话持久化
- Gateway 控制面
- monitor 定时检查
- 全局 event 调度
- 工具调用与审批
- 宿主环境快照
- 受控代码执行环境

当前主要交互路径：

```text
CLI -> Gateway -> Agent Runtime -> Tools
Monitor -> Gateway -> Agent Runtime
Events Watcher -> Gateway -> Agent Runtime
```

当前仍然以本地单进程使用为主，WebSocket、多端客户端、远程适配器仍未落地。
