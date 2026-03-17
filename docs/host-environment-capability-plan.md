# 宿主环境认知能力设计

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-17

---

## 一、目标

为 OMBot 增加一套由宿主侧采集、Agent 侧消费的环境认知能力，解决以下问题：

- Agent 不清楚当前是 macOS 还是 Linux
- Agent 不清楚 CPU 架构是 `x86_64` 还是 `arm64`
- Agent 不清楚 Linux 发行版、版本、内核
- Agent 不清楚当前是否有图形桌面
- Agent 不清楚当前是否运行在 Docker/容器内
- Agent 不清楚 `Desktop`、`Downloads`、`Documents` 这类路径应如何解析
- Agent 不清楚当前机器具备哪些常用运行时与工具能力

本能力的核心原则是：

- **环境事实由宿主采集，不由模型猜测**
- **环境认知以只读为主，不应引入新的高风险执行面**
- **Agent 消费的是“稳定事实快照”，不是零散命令输出**

---

## 二、现状与问题

当前 OMBot 主要依赖：

- `workspace/HOST_PROFILE.md`
- prompt 中的少量静态说明
- Agent 自己根据上下文进行推断

但当前的 [HOST_PROFILE.md](/Users/zhangliang/PycharmProjects/OMBot/workspace/HOST_PROFILE.md) 内容过于粗糙，只能告诉模型：

- Host ID
- OS 是 Unix-like
- Role 是 development

这不足以支持以下高频实际任务：

- “把文件放到桌面”
- “检查这台机器有没有 Docker”
- “这个环境是 Linux 还是 macOS”
- “当前是不是 ARM 机器”
- “如果要跑 Python 脚本，系统里有没有 Python”
- “当前有没有 GUI，能不能把产物放在 Desktop”

因此需要把“宿主环境认知”从静态描述升级为一个正式能力。

---

## 三、设计目标

### 3.1 功能目标

新增一个可刷新、可展示、可供 Agent 消费的宿主环境快照，至少覆盖：

- 操作系统族别与版本
- CPU 架构
- 图形界面能力
- 容器/虚拟化部署迹象
- 当前用户与家目录
- 常见特殊目录
- 常用运行时/命令可用性
- OMBot 自身部署方式相关事实

### 3.2 非目标

本阶段暂不做：

- Windows 支持
- 深度硬件探测
- 网络拓扑探测
- 大规模软件清单盘点
- 权限提升探测
- 侵入式系统信息采集

### 3.3 成功标准

如果用户说出以下话术，Agent 不应继续靠猜：

- “把报告放到桌面”
- “这个环境能不能跑 Python”
- “当前是不是在 Docker 里”
- “这台机器是 macOS 还是 Ubuntu”
- “当前有图形界面吗”

Agent 应能基于宿主快照给出稳定、可解释的判断。

---

## 四、能力边界

宿主环境认知能力建议只回答四类问题：

### 4.1 基础平台事实

- OS family: `macos | linux`
- OS version
- kernel version
- architecture: `x86_64 | arm64 | ...`
- hostname

### 4.2 部署与交互环境

- 是否运行在容器内
- 是否可能运行在虚拟机中
- 是否存在 GUI 会话
- 当前终端类型
- 当前 OMBot 执行模式：`host | docker`

### 4.3 用户与路径语义

- 当前用户名
- `HOME`
- `Desktop`
- `Downloads`
- `Documents`
- `workspace`
- `data`

### 4.4 常用能力探测

- `python3`
- `node`
- `npm`
- `git`
- `docker`
- `bash`
- `sh`
- `ts-node` / `tsx`（如果存在）

不建议第一阶段把以下内容纳入“环境认知”：

- CPU/内存实时使用率
- 监控规则现状
- 正在运行的全部服务
- 全量 PATH 中所有可执行文件

这些更适合归属到监控能力、资源工具能力或按需工具调用。

---

## 五、推荐的数据模型

建议宿主快照分为两层：

### 5.1 结构化快照

文件建议：

- `data/host/environment.json`

建议字段：

```json
{
  "collectedAt": "2026-03-17T10:30:00+08:00",
  "platform": {
    "osFamily": "macos",
    "distribution": "macOS",
    "version": "15.6.1",
    "kernel": "24.6.0",
    "architecture": "arm64",
    "hostname": "local-dev"
  },
  "runtime": {
    "executionMode": "host",
    "insideDocker": false,
    "gui": {
      "available": true,
      "sessionType": "aqua"
    },
    "terminal": {
      "termProgram": "iTerm.app"
    }
  },
  "user": {
    "username": "zhangliang",
    "homeDir": "/Users/zhangliang"
  },
  "paths": {
    "desktop": "/Users/zhangliang/Desktop",
    "downloads": "/Users/zhangliang/Downloads",
    "documents": "/Users/zhangliang/Documents",
    "workspace": "/Users/zhangliang/PycharmProjects/OMBot/workspace",
    "data": "/Users/zhangliang/PycharmProjects/OMBot/data"
  },
  "capabilities": {
    "python3": true,
    "node": true,
    "npm": true,
    "git": true,
    "docker": false,
    "tsx": false
  }
}
```

