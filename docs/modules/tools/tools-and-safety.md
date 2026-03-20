# Tools And Safety

**验证状态**

- 实现状态：已实现第一版安全执行门禁
- 产品评分：4/5
- 架构评分：4/5
- 主要源码：`src/tools`

**核心理念**

- 工具能力必须和安全门禁分离。
- 模型可以提议调用工具，但是否执行由宿主控制。
- 高风险工具必须通过审批和审计进入系统。

**当前实现方式**

当前主要工具包括：

- 本机只读监控工具
- `bash / read / edit / write / grep / find`
- `create_event / list_events / read_event / delete_event`
- `code_run`

当前安全机制：

- `default` 模式：敏感工具走审批
- `auto` 模式：敏感工具直接放行
- 短 `approvalRef`
- 审批事实写入 transcript / audit

当前重点保护工具：

- `bash`
- `edit`
- `write`
- `code_run`

当前限制：

- 仍未实现更细的参数级策略层
- `bash` 风险判断仍属启发式
