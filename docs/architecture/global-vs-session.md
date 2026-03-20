# Global Vs Session Boundaries

**验证状态**

- 边界原则：已明确
- monitor：已改为全局 monitor 历史
- event：已改为全局 event 定义与全局执行历史

**核心理念**

- session 的职责是对话和分析上下文。
- 全局配置、宿主事实、监控规则、调度事件不应被错误设计成 session 私有对象。

**当前实现方式**

当前按以下边界划分：

- 全局对象
  - `monitors.yaml`
  - `workspace/events/*.json`
  - `HOST_PROFILE.md`
  - monitor 全局历史
  - event 全局执行历史
- session 作用域对象
  - 用户消息
  - 助手消息
  - 工具调用与工具结果
  - 某次审批事实

已经调整的内容：

- monitor 不再按 `ruleId -> session` 作为最终产品模型，而是进入全局 monitor session
- event 文件不再默认绑定创建它的 session
- 删除 session 不再删除 event 文件

后续仍需继续审视的方向：

- 审批列表应有全局入口，但审批事实仍可保留 session 归属
- session 加载与全局对象查看入口要继续保持分离
