# Monitor Engine

**验证状态**

- 实现状态：已实现全局 monitor 闭环
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/monitor`

**核心理念**

- monitor 规则是全局配置，不属于某个 session。
- monitor 的价值不在单次 probe，而在状态变化和异常升级。
- 只有足够稳定的异常才应进入 Agent 分析闭环。

**当前实现方式**

当前支持：

- `http / port / process / resource`
- 定时轮询
- cooldown
- `failureThreshold / recoveryThreshold`
- `monitor.alert / monitor.recovered`
- monitor -> gateway -> agent 全局分析闭环

当前默认策略：

- 若未单独配置阈值：
  - 连续 2 次失败才告警
  - 连续 2 次成功才恢复

当前 monitor 事件会进入：

- Gateway 全局 monitor session
- transcript
- CLI 全局 monitor 历史

当前限制：

- 尚无本地服务发现器
- 仍未升级到 `service_key` 模型
- 监控对象定义仍接近 probe 配置，而不是完整服务建模
