# 标准代码执行环境 Phase 1 最小实现清单

**版本**: v0.1  
**状态**: 开发清单  
**最后更新**: 2026-03-18

---

## 一、范围

本清单只覆盖标准代码执行环境的第一阶段最小闭环：

- `LocalSandboxBackend`
- `CodeExecutionGateway`
- `python_run`
- `ts_run`
- 与现有安全执行层接线

明确不做：

- `DockerSandboxBackend`
- `docker_bash` 集成
- 任意联网装包
- host 自动 fallback
- 多语言扩展

---

## 二、目标结果

完成后应达到：

1. Agent 可以调用 `python_run`
2. Agent 可以调用 `ts_run`
3. 两者默认都在本地沙箱中执行
4. 默认禁网
5. 默认不直接访问宿主文件系统
6. 调用进入现有审批 / 审计 / transcript 链
7. 不依赖 Docker

---

## 三、实现原则

### 3.1 Agent 只看到语言能力

对 Agent 暴露：

- `python_run`
- `ts_run`

不暴露：

- `local_sandbox`
- `host_backend`
- `docker_backend`

### 3.2 Host 默认禁用

Phase 1 明确要求：

- 不实现 host fallback
- backend 只有 `local_sandbox`

### 3.3 网络默认关闭

代码执行环境不应默认联网。

### 3.4 与安全执行层统一

`python_run / ts_run` 应视为高风险执行能力，纳入现有：

- `secure-execution`
- `ApprovalCenter`
- `AuditStore`
- transcript

---

## 四、建议新增模块

建议新增目录：

```text
src/code-execution/
  types.ts
  gateway.ts
  sandbox.ts
  backends/
    local-sandbox.ts
```

### 4.1 `src/code-execution/types.ts`

定义：

- `CodeLanguage = "python" | "typescript"`
- `CodeExecutionRequest`
- `CodeExecutionResult`
- `CodeExecutionArtifact`
- `CodeExecutionBackend`

建议字段：

```ts
interface CodeExecutionRequest {
  language: "python" | "typescript";
  code: string;
  files?: Array<{
    path: string;
    content: string;
  }>;
  timeoutSec?: number;
}

interface CodeExecutionResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  artifacts: Array<{
    path: string;
    sizeBytes: number;
  }>;
}
```

### 4.2 `src/code-execution/backends/local-sandbox.ts`

职责：

- 创建临时工作目录
- 写入输入文件
- 写入入口脚本
- 调用预置 Python / TS 运行时
- 捕获 stdout / stderr / exitCode
- 扫描允许导出的产物
- 清理临时目录

第一阶段建议：

- Python 通过固定解释器执行
- TS 通过固定 `tsx` 或 node+runner 执行
- 运行目录位于 `data/code-sandbox/runs/<id>`

### 4.3 `src/code-execution/sandbox.ts`

职责：

- 公共沙箱文件操作
- 路径校验
- 临时目录管理
- copy-in / artifact 收集

### 4.4 `src/code-execution/gateway.ts`

职责：

- 接收 `CodeExecutionRequest`
- 调用 backend
- 统一结果结构

Phase 1 这里不做复杂 backend 选择，只固定调用 `LocalSandboxBackend`。

---

## 五、建议修改模块

### 5.1 `src/config/schema.ts`

新增 `codeExecution` 配置段。

建议字段：

```yaml
code_execution:
  enabled: true
  timeout_sec: 20
  network_enabled: false
  workdir_root: "./data/code-sandbox"
  python_bin: "python3"
  ts_runner: "tsx"
```

### 5.2 `src/config/normalize.ts`

将：

- `codeExecution.workdirRoot`

标准化为绝对路径。

### 5.3 `config/ombot.yaml`

补默认配置：

```yaml
code_execution:
  enabled: true
  timeout_sec: 20
  network_enabled: false
  workdir_root: "./data/code-sandbox"
  python_bin: "python3"
  ts_runner: "tsx"
```

### 5.4 `src/bootstrap.ts`

新增：

- 创建 `LocalSandboxBackend`
- 创建 `CodeExecutionGateway`
- 把 `python_run / ts_run` 工具接进工具链
- 确保 `workdir_root` 存在

### 5.5 `src/tools/pi-tools.ts`

