# Configuration System

**验证状态**

- 实现状态：已落地
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/config`, `config/`

**核心理念**

- 配置必须在进入业务层之前完成校验、规范化和路径归一。
- 业务配置、运行时密钥、workspace 文档注入需要分开管理。

**当前实现方式**

当前配置来源包括：

- `config/ombot.yaml`
- `config/monitors.yaml`
- `.env`

当前配置系统负责：

- YAML 加载
- snake_case -> camelCase
- Zod 校验
- 路径绝对化
- monitor 规则默认值

当前已覆盖配置域：

- app
- agent
- gateway
- events
- host profile
- code execution
- paths
- monitor rules

当前限制：

- 监控配置仍缺少更高层的 `service_key` 模型
- 远程适配器配置尚未接入
