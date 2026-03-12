# pi-mom 能力嵌入 OMBot 计划

**版本**: v0.1
**状态**: 进行中
**最后更新**: 2026-03-11

---

## 一、当前状态

### 1.1 已完成：pi-mom bash 工具嵌入

`src/tools/local/bash.ts` 已使用 pi-mom 的 bash 工具替代原有实现：

```typescript
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createBashTool as createMomBashTool } from "@mariozechner/pi-mom/dist/tools/bash.js";
```

**获得的能力提升**：
- 输出截断：50KB / 2000 行（原 30KB / 200 行）
- 超大输出自动保存到临时文件
- 更完善的进程树清理
- 统一的截断提示格式

---

## 二、Phase 1.1：docker_bash 工具

### 2.1 需求背景

在特定运维场景下，需要在隔离环境中执行命令：
- 安装额外诊断工具（如 `htop`, `iftop`, `nethogs`）而不污染主机
- 运行不可信脚本或未知来源的命令
- 执行可能破坏环境的高风险操作（清理日志、重建索引等）

### 2.2 设计

```typescript
// src/tools/local/docker-bash.ts
export function createDockerBashTool(
  containerName: string
): AgentTool {
  const executor = createExecutor({
    type: "docker",
    container
  });
  const momBashTool = createMomBashTool(executor);

  return {
    name: "docker_bash",
    label: "在隔离容器执行命令",
    description:
      `在预配置的 Docker 容器 '${containerName}' 中执行命令。` +
      `用于：安装诊断工具、运行不可信脚本、执行高风险操作。` +
      `容器必须与 OMBot 进程在同一 Docker daemon。`,
    riskLevel: "mutating",
    requiresConfirmation: true,
    // ...
  };
}
```

### 2.3 配置扩展

```yaml
# config/ombot.yaml
execution:
  mode: "host"  # host | docker
  docker_container: "ombot-sandbox"  # docker 模式时指定

tools:
  enable_docker_bash: false  # 是否启用 docker_bash 工具
```

### 2.4 Tool Policy 配置

```yaml
# config/tool_policy.yaml
profiles:
  readonly:
    allow:
      - bash  # 仅主机模式

  ops:
    allow:
      - bash
      - docker_bash
    require_confirmation:
      - docker_bash

  isolated:
    allow:
      - docker_bash  # 只允许隔离执行
    default: docker_bash
```

### 2.5 前置条件

用户需预先创建并运行沙箱容器：

```bash
# 创建沙箱容器（Alpine 轻量）
docker run -d --name ombot-sandbox \
  --restart unless-stopped \
  -v /var/log:/host/logs:ro \
  -v /etc:/host/etc:ro \
  alpine:latest tail -f /dev/null

# 或使用 Ubuntu（更完整的环境）
docker run -d --name ombot-sandbox \
  --restart unless-stopped \
  -v /var/log:/host/logs:ro \
  ubuntu:24.04 sleep infinity
```

### 2.6 工作量评估

| 任务 | 工作量 | 说明 |
|------|--------|------|
| docker-bash.ts 实现 | 低 | 参考现有 bash.ts 复制修改 |
| 配置扩展 | 低 | ombot.yaml + schema |
| 启动检查 | 中 | 验证容器存在且运行 |
| 测试用例 | 低 | 参考 bash.test.ts |
| 文档 | 低 | 使用说明 |

**总计**：1-2 天

---

## 三、Phase 1.2：read / write / edit 工具评估

### 3.1 pi-mom 工具能力

| 工具 | 功能 | OMBot 适用场景 | 当前替代方案 |
|------|------|---------------|-------------|
| `read` | 文件读取，支持 offset/limit 分页，图片识别 | 查看配置文件、日志分页读取 | `cat` via bash |
| `write` | 文件写入，自动创建父目录 | 创建配置文件、脚本 | `echo` via bash |
| `edit` | 精确文本替换，生成 diff 预览 | 修改 nginx 配置、环境变量 | `sed` via bash |

### 3.2 是否需要嵌入？

