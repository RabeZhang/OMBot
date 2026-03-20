# Session Transcript Audit

**验证状态**

- 实现状态：已落地主骨架
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/memory`, `src/audit`

**核心理念**

- session、transcript、audit 是三层不同对象：
  - session：会话路由和元数据
  - transcript：append-only 运行历史
  - audit：结构化安全与操作审计
- 不应把所有长期对象都塞进 session。

**当前实现方式**

当前支持：

- session 索引文件
- transcript JSONL
- SQLite audit
- 删除 session 时清理 transcript

当前 transcript 中已记录：

- 用户消息
- 助手消息
- tool call / result
- monitor event
- scheduled event
- approval
- summary

当前限制：

- 仍无长期记忆与语义检索
- 仍无专门的全局运行历史仓库
