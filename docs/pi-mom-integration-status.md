# pi-mom 能力嵌入 OMBot - 状态总结

**日期**: 2026-03-11

---

## 已完成 ✅

### 1. pi-mom bash 工具嵌入

**文件**: `src/tools/local/bash.ts`

**变更**: 完全使用 pi-mom 的 bash 工具替代原有实现

```typescript
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createBashTool as createMomBashTool } from "@mariozechner/pi-mom/dist/tools/bash.js";
```

**获得的能力提升**:

| 特性 | 原实现 | pi-mom |
|------|--------|--------|
| 输出截断 | 30KB / 200 行 | 50KB / 2000 行 |
| 超大输出处理 | 直接截断丢弃 | 保存到临时文件并提示路径 |
| 进程清理 | SIGTERM 简单处理 | 完整的进程树清理 |
| 截断提示 | 简单 "..." | 详细的行号范围信息 |
| timeout | 支持 | 支持 |
| AbortSignal | 支持 | 支持 |

**测试**: `tests/tools/bash.test.ts` - 9 个测试用例全部通过

---

### 2. pi-mom read 工具嵌入 ✅

**文件**: `src/tools/local/read.ts`

**变更**: 使用 pi-mom 的 read 工具实现文件读取

```typescript
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createReadTool as createMomReadTool } from "@mariozechner/pi-mom/dist/tools/read.js";
```

**获得的能力**:

| 特性 | 说明 |
|------|------|
| 文本读取 | 支持任意文本文件 |
| 分页读取 | offset（起始行，1-indexed）+ limit（最大行数）|
| 图片识别 | 支持 jpg, png, gif, webp（返回 base64）|
| 自动截断 | 50KB / 2000 行头部截断 |
| 智能提示 | 显示行号范围，提示如何继续读取 |
| 中断支持 | AbortSignal 支持 |

**测试**: `tests/tools/read.test.ts` - 10 个测试用例全部通过

**使用示例**:
```typescript
// 读取整个文件
read({ path: "/var/log/nginx/error.log" })

// 分页读取（第 100-200 行）
read({ path: "/var/log/syslog", offset: 100, limit: 100 })
```

---

### 3. pi-mom edit 工具嵌入 ✅

**文件**: `src/tools/local/edit.ts`

**变更**: 使用 pi-mom 的 edit 工具实现文件精确编辑

```typescript
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createEditTool as createMomEditTool } from "@mariozechner/pi-mom/dist/tools/edit.js";
```

**获得的能力**:

| 特性 | 说明 |
|------|------|
| 精确替换 | oldText 必须完全匹配（包括空白字符）|
| 唯一性检查 | 如果 oldText 出现多次会报错 |
| diff 预览 | 返回变更前后的对比 |
| 变更统计 | 显示修改的字符数 |
| 中断支持 | AbortSignal 支持 |

**测试**: `tests/tools/edit.test.ts` - 9 个测试用例全部通过

**使用示例**:
```typescript
// 修改 nginx 配置
edit({
  path: "/etc/nginx/nginx.conf",
  oldText: "listen 80;",
  newText: "listen 8080;"
})

// 修改环境变量
edit({
  path: "/etc/environment",
  oldText: "DEBUG=false",
  newText: "DEBUG=true"
})
```

---

## 已规划 📋

### Phase 1.1: write 工具（可选）

**需求**: 文件写入，自动创建父目录

**适用场景**:
- 创建新的配置文件
- 写入脚本文件

**设计**:
```typescript
import { createWriteTool } from "@mariozechner/pi-mom/dist/tools/write.js";
const writeTool = createWriteTool(executor);
```

**Risk Level**: `mutating`，需要确认

**工作量**: 0.5 天

---

### Phase 1.2: docker_bash 工具（按需）

**需求**: 在隔离 Docker 容器中执行命令

**适用场景**:
- 安装额外诊断工具（htop, iftop, nethogs）而不污染主机
- 运行不可信脚本
- 执行高风险操作（清理日志、重建索引）

**设计**:
```typescript
const executor = createExecutor({
  type: "docker",
  container: "ombot-sandbox"
});
```

**配置**:
- `config/ombot.yaml` 已添加 `execution` 配置段
- `config/tool_policy.yaml` 已添加 `docker_bash` profile

**前置条件**:
```bash
docker run -d --name ombot-sandbox alpine tail -f /dev/null
```

**工作量**: 1-2 天

---

## 文档更新 ✅

### 已更新文件

1. **`docs/phase1-design.md`**
   - 更新工具列表，添加 pi-mom 工具说明
   - 添加 `docker_bash` 到扩展工具列表

2. **`docs/pi-mom-integration-plan.md`** (新建)
   - 详细开发计划
   - docker_bash 设计文档
   - read/write/edit 评估

3. **`docs/pi-mom-integration-status.md`** (新建)
   - 当前状态跟踪

4. **`config/ombot.yaml`**
   - 添加 `execution` 配置段
   - 支持 mode: host | docker

5. **`config/tool_policy.yaml`**
   - 添加 `isolated` profile（docker_bash 专用）
   - 添加注释说明 pi-mom 工具规划
   - 添加 `read` 和 `edit` 工具到各 profile

6. **`src/config/schema.ts`**
   - 添加 `execution` schema
   - 支持 mode/dockerContainer/dockerOptions

7. **`src/tools/local/read.ts`** (新建)
   - pi-mom read 工具包装

8. **`src/tools/local/edit.ts`** (新建)
   - pi-mom edit 工具包装

9. **`src/tools/pi-tools.ts`**
   - 添加 read 和 edit 工具到工具列表

---

## 下一步决策

### 建议优先级

1. ✅ **P1 (已完成)**: `read` 工具
   - 日志分页查看是运维最高频操作

2. ✅ **P2 (已完成)**: `edit` 工具
   - 配置文件精确修改，带 diff 预览

3. **P3 (可选)**: `write` 工具
   - 创建脚本、配置文件
   - 工作量：0.5 天

4. **P4 (按需)**: `docker_bash`
   - 需要用户有 Docker 环境
   - 根据实际运维需求决定
   - 工作量：1-2 天

### 需要确认的问题

1. **OMBot CLI 是否支持图片显示？**
   - `read` 工具支持读取图片（jpg/png/gif/webp）
   - 如果 CLI 不支持显示图片，图片功能只是返回 base64 数据

2. **Docker 环境可用性？**
   - 如果目标部署环境没有 Docker，`docker_bash` 暂缓

3. **是否需要 write 工具？**
   - 当前可通过 `bash: echo` 或 `bash: cat` 创建文件
   - write 工具可以更方便地创建多行文件
   - 评估实际使用频率

---

## 测试状态

```
Test Files: 20 passed (20)
Tests:      96 passed (96)
Duration:   1.39s
```

所有测试通过，包括：
- 9 个 bash 工具测试（pi-mom 集成）
- 10 个 read 工具测试（pi-mom 集成）
- 9 个 edit 工具测试（pi-mom 集成）
- 原所有监控工具测试
- 配置加载测试
- Gateway 集成测试
