# Host Environment

**验证状态**

- 实现状态：已实现第一版
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/host`

**核心理念**

- 宿主环境事实不应靠模型猜测。
- 宿主环境信息属于全局事实，应落在结构化快照和 `HOST_PROFILE.md` 中。
- Agent 需要时可以读取这些事实，而不是把它们伪装成某个 session 的局部知识。

**当前实现方式**

当前支持：

- 宿主快照采集
- `environment.json`
- `workspace/HOST_PROFILE.md`
- `/host`
- `/host refresh`
- `/host show`

当前采集内容包括：

- 平台与架构
- GUI 粗识别
- Docker 迹象
- 常用目录
- 常用运行时可用性

当前限制：

- 尚未把宿主画像用于更细的安全策略和执行环境选择
