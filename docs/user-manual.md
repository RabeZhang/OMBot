# OMBot 用户手册

## 目录

1. [简介](#简介)
2. [快速开始](#快速开始)
3. [CLI 命令详解](#cli-命令详解)
4. [工具功能列表](#工具功能列表)
5. [Session 管理](#session-管理)
6. [配置文件](#配置文件)
7. [使用示例](#使用示例)
8. [安全策略](#安全策略)

---

## 简介

OMBot 是一款专为运维场景设计的 AI 助手，基于 pi-mono 生态构建。它提供了交互式 CLI 界面，支持多 Session 对话管理，并集成了丰富的系统工具，帮助运维人员高效完成日常任务。

### 核心特性

- **交互式 TUI**：基于 pi-tui 的终端用户界面，支持实时流式输出和工具调用展示
- **多 Session 管理**：支持多个独立对话会话，可切换、查看历史记录
- **丰富的工具集**：文件操作、系统监控、网络诊断、进程管理等
- **安全策略控制**：基于风险等级的工具权限管理
- **会话标题生成**：自动基于内容生成会话摘要

---

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动 CLI

```bash
npm run cli
```

### 基本交互

启动后，你将看到 `>` 提示符，可以直接输入：

- **普通消息**：与 AI 助手对话，例如 "查看当前 CPU 使用情况"
- **命令**：以 `/` 开头的特殊命令，例如 `/help`、`/sessions`

---

## CLI 命令详解

### `/help` - 查看帮助

显示所有可用命令及其说明。

```
> /help
```

### `/sessions [n|all]` - 列出会话

显示历史会话列表，支持分页。

```bash
# 显示前 10 个会话（默认）
> /sessions

# 显示前 20 个会话
> /sessions 20

# 显示所有会话
> /sessions all
```

**输出示例**：
```
1. sess_abc123 [interactive/active] | 查看服务器状态
2. sess_def456 [interactive/idle] | 修改 nginx 配置
3. sess_ghi789 [interactive/closed] | 排查内存问题

[共 15 个会话，显示前 10 个。使用 /sessions all 查看全部]
```

**字段说明**：
- `sess_xxx` - 会话唯一 ID
- `[interactive/active]` - `[会话类型/会话状态]`
  - 类型：`interactive`（交互式）、`incident`（告警）、`system`（系统）
  - 状态：`active`（活跃）、`idle`（空闲）、`closed`（已关闭）
- 后面的文字 - 会话标题（自动基于内容生成）

### `/use <id|number>` - 切换会话

切换到指定的历史会话，支持两种方式：

```bash
# 方式 1：使用编号（推荐）
> /use 1

# 方式 2：使用 sessionId
> /use sess_abc123
```

**说明**：
- 使用 `/sessions` 命令后，列表左侧的数字即为编号
- 切换到会话后，会自动加载并显示该会话的历史对话记录

### `/clear` - 清除会话绑定

解除当前 Session 绑定，相当于开始一个全新的对话。

```bash
> /clear
```

### `/monitor` - 查看监控告警

显示最近的监控告警历史（最多 20 条）。

```bash
> /monitor
```

**输出示例**：
```
  ⚠️  [14:32:15] 内存使用率超过 80%
  ✅ [14:35:22] 内存告警已恢复
  ⚠️  [15:10:08] CPU 使用率超过 90%
```

### `/expand [n]` - 展开工具调用详情

当 Agent 执行了工具调用后，结果会被折叠显示。使用此命令展开查看详情。

```bash
# 展开最近一次工具调用
> /expand

# 展开第 3 次工具调用（按时间顺序）
> /expand 3
```

### `/exit` 或 `/quit` - 退出 CLI

退出 OMBot CLI。

```bash
> /exit
```

---

## 工具功能列表

OMBot 集成了多种工具，分为以下几类：

### 1. 文件操作工具

#### `read` - 读取文件

读取文件内容，支持文本文件和图片文件。

**适用场景**：
- 查看配置文件
- 分析日志文件
- 查看截图

**参数**：
- `path` - 文件路径
- `offset`（可选）- 起始行号（1-based）
- `limit`（可选）- 最大行数

**示例指令**：
```
读取 /var/log/nginx/error.log 的前 50 行
查看 /etc/nginx/nginx.conf 配置文件
```

#### `edit` - 编辑文件（部分修改）

精确替换文件中的部分内容，使用 oldText/newText 匹配模式。

**适用场景**：
- 修改配置参数
- 更新变量值
- 修复特定代码行

**参数**：
- `path` - 文件路径
- `oldText` - 要替换的原始文本（必须精确匹配）
- `newText` - 新文本

**示例指令**：
```
将 nginx.conf 中的 listen 80 改为 listen 8080
把 config.py 里的 DEBUG = True 改成 DEBUG = False
```

**注意事项**：
- oldText 必须唯一且精确匹配
- 如果 oldText 出现多次，会报错提示

#### `write` - 写入文件（完全替换）

创建新文件或完全覆盖现有文件。

**适用场景**：
- 创建新的配置文件
- 生成脚本文件
- 保存日志或报告

**参数**：
- `path` - 文件路径
- `content` - 文件内容
- `label`（可选）- 操作标签

**示例指令**：
```
创建一个 nginx 配置文件，路径 /etc/nginx/sites-available/myapp
写入一个 shell 脚本到 /usr/local/bin/backup.sh
```

**注意事项**：
- 会覆盖现有文件（高风险操作）
- 自动创建父目录

#### `grep` - 文本搜索

在文件中搜索匹配的文本内容。

**适用场景**：
- 查找日志中的错误信息
- 搜索配置项
- 代码审查

**参数**：
- `path` - 文件或目录路径
- `pattern` - 搜索模式（支持正则）
- `recursive`（可选）- 是否递归搜索目录

**示例指令**：
```
在 /var/log 中搜索 "ERROR" 关键字
查找包含 "connection refused" 的日志条目
```

#### `find` - 文件查找

查找符合条件的文件。

**适用场景**：
- 查找特定类型的文件
- 定位配置文件位置
- 清理临时文件

**参数**：
- `path` - 起始目录
- `name`（可选）- 文件名模式
- `type`（可选）- 文件类型（file/directory）
- `maxDepth`（可选）- 最大搜索深度

**示例指令**：
```
查找 /etc 目录下所有的 .conf 文件
找出 /var/log 中 7 天前的日志文件
```

### 2. 系统监控工具

#### `getCpuUsage` - CPU 使用率

获取系统 CPU 使用情况。

**示例指令**：
```
查看当前 CPU 使用率
CPU 负载怎么样
```

#### `getMemoryUsage` - 内存使用情况

获取系统内存使用情况。

**示例指令**：
```
查看内存使用情况
还有多少可用内存
```

#### `getDiskUsage` - 磁盘使用情况

获取指定路径的磁盘使用情况。

**参数**：
- `path`（可选）- 目录路径，默认为根目录

**示例指令**：
```
查看磁盘使用情况
/ 目录还有多少空间
```

#### `getProcessStatus` - 进程状态

查询指定进程的状态信息。

**参数**：
- `pid`（可选）- 进程 ID
- `processName`（可选）- 进程名称

**示例指令**：
```
查看 nginx 进程状态
PID 1234 的进程在做什么
```

### 3. 网络诊断工具

#### `getPortStatus` - 端口状态检测

检测指定主机的端口是否开放。

**参数**：
- `host`（可选）- 目标主机，默认 localhost
- `port` - 端口号
- `timeoutMs`（可选）- 超时时间

**示例指令**：
```
检查 8080 端口是否开放
测试远程服务器 192.168.1.100 的 22 端口
```

#### `checkHttpEndpoint` - HTTP 端点检测

检测 HTTP 端点是否可访问。

**参数**：
- `url` - 目标 URL
- `method`（可选）- 请求方法（GET/HEAD）
- `timeoutMs`（可选）- 超时时间

**示例指令**：
```
检查 https://example.com 是否正常
测试本地 API http://localhost:3000/health
```

### 4. 命令执行工具

#### `bash` - 执行 Shell 命令

在本地执行 bash 命令。

**参数**：
- `command` - 要执行的命令
- `timeout`（可选）- 超时时间（毫秒）
- `workingDir`（可选）- 工作目录

**示例指令**：
```
执行 ls -la /var/log
运行 docker ps 查看容器状态
```

**注意事项**：
- 某些危险命令可能需要审批
- 支持超时控制防止长时间挂起

---

## Session 管理

### Session 生命周期

1. **创建**：第一次发送消息时自动创建
2. **激活**：与 Agent 交互时处于 active 状态
3. **空闲**：一段时间无交互变为 idle 状态
4. **关闭**：明确结束或超过保留期

### 会话标题

OMBot 会自动为 Session 生成标题：

1. **初始标题**：基于用户第一条消息的前 20 个字符
2. **智能标题**：Agent 回复完成后，LLM 生成更准确的摘要（不超过 15 字）
3. **兜底方案**：如果用户提前退出，使用最后一条输入作为标题

### 会话列表排序

`/sessions` 显示的会话按 `updatedAt` 倒序排列，最新的在前面。

---

## 配置文件

OMBot 使用 YAML 格式的配置文件，默认路径为 `config/ombot.yaml`。

### 示例配置

```yaml
# LLM 配置
llm:
  provider: openai
  modelName: gpt-4o-mini
  apiKey: ${OPENAI_API_KEY}
  baseUrl: https://api.openai.com/v1
  temperature: 0.7
  timeoutMs: 30000

# 系统提示词
systemPrompt: |
  你是一个专业的运维助手，帮助用户诊断和解决系统问题。
  你可以执行命令、读取文件、修改配置等操作。

# 存储配置
storage:
  sessionDir: ./data/sessions
  auditDbPath: ./data/audit.db

# 监控配置（可选）
monitor:
  enabled: true
  intervalSeconds: 60
  rules:
    - name: high_cpu
      condition: cpu_usage > 80
      severity: warning
```

### 环境变量

支持使用 `${VAR_NAME}` 语法引用环境变量：

```bash
export OPENAI_API_KEY=sk-xxx
```

---

## 使用示例

### 场景 1：排查 nginx 问题

```
> 帮我看看 nginx 为什么启动失败了

⏳ Agent 思考中...

[tool] read /var/log/nginx/error.log

...（日志内容）...

看起来是 80 端口被占用了。让我检查一下：

[tool] bash "lsof -i :80"

...（命令输出）...

发现是 Apache 占用了 80 端口。你可以：
1. 停止 Apache：sudo systemctl stop apache2
2. 或者修改 nginx 监听端口

需要我帮你修改 nginx 配置吗？

> 好，把 nginx 改成监听 8080 端口

[tool] edit /etc/nginx/nginx.conf

已成功修改，需要重启 nginx 生效。
```

### 场景 2：系统资源检查

```
> 检查服务器资源使用情况

[tool] getCpuUsage
[tool] getMemoryUsage
[tool] getDiskUsage

当前资源使用情况：
- CPU: 45% (正常)
- 内存: 6.2G / 16G (39%，正常)
- 磁盘: 45G / 100G (45%，正常)

系统运行状况良好。
```

### 场景 3：多 Session 工作

```
> 查看数据库连接配置
...（与数据库配置相关的对话）...

> /sessions
1. sess_abc123 [interactive/active] | 查看数据库连接配置
2. sess_def456 [interactive/idle] | 排查内存泄漏问题

> /use 2
（切换到内存泄漏排查会话，加载历史记录）

> 继续分析那个内存问题
...（继续之前的对话）...
```

---

## 安全策略

### 风险等级

工具按风险等级分类：

| 等级 | 说明 | 工具示例 |
|------|------|----------|
| `readonly` | 只读操作，无风险 | read, getCpuUsage, getMemoryUsage |
| `readwrite` | 可修改系统，需谨慎 | edit, bash（只读命令） |
| `dangerous` | 高风险，可破坏数据 | write, bash（修改命令） |

### 工具策略配置

在 `config/tool_policy.yaml` 中配置：

```yaml
profiles:
  # 只读模式 - 最安全
  readonly:
    allowedTools:
      - read
      - getCpuUsage
      - getMemoryUsage
      - getDiskUsage
      - getProcessStatus
      - getPortStatus
      - checkHttpEndpoint
      - grep
      - find

  # 读写模式 - 可修改配置
  readwrite:
    extends: readonly
    allowedTools:
      - edit
      - bash

  # 危险模式 - 可执行任意操作
  dangerous:
    extends: readwrite
    allowedTools:
      - write
```

### 审批机制

某些高风险操作在执行前需要用户确认：

```
⚠️ 需要审批：执行命令 "rm -rf /var/log/old/*"
原因：检测到删除操作
请输入：approve_once（批准一次）/ deny（拒绝）
> approve_once
```

---

## 故障排除

### 无法启动 CLI

1. 检查依赖是否安装：`npm install`
2. 检查配置文件是否存在：`config/ombot.yaml`
3. 检查环境变量：`OPENAI_API_KEY` 是否设置

### 工具执行失败

1. 检查权限：某些命令需要 sudo
2. 检查路径：文件路径是否正确
3. 查看日志：检查控制台错误输出

### Session 丢失

Session 数据存储在 `data/sessions/` 目录，确保：
1. 目录有读写权限
2. 磁盘空间充足
3. 没有被意外删除

---

## 更新日志

### v1.0.0

- ✅ 基础 CLI TUI 交互
- ✅ Session 管理和切换
- ✅ 文件操作工具（read, edit, write）
- ✅ 系统监控工具（CPU, 内存, 磁盘, 进程）
- ✅ 网络诊断工具（端口检测, HTTP 检测）
- ✅ 文本搜索工具（grep, find）
- ✅ Bash 命令执行
- ✅ 智能会话标题生成
- ✅ 工具安全策略控制
