# OMBot 下一阶段能力缺口与开发目标

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-15

---

## 一、文档目标

本文档记录 OMBot 在“可运行 MVP”向“实际可用的运维 Agent”推进过程中，当前最关键的 4 个能力缺口。

这 4 项将作为下一阶段的主要开发任务：

1. 安全执行与 Human-in-the-Loop
2. 本机资源监控准确性
3. 宿主环境认知能力
4. 标准代码执行环境

其中，**第一项是当前最高优先级任务**。

---

## 二、总体判断

当前 OMBot 已经具备以下基础能力：

- 本地单进程 Gateway / Agent / Monitor / Events 组合
- 多 session
- Transcript / Audit / Session 持久化
- 本机工具调用
- 基于 event 的一次性和周期任务
- CLI 交互与基础事件管理

但距离“可在真实环境持续运行并安全参与运维”仍有明显差距，主要不在“有没有功能”，而在：

- **安全边界不闭环**
- **监控事实不够可靠**
- **对宿主环境理解不充分**
- **缺乏标准、可控、可复用的脚本执行能力**

---

## 三、问题一：安全执行与 Human-in-the-Loop

### 3.1 现状

项目中已经存在若干安全相关骨架：

- `ToolPolicy`
- `ApprovalCenter`
- 风险分级（`readonly / mutating / privileged`）
- 审计存储

但当前实际运行路径中，这些能力还没有形成完整闭环。

典型现状：

- `bash`
- `write`
- `edit`
- `delete_event`

这类具有破坏性的工具，目前仍可能直接暴露给 Agent 使用。

相关代码：

- [src/tools/policy.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/policy.ts)
- [src/gateway/approvals.ts](/Users/zhangliang/PycharmProjects/OMBot/src/gateway/approvals.ts)
- [config/tool_policy.yaml](/Users/zhangliang/PycharmProjects/OMBot/config/tool_policy.yaml)
- [src/tools/local/bash.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/local/bash.ts)

### 3.2 风险

- 模型误判导致直接执行高风险命令
- 文件编辑/写入缺少强制确认
- 审批能力存在，但没有成为执行前的必经路径
- 生产环境中无法满足“最小权限 + 可追踪 + 可拒绝”的要求

### 3.3 开发目标

目标不是“让模型更谨慎”，而是建立**宿主侧强制安全控制链**：

- 模型不能自行决定“是否可以执行”
- 工具不能自行绕过审批
- 所有高风险动作必须经过统一的执行控制层

### 3.4 推荐方案

**推荐采用：工具保持简洁 + 额外安全控制层负责拦截、审批、提权、审计。**

不建议把“是否需要确认”分散写进每个工具实现里。

原因：

- 工具层适合做“业务动作本身”
- 安全规则属于横切能力
- 如果把确认逻辑写散在工具内部，后续会：
  - 难以统一管理
  - 难以审计
  - 难以按 profile / channel / host / session 动态收缩
  - 难以切换审批策略

### 3.5 建议的安全链路

```text
Agent 决定调用工具
        |
        v
Tool Exposure Filter
  - 当前 profile 能否看见这个工具
        |
        v
Tool Execution Policy
  - 当前参数是否允许
  - 当前会话/来源是否允许
  - 是否需要确认
        |
        +--> 需要确认 --> Approval Center --> 用户批准/拒绝
        |
        v
Execution Environment Selector
  - host / docker / python sandbox / ts sandbox
        |
        v
Actual Tool Execute
        |
        v
Audit Store / Transcript
```

### 3.6 下一阶段要做的最小闭环

1. 引入统一的 `ToolExecutionGateway`
2. 所有工具执行必须经过该层
3. `mutating` / `privileged` 默认不能直通
4. 将 `ApprovalCenter` 从“事件发布器”提升为“执行门禁”
5. 将 `tool_policy.yaml` 真正接入运行时
6. 高风险工具执行结果进入结构化审计

### 3.7 结论

用户提出的方向是对的：

> 不依赖模型来主动和人确认，而是把确认、拒绝执行放到宿主系统中。

但更准确地说，**不应把这件事塞进具体工具实现里，而应放在工具层之上的统一控制层中。**

工具层仍应尽量保持简洁，只负责：

- 参数校验
- 动作执行
- 结果返回

