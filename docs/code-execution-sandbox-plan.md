# OMBot 标准代码执行环境设计

**版本**: v0.1  
**状态**: 草案  
**最后更新**: 2026-03-18

---

## 一、文档目标

本文档用于定义 OMBot 的“标准代码执行环境”设计方案。

目标不是简单增加一个“能跑代码”的工具，而是建立一套：

- 默认隔离
- 可审计
- 可扩展
- 与安全执行层统一协作

的标准执行能力。

本文档聚焦 Linux 场景。  
macOS 只做开发阶段兼容，不作为第一优先级平台。

---

## 二、结论先行

推荐方案：

- **默认使用本地沙箱执行代码**
- **Docker 作为可选增强后端**
- **默认禁止在 host 中直接执行代码**
- **Agent 只看到“代码执行能力”，不直接决定执行后端**

也就是说，推荐采用：

```text
Agent
  -> python_run / ts_run
  -> CodeExecutionGateway
  -> BackendSelector
     - local_sandbox   (默认)
     - docker_sandbox  (可选增强)
     - host            (默认禁用，不作为常规路径)
```

这里的关键不是“二选一”，而是：

- **产品默认能力不依赖 Docker**
- **隔离能力不只靠 Docker**
- **Docker 能力作为增强选项存在**

---

## 三、设计原则

### 3.1 Linux 优先

第一阶段以 Linux 为主平台，原因：

- 后续生产部署主要面向 Linux
- Linux 下更容易实现稳定的受控执行环境
- 资源限制、命名空间、临时目录隔离等机制更成熟

macOS 的目标是：

- 允许开发调试
- 基本兼容
- 不为其单独设计重型隔离机制

### 3.2 默认隔离

代码执行能力与普通 `bash` 排障能力不同。

要求：

- 默认必须在隔离执行环境中运行
- 不允许默认直接在宿主机运行 Python / TS 代码
- `host` 执行只能作为显式允许的特殊降级路径

### 3.3 Agent 不选择后端

Agent 应调用：

- `python_run`
- `ts_run`

而不是直接调用：

- `docker_bash`
- `host_python`
- `local_sandbox_python`

原因：

- 执行后端属于宿主安全决策
- 不能让模型自行选择隔离级别
- 后端切换应由配置与宿主能力决定

### 3.4 与安全执行层统一

标准代码执行环境不是独立于安全执行体系之外的新系统。

它应当与现有安全执行层共享这些能力：

- 风险分级
- 审批机制
- 审计记录
- 执行环境选择
- transcript 回放

换句话说：

- `python_run / ts_run` 是新的高风险工具
- 但它们不应各自重新发明一套审批与执行控制逻辑

---

## 四、为什么不采用“只依赖 Docker”

如果标准代码执行能力完全绑定 Docker，会有几个明显问题：

- 宿主机必须安装 Docker
- 需要处理 Docker daemon、镜像、容器生命周期
- 某些轻量 Linux 环境不一定方便启用 Docker
- 一旦 Docker 不可用，代码执行能力整体失效

这会让 OMBot 的部署要求明显提高，不利于后续推广。

因此：

- Docker 不应成为前置依赖
- Docker 更适合作为“可选增强后端”

---

## 五、为什么不采用“只做本地沙箱”

只做本地沙箱虽然可以降低部署门槛，但也有局限：

- 更强隔离需求下，容器边界仍然有价值
- 依赖预装、镜像复用、环境清理，Docker 更成熟
- 某些复杂执行场景，容器更适合作为长期增强路径

所以更合理的做法不是排斥 Docker，而是：

- **默认不依赖 Docker**
- **保留 Docker 增强能力**

---

## 六、建议架构

### 6.1 Agent 可见工具

对 Agent 暴露的标准代码执行工具建议只有两类：

- `python_run`
- `ts_run`

必要时可扩展：

- `shell_script_run`

但第一阶段不建议继续暴露过多语言工具。

### 6.2 宿主内部组件

建议新增：

- `CodeExecutionGateway`
- `CodeExecutionBackend`
- `BackendSelector`
- `LocalSandboxBackend`
- `DockerSandboxBackend`

建议路径：

```text
src/code-execution/
  types.ts
  gateway.ts
  backend.ts
  backends/
    local-sandbox.ts
    docker-sandbox.ts
  render.ts
```

### 6.3 推荐调用链

```text
Agent tool call
    |
    v
CodeExecutionGateway.execute()
    |
    +--> Risk / Approval check
    |
    +--> BackendSelector.select()
    |
    +--> Backend.run()
    |
    +--> Audit / Transcript
    |
    v
Tool result
```

---

## 七、执行后端设计

### 7.1 Local Sandbox Backend（默认）

这是第一阶段的主后端。

特点：

- 不依赖 Docker
- 部署门槛低
- 作为 OMBot 标准代码执行能力的默认实现

建议能力：

- 独立临时工作目录
- 限制执行超时
- 限制输出大小
- 默认禁网
- 限制可读写路径
- 支持 copy-in / copy-out
- 支持预置 Python / TS 环境

适用场景：

- 数据处理
- 文本解析
- 小型脚本执行
- 报告生成
- 格式转换

### 7.2 Docker Sandbox Backend（可选增强）

这是增强后端，不是默认前提。

启用条件：

- 宿主机可用 Docker
- 配置显式开启
- 安全策略允许

适合作用：

- 更强隔离
- 统一镜像环境
- 更稳定的依赖预装
- 更重的代码执行任务