### 5.2 Agent 友好的摘要文件

文件建议：

- `workspace/HOST_PROFILE.md`

这个文件不再由人工长期手写，而改为：

- 宿主快照自动生成主体内容
- 允许少量人工补充说明

建议结构：

```md
# Host Profile

## Platform
- OS: macOS 15.6.1
- Kernel: 24.6.0
- Architecture: arm64
- Hostname: local-dev

## Runtime
- Execution mode: host
- Inside Docker: no
- GUI available: yes
- Terminal: iTerm.app

## User
- Username: zhangliang
- Home: /Users/zhangliang

## Common Paths
- Desktop: /Users/zhangliang/Desktop
- Downloads: /Users/zhangliang/Downloads
- Documents: /Users/zhangliang/Documents
- Workspace: /.../workspace
- Data: /.../data

## Available Tools
- python3: yes
- node: yes
- npm: yes
- git: yes
- docker: no
```

结论是：

- `json` 用于程序消费
- `md` 用于 prompt 注入与人工阅读

---

## 六、采集维度设计

### 6.1 平台识别

建议优先级：

1. `process.platform`
2. `uname -s`
3. `uname -m`
4. `uname -r`

Linux 下额外读取：

- `/etc/os-release`

macOS 下额外读取：

- `sw_vers`

输出字段：

- `osFamily`
- `distribution`
- `version`
- `kernel`
- `architecture`

### 6.2 GUI 能力识别

#### macOS

判断原则：

- 运行在 macOS 时，默认认为存在桌面能力
- 但仍需记录当前终端环境，如 `TERM_PROGRAM`

补充信号：

- `TERM_PROGRAM`
- `HOME/Desktop` 是否存在

#### Linux

判断原则：

优先检查以下信号：

- `DISPLAY`
- `WAYLAND_DISPLAY`
- `XDG_SESSION_TYPE`
- `XDG_CURRENT_DESKTOP`

可选补充：

- 是否存在图形会话进程

第一阶段不建议为了识别 GUI 去执行复杂进程扫描。

### 6.3 容器环境识别

建议结合多信号判断：

- `/.dockerenv` 是否存在
- `/proc/1/cgroup` 中是否出现 `docker` / `containerd` / `kubepods`
- `container` 环境变量
- 当前 OMBot `execution.mode`

需要注意：

- “OMBot 配置为 host 执行”不等于“宿主不在容器中”
- 这两者应分别记录：
  - `executionMode`
  - `insideDocker`

### 6.4 路径语义识别

第一阶段只覆盖稳定、高价值路径：

- `home`
- `desktop`
- `downloads`
- `documents`
- `workspace`
- `data`

规则建议：

- macOS: 基于 `HOME`
- Linux: 同样先按 `HOME/Desktop` 等通用约定判断
- 若路径不存在，也应返回“预期路径 + exists=false”，不要简单省略

原因是：

- Agent 需要知道“应该放哪里”
- 同时也要知道“这个目录现在是否存在”

### 6.5 常用运行时与命令能力识别

目标不是盘点完整软件生态，而是回答“这台机器能不能跑某类任务”。

建议探测：

- `python3`
- `python`
- `node`
- `npm`
- `git`
- `docker`
- `bash`
- `sh`
- `tsx`
- `ts-node`

建议实现方式：

- `command -v <name>`

输出只需：

- 是否存在
- 可选的 resolved path

第一阶段不必采集版本号，除非后续代码执行环境设计需要。

---

## 七、CLI 与 Agent 的关系设计

用户已经明确提出：需要一个 CLI 命令帮助 OMBot 的 Agent 感知环境。

这里建议不要把 CLI 命令本身当成最终能力，而是把 CLI 命令设计成“刷新宿主环境快照”的入口。

### 7.1 推荐 CLI 设计

建议新增命令：

- `/host`
- `/host refresh`
- `/host show`

推荐语义：

- `/host`
  - 展示当前环境摘要
- `/host refresh`
  - 重新采集宿主环境事实
  - 更新 `data/host/environment.json`
  - 重写 `workspace/HOST_PROFILE.md`
