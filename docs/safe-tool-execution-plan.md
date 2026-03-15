# OMBot 安全执行层设计方案

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-15

---

## 一、文档目标

本文档聚焦 OMBot 下一阶段最重要的能力建设：

- 为高风险工具建立**宿主侧强制安全执行层**
- 首批只覆盖 3 个高风险工具：
  - `bash`
  - `edit`
  - `write`

目标不是让模型“更谨慎”，而是让：

- 模型只能提出执行意图
- 宿主系统决定是否允许执行
- 人类在必要时进入确认流程

---

## 二、结论先行

### 推荐方案

**工具层保持简洁，工具外增加统一的安全执行控制层。**

不建议把“是否确认”“是否阻断”“是否提权”分散写进每个工具实现。

### 原因

如果把安全逻辑塞进工具内部，会带来以下问题：

- 不同工具实现风格不一致
- 风险规则分散，难以审计
- 难按 `session / profile / channel / host / env` 统一控制
- 难支持统一审批流
- 后续新增 Python / TS 执行环境时会重复造轮子

因此更合理的分层是：

```text
Agent Tool Call
    |
    v
Tool Exposure / Policy Layer
    |
    v
Approval / HITL Layer
    |
    v
Execution Environment Layer
    |
    v
Actual Tool Implementation
    |
    v
Audit / Transcript
```

---

## 三、设计目标

### 3.1 必须达到

1. `bash / edit / write` 不能再直接执行
2. 高风险操作必须经过宿主判断
3. Human-in-the-loop 不依赖模型主动提出
4. 执行结果可审计、可回放
5. 同一套规则可扩展到未来的 Python / TS 执行环境

### 3.2 暂不追求

1. 复杂参数语义理解
2. 自动回滚
3. 多端审批界面
4. 细粒度 RBAC

---

## 四、适用范围

本阶段只管 3 个工具：

### 4.1 `bash`

风险最高，原因：

- 可以读写文件
- 可以执行服务控制
- 可以联网
- 可以执行任意系统命令

### 4.2 `edit`

风险中高，原因：

- 直接修改已有文件
- 容易破坏配置
- 修改范围虽然精确，但影响仍可能很大

### 4.3 `write`

风险中高，原因：

- 可创建或覆盖文件
- 容易误写配置、脚本、数据文件

---

## 五、核心原则

### 5.1 模型只负责“提议”，不负责“授权”

模型可以说：

- 我要调用 `bash`
- 我要调用 `edit`
- 我要调用 `write`

但不能决定：

- 这次是否允许执行
- 是否需要确认
- 是否能跳过审批

### 5.2 工具不内置审批逻辑

工具本身只做：

- 参数校验
- 执行
- 返回结果

审批、阻断、改写、提权应该在工具外完成。

### 5.3 宿主系统是唯一裁决点

最终裁决由宿主完成：

- 是否允许
- 是否确认
- 在哪里执行
- 记录什么审计信息

### 5.4 “默认拒绝”优于“默认放行”

对于高风险工具：

- 默认不能自由执行
- 未明确允许的情形应默认拒绝

---

## 六、推荐架构

### 6.1 新增组件：Tool Execution Gateway

建议新增独立组件，例如：

```text
src/tools/execution-gateway.ts
```

职责：

1. 接收工具调用请求
2. 查询工具元数据（风险级别、工具名）
3. 进行策略评估
4. 判断是否需要确认
5. 若需要确认，则创建审批请求并挂起
6. 通过审批后再执行真实工具
7. 记录审计
8. 返回结果事件

### 6.2 逻辑位置

推荐放在：

- `Gateway` 与真实 `Tool` 执行之间
- 或 `AgentTool.execute()` 与底层工具实现之间

不建议直接嵌在：

- `bash.ts`
- `edit.ts`
- `write.ts`

### 6.3 目标链路

```text
Agent 发起 tool call
    |
    v
ToolExecutionGateway.execute()
    |
    +--> ToolPolicy.evaluate()
    |
    +--> RiskClassifier / ParamInspector
    |
    +--> ApprovalCenter.request()  (如需要)
    |
    +--> ExecutionEnvironment.select()
    |
    +--> tool.execute()
    |
    +--> AuditStore.append()
    |
    v
返回 ToolResult / Blocked / ApprovalRequired
```

---

## 七、bash / edit / write 的建议策略

### 7.1 `bash`

建议拆成 3 档：

#### A. 明显只读

示例：

- `ps`
- `df`
- `free`
- `cat`
- `tail`
- `grep`
- `lsof`

策略：

- 可直接放行或低风险放行

#### B. 可疑命令

示例：

- `curl`
- `python`
- `node`
- `npm`
- `pip`
- `git`
- `docker`

策略：

- 默认需要确认
- 后续可按 allowlist 单独放宽

#### C. 明显破坏性

示例：

- `rm`
- `mv`
- `chmod`
- `chown`
- `systemctl restart`
- `kill`
- `sed -i`

策略：

- 默认阻断或强制确认
- 最好要求更高等级 profile 或隔离环境

### 7.2 `edit`

建议策略：

- 默认需要确认
- 若目标文件命中高风险路径，则直接拒绝或强制确认

高风险路径示例：

- `/etc`
- `/usr/local/bin`
- `/Library`
- `~/.ssh`
- `~/.zshrc`

低风险路径示例：

- `workspace/`
- 项目目录下的配置草稿
- 临时目录

### 7.3 `write`

建议策略：