不建议：

- 让 Agent 直接知道“现在我要选 Docker”
- 把 Docker 作为默认唯一路径

### 7.3 Host Backend（默认禁用）

`host` 不应该作为标准代码执行的常规后端。

建议仅在以下情况下允许：

- 调试模式
- 用户显式启用
- 高等级审批通过
- 明确记录审计

默认规则：

- `host` 不能作为自动 fallback
- Docker 不可用时，也不应自动退回 `host`

---

## 八、沙箱能力要求

### 8.1 文件系统隔离

默认要求：

- 每次执行使用独立工作目录
- 不直接暴露宿主机任意路径
- 不默认挂载整个 OMBot workspace

建议支持：

- `copyIn`
- `copyOut`
- `allowedReadPaths`
- `allowedWritePaths`

### 8.2 网络隔离

默认要求：

- 禁网

原因：

- 避免 Agent 在代码执行里绕过工具边界直接联网
- 降低供应链与外部依赖风险

后续可扩展：

- 显式 `network: enabled`
- 但应作为更高风险等级处理

### 8.3 资源限制

至少应支持：

- 超时限制
- CPU 限制
- 内存限制
- 输出大小限制
- 临时目录大小限制

### 8.4 产物导出

执行结果不应默认散落到宿主文件系统。

建议：

- 产物先留在沙箱工作目录
- 由宿主侧决定哪些文件可以导出
- 导出路径同样属于受控行为

---

## 九、标准环境设计

### 9.1 Python 环境

建议提供一个默认的 Python 沙箱环境。

特点：

- 预装常用包
- 环境固定
- 不允许运行时随意联网装包

建议预装方向：

- `requests`
- `pandas`
- `numpy`
- `pyyaml`
- `matplotlib`（可选）

原则：

- 不是为了“尽可能多装”
- 而是为了满足常见运维辅助任务

### 9.2 TypeScript 环境

建议提供一个默认的 TS/Node 沙箱环境。

特点：

- 预装 `node`
- 预装 `tsx`
- 支持运行单文件脚本

可选预装：

- `zod`
- `yaml`
- 常见 CLI 辅助包

### 9.3 不建议第一阶段支持

- 任意 `pip install`
- 任意 `npm install`
- 用户自定义镜像构建
- 多语言自由扩展

这些能力会显著扩大安全面和实现复杂度。

---

## 十、工具接口建议

### 10.1 `python_run`

建议输入：

```json
{
  "code": "print('hello')",
  "files": [],
  "timeoutSec": 20
}
```

建议输出：

```json
{
  "ok": true,
  "stdout": "hello\n",
  "stderr": "",
  "exitCode": 0,
  "artifacts": []
}
```

### 10.2 `ts_run`

建议输入：

```json
{
  "code": "console.log('hello')",
  "files": [],
  "timeoutSec": 20
}
```

建议输出结构与 `python_run` 尽量一致。

### 10.3 不向 Agent 暴露后端字段

不建议把这些字段暴露给 Agent：

- `backend`
- `docker`
- `host`
- `sandboxType`

这些应由宿主选择，而不是由模型选择。

---

## 十一、与安全执行层的关系

标准代码执行环境本质上属于高风险执行能力。

因此建议：

- `python_run` / `ts_run` 风险等级至少视为 `privileged`
- 默认需要审批
- 若启用自动放行模式，也应单独可控

建议链路：

```text
Agent
  -> python_run / ts_run
  -> secure execution / approval
  -> backend selector
  -> sandbox backend
  -> result
```

与现有安全执行体系的关系：

- 不是替代关系
- 而是新增一类执行目标

未来可以把：

- `bash`
- `edit`
- `write`
- `python_run`
- `ts_run`

统一纳入同一个执行控制面。

---

## 十二、配置建议

建议扩展 `ombot.yaml`：

```yaml
code_execution:
  enabled: true
  default_backend: local_sandbox
  allow_host_fallback: false

  local_sandbox:
    enabled: true
    network_enabled: false
    timeout_sec: 20
    memory_mb: 512
    cpu_quota: 1
    workdir_root: "./data/code-sandbox"

  docker_sandbox:
    enabled: false
    image: "ombot-code-sandbox:latest"
    network_enabled: false
    timeout_sec: 20
    memory_mb: 512
    cpu_quota: 1
```

核心原则：

- 默认后端是 `local_sandbox`
- Docker 默认关闭
- Host fallback 默认关闭

---

## 十三、推荐落地顺序

### Phase 1

- 定义 `CodeExecutionGateway`
- 定义统一后端接口
- 实现 `LocalSandboxBackend`
- 增加 `python_run` / `ts_run`
- 接入审批与审计

### Phase 2

- 接入 `DockerSandboxBackend`
- 支持 Linux 下更强隔离
- 支持预制镜像

### Phase 3

- 将代码执行能力与更完整的安全策略联动
- 按宿主环境能力选择更优后端
- 支持更受控的依赖扩展

---

## 十四、最终结论

对于 OMBot，最稳的方案不是：

- 只依赖 Docker
- 或只做一种本地沙箱

而是：

- **架构上保留多后端抽象**
- **产品默认走本地沙箱**
- **Docker 作为可选增强**
- **Host 执行默认禁用**
- **Agent 不拥有后端选择权**

这套设计既能满足 Linux 场景下的实际部署需求，也能与 OMBot 已有的安全执行体系自然衔接，为后续 Python / TS 标准执行环境提供稳定基础。