- `/host show`
  - 直接展示最近一次快照原文

### 7.2 为什么只做 CLI 不够

如果只有 CLI 命令，而没有统一快照文件，那么：

- Agent 不会自动知道刷新结果
- 模型仍然要依赖用户手动转述
- 环境认知仍然不稳定

所以正确链路应是：

```text
/host refresh
    ->
宿主采集环境事实
    ->
写入 environment.json + HOST_PROFILE.md
    ->
Agent 后续自动从 workspace/HOST_PROFILE.md 获得最新上下文
```

### 7.3 第二阶段建议

在 CLI 刷新入口之外，再补一个只读工具：

- `get_host_environment`

这样 Agent 在需要更精确事实时，也能主动拉取结构化快照，而不是只依赖启动时注入的 `HOST_PROFILE.md`。

---

## 八、建议的能力边界

### 8.1 第一阶段必须解决

- macOS / Linux 识别
- 架构识别
- 发行版/版本识别
- GUI 能力识别
- 容器迹象识别
- 用户与家目录识别
- `Desktop/Downloads/Documents` 解析
- 常用运行时可用性识别
- CLI 刷新命令
- 自动更新 `HOST_PROFILE.md`

### 8.2 第一阶段不要做太多

- 不要把资源监控和宿主画像混在一起
- 不要做完整软件清单扫描
- 不要做 root 权限探测
- 不要为了 GUI 识别引入复杂平台专用依赖
- 不要让 Agent 直接执行大量系统命令来自行拼环境画像

---

## 九、实现建议

### 9.1 模块划分

建议新增：

- `src/host/types.ts`
- `src/host/collector.ts`
- `src/host/render.ts`
- `src/host/files.ts`

职责：

- `types.ts`
  - 定义结构化环境快照
- `collector.ts`
  - 采集平台事实
- `render.ts`
  - 渲染 `HOST_PROFILE.md`
- `files.ts`
  - 读写 `environment.json` 和 `HOST_PROFILE.md`

### 9.2 CLI 接线

建议修改：

- `src/cli/commands.ts`
- `src/cli/repl.ts`
- `src/cli/render.ts`

新增：

- `/host`
- `/host refresh`
- `/host show`

### 9.3 配置

建议扩展：

- `config/ombot.yaml`

新增宿主快照配置段，例如：

```yaml
host_profile:
  auto_refresh_on_start: true
  json_path: "./data/host/environment.json"
  workspace_profile_path: "./workspace/HOST_PROFILE.md"
```

### 9.4 启动行为

建议在 `bootstrap` 或 `index` 中加入：

- 启动时自动刷新一次宿主快照

这样 Agent 每次启动都能拿到相对新鲜的环境事实。

---

## 十、风险与注意事项

### 10.1 事实不等于能力承诺

例如：

- 检测到 `docker` 命令存在
- 不等于当前用户一定能无障碍使用 Docker

因此建议输出用词保持克制：

- `available`
- `detected`

而不是：

- `guaranteed`

### 10.2 GUI 识别只能做“粗判断”

第一阶段目标是让 Agent 不再完全盲猜，而不是保证 100% 精确识别所有桌面会话。

### 10.3 容器识别也应是“迹象判断”

某些环境下：

- 宿主本身就在容器中
- 同时 OMBot execution mode 也是 host

这类情况应当被正确表示为：

- `executionMode=host`
- `insideDocker=true`

而不是互相覆盖。

---

## 十一、推荐落地顺序

### Phase 1

- 建立结构化环境快照模型
- 实现 macOS / Linux 基础采集
- 实现 `HOST_PROFILE.md` 自动渲染
- 增加 `/host`、`/host refresh`、`/host show`

### Phase 2

- 增加 `get_host_environment` 只读工具
- 在 prompt 中明确说明特殊路径语义
- 为 Agent 增加 `resolve_special_path` 能力

### Phase 3

- 将环境快照用于后续 Python/TS 执行环境选择
- 将环境快照用于更精细的安全执行策略

---

## 十二、结论

宿主环境认知能力不应理解为“再给 Agent 一些提示词”，而应理解为：

**把宿主环境事实建模为一个正式、可刷新、可读的系统能力。**

第一阶段最合理的方案是：

- CLI 提供显式刷新入口
- 宿主侧负责采集事实
- 结果写入 `environment.json` 与 `HOST_PROFILE.md`
- Agent 通过固定工作区文件获得稳定环境认知

这样既能解决当前“放到桌面”“有没有 GUI”“是不是 Docker”“能不能跑 Python”这些高频问题，也能为后续代码执行环境、安全执行策略、平台适配工具打基础。
