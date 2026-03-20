# Global Events

**验证状态**

- 实现状态：已改为全局事件模型
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/events`, `src/tools/local/events.ts`

**核心理念**

- event 文件是全局调度定义，不属于某个 session。
- 如果一个 event 需要执行背景，就应写进 event 文件本身，而不是隐式依赖创建它时的对话上下文。
- session 只用于查看和分析 event 执行结果，不应作为 event 的所有者。

**当前实现方式**

当前支持：

- `immediate`
- `one-shot`
- `periodic`

当前 event 文件字段包括：

- `type`
- `text`
- `title`
- `context`
- `profile`
- `metadata`

当前行为：

- `create_event` 不再默认写入创建 session
- watcher 调度后统一进入 `[events] global`
- event 执行历史可通过 `/events runs` 查看
- 删除 session 不会删除 event 文件

当前限制：

- event 仍然是文件驱动模型
- 尚无独立的 event run store
- 尚无更强的 event 管理界面
