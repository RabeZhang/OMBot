# OMBot Documentation Agent Guide

**验证状态**

- 文档系统状态：已建立新的导引式结构
- 覆盖范围：产品层、架构层、核心模块层
- 校对基线：以当前 `src/` 主实现和 `config/` 实际配置为准
- 维护要求：新增功能必须补文档，废弃方案必须从主文档移除

**核心理念**

- `docs/` 不是附属材料，而是 OMBot 的产品资产和架构资产。
- 文档组织方式应与当前系统分层一致，而不是跟随历史讨论堆积。
- session 只表示对话和分析入口；全局配置、全局事件、宿主事实不应被错误地写成 session 私有对象。
- 每篇文档必须固定回答三件事：
  - 验证状态：它现在是否真实落地、落到什么程度
  - 核心理念：这个模块为何存在、边界是什么
  - 当前实现方式：现在代码里到底怎么做

**当前实现方式**

本文档是 `docs/` 的总入口。推荐阅读顺序如下：

1. 产品总览
   路径：[overview.md](/Users/zhangliang/PycharmProjects/OMBot/docs/product/overview.md)
2. 当前状态与主要缺口
   路径：[current-state.md](/Users/zhangliang/PycharmProjects/OMBot/docs/product/current-state.md)
3. 全局对象与 session 边界
   路径：[global-vs-session.md](/Users/zhangliang/PycharmProjects/OMBot/docs/architecture/global-vs-session.md)
4. 文档维护规则
   路径：[documentation-system.md](/Users/zhangliang/PycharmProjects/OMBot/docs/meta/documentation-system.md)
5. 文档维护 Agent
   路径：[documentation-agent.md](/Users/zhangliang/PycharmProjects/OMBot/docs/meta/documentation-agent.md)

模块索引：

| 模块 | 概述 | 文档路径 | 主要源码路径 |
|---|---|---|---|
| Agent | LLM 运行时、prompt、tool-calling 主循环 | [runtime.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/agent/runtime.md) | `src/agent` |
| Gateway | 控制面、run 路由、审批接入、全局后台事件入口 | [control-plane.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/gateway/control-plane.md) | `src/gateway` |
| CLI | 本地交互入口、全局历史查看、session 切换 | [interaction.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/cli/interaction.md) | `src/cli` |
| Monitor | 全局监控规则、状态机、monitor -> agent 闭环 | [monitor-engine.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/monitor/monitor-engine.md) | `src/monitor` |
| Events | 全局事件定义、event 文件、调度执行 | [global-events.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/events/global-events.md) | `src/events` |
| Tools | 本机工具、注册层、安全执行门禁 | [tools-and-safety.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/tools/tools-and-safety.md) | `src/tools` |
| Code Execution | 受控代码执行环境 | [controlled-execution.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/code-execution/controlled-execution.md) | `src/code-execution` |
| Host | 宿主环境快照与 `HOST_PROFILE.md` | [host-environment.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/host/host-environment.md) | `src/host` |
| Memory | session、transcript、audit 三层持久化 | [session-transcript-audit.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/memory/session-transcript-audit.md) | `src/memory`, `src/audit` |
| Config | YAML / `.env` / prompt context 的装配 | [configuration.md](/Users/zhangliang/PycharmProjects/OMBot/docs/modules/config/configuration.md) | `src/config`, `config` |

维护约束：

- 禁止继续把临时设计稿直接放在 `docs/` 根目录长期保留。
- 新模块应优先进入 `docs/modules/<module>/`。
- 产品级或架构级文档优先进入 `docs/product/` 和 `docs/architecture/`。
- 示例文件保留在 `docs/examples/`。
