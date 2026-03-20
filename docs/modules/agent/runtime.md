# Agent Runtime

**验证状态**

- 实现状态：已落地主链
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/agent`

**核心理念**

- Agent Runtime 是 OMBot 的推理和 tool-calling 核心。
- 它不直接拥有系统权限，而是通过 Gateway 输入和 tools 暴露能力。
- Runtime 需要能同时处理：
  - 用户消息
  - monitor 事件
  - scheduled event

**当前实现方式**

当前主实现：

- `PiAgentRuntimeAdapter`
- `FakeAgentRuntimeAdapter`
- prompt context 由宿主系统预先构建

当前输入类型包括：

- `user_message`
- `monitor_event`
- `scheduled_event`

当前 prompt 组成：

- system prompt
- 当前本地时间 / 时区
- 固定注入的 workspace 文档
- 按需附加的 session 历史

当前限制：

- 仍未实现更细的输入队列语义
- 仍未实现更高级的 compaction / interrupt / followup 模型
