# Gateway Control Plane

**验证状态**

- 实现状态：已落地主骨架
- 产品评分：4/5
- 架构评分：5/5
- 主要源码：`src/gateway`

**核心理念**

- Gateway 是 OMBot 的唯一控制面。
- 它负责把用户输入、monitor、event、审批、session、transcript 串成统一的运行模型。
- 客户端不直接维护事实，Gateway 才是唯一真相源。

**当前实现方式**

Gateway 当前负责：

- 创建与复用 session
- 维护 run 生命周期
- 写入 transcript
- 接入审批中心
- 路由全局 monitor 事件
- 路由全局 event 执行

当前全局后台 session：

- `[monitor] global`
- `[events] global`

当前限制：

- 仍然是本地嵌入式控制面
- 尚未对外提供正式的 WebSocket / HTTP API