- 默认需要确认
- 若是覆盖已有文件，风险高于新建文件
- 若写入目标是系统目录，直接提高风险级别

---

## 八、Human-in-the-Loop 流程

### 8.1 触发条件

当安全层判断：

- 工具风险高
- 参数风险高
- 路径风险高
- 命令命中危险模式

则进入 HITL。

### 8.2 审批消息应包含

- `approvalId`
- `sessionId`
- `toolName`
- `riskLevel`
- 原始参数
- 简短风险摘要
- 建议动作：
  - `approve_once`
  - `deny`

### 8.3 用户体验

CLI 中应出现类似提示：

```text
[approval] bash: 检测到高风险命令，需要确认
命令: rm -rf /tmp/test
原因: 命中危险模式 rm -rf
输入 /approve <id> 或 /deny <id>
```

### 8.4 注意

这里的 HITL 是**宿主强制触发**，不是模型自己先问一句“要不要继续？”。

### 8.5 拒绝后的正确语义

当用户对某个高风险操作执行 `deny` 时，系统必须同时满足两件事：

#### A. 模型侧要能看到“用户拒绝了该操作”这一事实

这条事实应被记录到 transcript / 审计中，后续在下一轮用户真正继续对话时，模型可以知道：

- 某个操作曾被提议
- 用户明确拒绝了它
- 当前不应假设该操作已经执行

#### B. 当前这一次 Agent 执行必须立即结束

也就是说：

- 不要在用户拒绝后，立刻把“拒绝结果”塞回模型继续推理
- 不要让 Agent 在同一轮里继续输出长篇解释或自动改方案
- 当前 run 应直接结束，进入“等待下一次用户输入”的状态

推荐行为：

```text
Agent 提议高风险工具
    ->
宿主触发 approval.required
    ->
用户 deny
    ->
记录 approval.resolved(deny)
    ->
当前 run 立即终止
    ->
等待下一次用户输入
```

### 8.6 为什么不能在 deny 后立即继续推理

如果在用户拒绝后马上把反馈重新喂给模型继续推理，会产生几个问题：

- 模型可能立刻输出一大段“解释性废话”
- 模型可能马上尝试绕开拒绝，改用别的危险工具
- 模型可能误以为用户是在邀请它继续规划
- 用户会失去对“拒绝就是停止”的心理预期

因此：

> **deny 的语义应当是：终止当前执行，而不是继续当前对话回合。**

### 8.7 推荐实现方式

建议在执行控制层中把审批结果分成两类：

- `approve_once`
  - 恢复当前挂起的工具执行
- `deny`
  - 不恢复工具执行
  - 不继续当前 Agent run
  - 仅记录拒绝事实

也就是说，`deny` 不应作为一个普通 `tool_result` 继续返回给模型。

更合适的做法是：

- Gateway / ToolExecutionGateway 捕获 `deny`
- 将当前 run 标记为 `cancelled_by_user` 或 `blocked_by_approval`
- 结束本轮流
- 等待新的用户消息再开始下一轮

---

## 九、参数级风险检查

除了工具名本身，还要检查参数。

### 9.1 `bash`

检查内容：

- 命令前缀
- 是否包含危险子串
- 是否重定向到敏感路径
- 是否调用高权限工具
- 是否写文件

### 9.2 `edit`

检查内容：

- 文件路径
- 是否命中系统目录
- 是否修改敏感配置文件

### 9.3 `write`

检查内容：

- 文件路径
- 文件是否已存在
- 是否写入脚本/可执行文件
- 是否命中系统目录

---

## 十、与现有架构的结合方式

### 10.1 现有可复用能力

当前已有：

- `ToolPolicy`
- `ApprovalCenter`
- `AuditStore`
- `Gateway Event Bus`

这意味着安全执行层并不是从零开始。

### 10.2 现阶段缺失

缺的是：

- 工具执行前的统一拦截入口
- 参数级风险检查
- 审批挂起与恢复执行
- 审批后继续真实工具执行

### 10.3 推荐新增模块

建议新增：

```text
src/tools/execution-gateway.ts
src/tools/risk-inspector.ts
src/tools/bash-risk.ts
src/tools/path-risk.ts
```

---

## 十一、最小落地版本（Phase 1）

### 11.1 范围

只覆盖：

- `bash`
- `edit`
- `write`

### 11.2 行为

- `bash`
  - 危险命令命中则 `approval.required`
  - 非危险只读命令可直接执行
- `edit`
  - 默认需要确认
- `write`
  - 默认需要确认

### 11.3 CLI 支持

新增最小命令：

- `/approve <approvalId>`
- `/deny <approvalId>`

### 11.4 审计

每次被拦截/批准/拒绝/执行都要写审计。

---

## 十二、Phase 2 可增强项

- session 级临时授权
- 更细粒度路径白名单
- Docker / 沙箱执行切换
- bash AST / 更强命令解析
- 高风险操作自动生成 diff / preview
- Web / 移动端审批入口

---

## 十三、推荐结论

对于 OMBot，安全执行层的最佳方案是：

### 不推荐

- 依赖模型主动确认
- 把确认逻辑直接写进 `bash/edit/write` 工具内部

### 推荐

- 保持工具实现尽量简单
- 在工具执行前增加统一安全控制层
- Human-in-the-loop 由宿主侧强制触发
- Tool Policy / Approval / Audit 全部接入同一条执行链路

换句话说：

> **安全不应成为工具的“可选行为”，而应成为工具执行的“前置门禁”。**