**现有方案（bash）的问题**：
1. **无分页能力**：`cat /var/log/syslog` 可能返回数十万行
2. **无智能截断**：bash 读文件没有 offset/limit 提示
3. **修改风险**：sed 命令容易出错，无 diff 预览
4. **图片支持**：无法读取截图、监控图表

**嵌入价值**：
- ✅ 日志文件分页读取（高价值）
- ✅ 配置文件精确编辑（高价值）
- ✅ 图片分析（中价值，如有监控图表）

### 3.3 嵌入方案

#### 方案 A：直接复用 pi-mom 工具（推荐）

```typescript
// src/tools/local/file-operations.ts
import { createReadTool } from "@mariozechner/pi-mom/dist/tools/read.js";
import { createWriteTool } from "@mariozechner/pi-mom/dist/tools/write.js";
import { createEditTool } from "@mariozechner/pi-mom/dist/tools/edit.js";

export function createFileTools(cwd: string) {
  const executor = createExecutor({ type: "host" });

  return [
    createReadTool(executor),
    createWriteTool(executor),
    createEditTool(executor),
  ];
}
```

**工作量**：低（1 天）

**注意事项**：
- pi-mom 的 `write` 和 `edit` 是 **mutating 操作**，需要配置 Tool Policy
- `edit` 工具要求精确匹配，需要良好的 error handling

#### 方案 B：扩展现有 OmbotToolDefinition 格式

将 pi-mom 工具包装为 OMBot 的内部格式：

```typescript
// 适配层
export function adaptMomTool(momTool: AgentTool): OmbotToolDefinition {
  return {
    name: momTool.name,
    description: momTool.description,
    riskLevel: momTool.name === "read" ? "readonly" : "mutating",
    requiresConfirmation: momTool.name !== "read",
    parametersSchema: momTool.parameters,
    execute: async (input, ctx) => {
      const result = await momTool.execute("", input, undefined);
      return result;
    },
  };
}
```

**工作量**：中（需要处理返回格式差异）

### 3.4 Risk Level 配置

```yaml
# config/tool_policy.yaml
profiles:
  readonly:
    allow:
      - bash
      - read          # 只读文件查看

  ops:
    allow:
      - bash
      - read
      - write         # 创建文件
      - edit          # 修改文件
    require_confirmation:
      - write
      - edit

  privileged:
    allow:
      - bash
      - read
      - write
      - edit
      - docker_bash
```

### 3.5 工作量评估（Phase 1.2）

| 任务 | 方案 A | 方案 B |
|------|--------|--------|
| 工具集成 | 低 | 中 |
| Tool Policy 配置 | 低 | 低 |
| 测试用例 | 中 | 中 |
| 文档 | 低 | 低 |
| **总计** | **1-2 天** | **2-3 天** |

---

## 四、开发计划汇总

### Phase 1.1：docker_bash（可选增强）

**目标**：支持隔离执行环境
**优先级**：P2（非阻塞，但运维场景有价值）
**工作量**：1-2 天
**依赖**：用户需预先创建 Docker 容器

### Phase 1.2：read / write / edit（推荐）

**目标**：完善文件操作能力
**优先级**：P1（日志查看是运维刚需）
**工作量**：1-2 天（方案 A）
**建议方案**：直接复用 pi-mom 工具（方案 A）

---

## 五、决策建议

### 建议执行顺序

1. **Phase 1.2 read 工具**（立即）
   - 日志查看是最高频运维操作
   - offset/limit 分页对 `/var/log` 必不可少

2. **Phase 1.2 edit 工具**（短期）
   - 配置文件修改（nginx, systemd）需要精确编辑
   - diff 预览降低误操作风险

3. **Phase 1.2 write 工具**（短期）
   - 创建脚本、配置文件

4. **Phase 1.1 docker_bash**（可选）
   - 根据实际运维需求决定
   - 如团队已有良好环境管理，可暂缓

### 下一步行动

如需继续开发，请确认：
1. 采用方案 A（直接复用 pi-mom）还是方案 B（适配层）？
2. Phase 1.1 docker_bash 是否需要实现？
3. read 工具的图片支持是否需要？（OMBot CLI 是否能显示图片？）
