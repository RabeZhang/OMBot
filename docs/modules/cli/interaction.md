# CLI Interaction

**验证状态**

- 实现状态：已实现主入口
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/cli`

**核心理念**

- CLI 是当前 OMBot 的主要用户入口。
- 它既要支持 session 对话，也要支持查看全局 monitor / event / host / approval 状态。
- CLI 不应把全局对象强行塞进当前 active session。

**当前实现方式**

当前支持：

- 启动时自动接上最近一个 interactive session
- `/use new` 创建新的对话入口
- `/sessions` / `/use`
- `/host` / `/host show` / `/host refresh`
- `/approval auto` / `/approval default`
- `/approve` / `/deny`
- `/events` / `/events show` / `/events runs`
- `/monitor` / `/monitor show`

当前全局查看策略：

- `/monitor`：最近摘要
- `/monitor show`：全局 monitor 历史
- `/events`：事件定义列表
- `/events runs`：全局 event 执行历史

当前限制：

- 仍无图形化控制台
- 历史展示仍然是 transcript 回放，不是专门的全局 dashboard