新增两个工具工厂：

- `createPythonRunTool(...)`
- `createTsRunTool(...)`

这两个工具内部不直接自己执行逻辑，而是调用 `CodeExecutionGateway`。

### 5.6 `src/tools/secure-execution.ts`

将：

- `python_run`
- `ts_run`

加入受保护工具集合。

建议默认：

- 视为 `privileged`
- 需要审批

### 5.7 `src/tools/risk-inspector.ts`

新增：

- `python_run` 风险说明
- `ts_run` 风险说明

建议原因文案：

- “代码执行会在沙箱中运行自定义脚本”

---

## 六、工具接口建议

### 6.1 `python_run`

参数：

```json
{
  "code": "print('hello')",
  "files": [],
  "timeoutSec": 20
}
```

返回：

```json
{
  "ok": true,
  "exitCode": 0,
  "stdout": "hello\n",
  "stderr": "",
  "artifacts": []
}
```

### 6.2 `ts_run`

参数结构与 `python_run` 一致，只切换语言。

### 6.3 第一阶段不建议支持

- `backend`
- `network`
- `pip install`
- `npm install`
- `env`
- `cwd`

这些字段会显著放大安全面。

---

## 七、本地沙箱实现要求

### 7.1 工作目录

每次运行使用独立目录，例如：

```text
data/code-sandbox/runs/run_xxx/
```

### 7.2 允许的输入

只允许：

- 代码文本
- 显式传入的文件

不允许：

- 默认读取任意宿主路径

### 7.3 网络

Phase 1 直接规定：

- 默认禁网

若 Linux 下短期内无法做到真正硬禁网，则第一阶段至少做到：

- 不向 Agent 暴露任何联网选项
- 在文档中明确这是“逻辑禁用，后续补更硬隔离”

### 7.4 输出限制

至少支持：

- `stdout` 截断
- `stderr` 截断
- 超时中断

### 7.5 产物导出

第一阶段建议只做最小支持：

- 扫描工作目录中生成的文件
- 返回 artifact 元数据

不立即做：

- 自动写回宿主 workspace

---

## 八、建议开发顺序

### Step 1

先补配置层：

- `schema.ts`
- `normalize.ts`
- `ombot.yaml`

### Step 2

新增代码执行领域模型：

- `types.ts`
- `sandbox.ts`
- `local-sandbox.ts`
- `gateway.ts`

### Step 3

新增工具：

- `python_run`
- `ts_run`

并接到：

- `pi-tools.ts`
- `bootstrap.ts`

### Step 4

接入安全执行层：

- `secure-execution.ts`
- `risk-inspector.ts`

### Step 5

补测试：

- backend 单测
- 工具单测
- 配置单测
- 最小集成测试

---

## 九、测试建议

建议新增：

```text
tests/code-execution/
  local-sandbox.test.ts
  gateway.test.ts
```

以及补充：

- `tests/config/loader.test.ts`
- `tests/tools/pi-tools.test.ts`
- `tests/tools/secure-execution.test.ts`

### 9.1 应覆盖的场景

#### LocalSandboxBackend

- Python 成功执行
- TS 成功执行
- 超时中断
- 输出截断
- 临时目录清理

#### CodeExecutionGateway

- 正常执行结果透传
- backend 抛错转标准错误

#### 安全执行层

- `python_run` 触发审批
- `ts_run` 触发审批
- 审批通过后恢复执行
- 审批拒绝后终止当前 run

---

## 十、Phase 1 验收标准

满足以下条件即可视为 Phase 1 完成：

1. `python_run` 可在本地沙箱执行简单脚本
2. `ts_run` 可在本地沙箱执行简单脚本
3. 默认不依赖 Docker
4. 默认不允许 host 直接执行代码
5. 两个工具均接入审批与审计
6. 有最小测试覆盖

---

## 十一、当前结论

当前阶段最合理的实现路径是：

- **先把标准代码执行做成 Linux 优先的本地沙箱能力**
- **先不做 Docker 后端**
- **先不做 host fallback**
- **先把 `python_run / ts_run` 接进现有安全执行体系**

这样可以最小成本地建立起一条可控、可迭代的主线，后续再在此基础上补 `DockerSandboxBackend`。