而“是否允许执行”应由独立控制层负责。

---

## 四、问题二：本机资源监控准确性

### 4.1 现状

当前 CPU / 内存 / 磁盘工具已经存在，但 CPU 和内存实现主要依赖 Node.js `os` 模块的粗粒度接口。

相关代码：

- [src/tools/local/resource.ts](/Users/zhangliang/PycharmProjects/OMBot/src/tools/local/resource.ts)

现有问题：

- CPU 百分比本质上是用 load average 估算，不是真实 utilization
- 内存统计未区分 cached / buffered / available / swap
- 不同平台语义不同，当前实现没有做平台适配

### 4.2 风险

- Agent 基于错误事实做结论
- Monitor 误判或漏判
- 用户对 OMBot 的可信度快速下降

### 4.3 开发目标

- 提供“运维可用级”的 CPU / 内存 / 磁盘数据
- 平台差异（Linux/macOS）要在宿主层显式建模
- 不再把 load average 当 CPU 利用率使用

### 4.4 建议方向

- Linux 走 `/proc/stat`、`/proc/meminfo`、`df`
- macOS 走 `top -l 1`、`vm_stat`、`sysctl`
- 资源工具拆成平台适配层
- 返回更多原始字段，减少过早摘要

---

## 五、问题三：宿主环境认知能力

### 5.1 现状

当前 Agent 主要依赖：

- `HOST_PROFILE.md`
- `RUNBOOK.md`
- Prompt 中的少量静态描述

相关文件：

- [workspace/HOST_PROFILE.md](/Users/zhangliang/PycharmProjects/OMBot/workspace/HOST_PROFILE.md)

目前宿主画像非常粗。

例如：

- 是否有桌面环境
- Desktop / Downloads / Documents 路径在哪里
- 当前用户是谁
- 当前系统有哪些常见工具可用
- Docker / Python / Node 是否存在

这些事实 Agent 没有稳定来源。

### 5.2 风险

- Agent 容易误解“桌面”“下载目录”等用户表达
- 会产生大量环境猜测
- 会降低执行正确率和用户信任

### 5.3 开发目标

- 给 Agent 一套“宿主环境认知工具”
- 把环境事实从 prompt 文档迁移为工具可查询事实

### 5.4 建议方向

新增只读工具：

- `get_host_environment`
- `resolve_special_path`
- `get_platform_capabilities`
- `get_user_profile`

同时保留 `HOST_PROFILE.md` 作为人工补充信息，而非唯一事实源。

---

## 六、问题四：标准代码执行环境

### 6.1 现状

现在 Agent 可以调用：

- `bash`
- `read`
- `write`
- `edit`

但没有一个明确的、长期可维护的“标准代码执行环境”。

这导致：

- 复杂解析逻辑容易被塞进 bash
- 缺少稳定的脚本运行宿主
- 复杂任务实现方式不统一

### 6.2 风险

- Agent 用 shell 拼接复杂逻辑，脆弱且难维护
- 缺少包管理和依赖约束
- 复杂任务可复用性差

### 6.3 开发目标

- 提供可控、稳定、受限制的 Python / TypeScript 执行环境
- 作为更复杂任务的标准承载层

### 6.4 建议方向

- 引入 `python_run`
- 引入 `ts_run`
- 限制工作目录、CPU/内存/执行时长
- 预装常用包，但用白名单管理
- 与安全执行层结合

---

## 七、下一阶段优先级

### P0

1. 安全执行与 Human-in-the-Loop

### P1

2. 本机资源监控准确性
3. 宿主环境认知能力
4. 标准代码执行环境

---

## 八、推荐的开发顺序

1. 先完成安全执行控制层设计
2. 在控制层可用后，再接入 Python / TS 执行环境
3. 并行重做资源监控工具
4. 最后补宿主环境认知工具

这样做的原因是：

- 没有安全控制层，后续新增的执行能力都会放大风险
- 资源工具和环境认知属于事实能力升级，可在安全边界内演进

---

## 九、当前结论

OMBot 下一阶段最重要的任务，不是继续堆功能，而是补齐以下三条底线：

- **执行必须安全**
- **事实必须可信**
- **环境必须可理解**

只要这三条底线不补齐，Agent 在真实运维环境中的可用性就会长期受限。
