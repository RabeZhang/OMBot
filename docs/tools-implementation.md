# OMBot 工具封装实现说明

## 目录

1. [架构概览](#架构概览)
2. [工具封装模式](#工具封装模式)
3. [各工具详细实现](#各工具详细实现)
4. [与 pi-mom 的关系](#与-pi-mom-的关系)
5. [添加新工具指南](#添加新工具指南)

---

## 架构概览

### 工具层次结构

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Runtime                          │
│  (pi-agent-core / pi-rpc-agent)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                   OMBot Tool Adapter                        │
│  - src/tools/pi-tools.ts (工具聚合)                         │
│  - src/tools/local/*.ts (具体工具实现)                       │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                      pi-mom Tools                           │
│  - @mariozechner/pi-mom/dist/tools/*.js                     │
│  - bash, read, edit, write, grep, find                      │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    pi-mom Sandbox                           │
│  - Executor (host/docker 模式)                              │
│  - 命令执行、文件系统访问                                    │
└─────────────────────────────────────────────────────────────┘
```

### 核心设计原则

1. **复用 pi-mom**：所有本地工具都基于 pi-mom 实现，不重复造轮子
2. **统一接口**：通过适配器模式转换为 `AgentTool` 标准接口
3. **可扩展性**：新增工具只需创建包装文件并注册

---

## 工具封装模式

### 标准封装模板

所有基于 pi-mom 的工具遵循相同的封装模式：

```typescript
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createXxxTool as createMomXxxTool } from "@mariozechner/pi-mom/dist/tools/xxx.js";

export function createXxxTool(cwd: string): AgentTool {
  // 1. 创建 executor（host 模式在当前环境执行）
  const executor = createExecutor({ type: "host" });

  // 2. 获取 pi-mom 的工具实现
  const momXxxTool = createMomXxxTool(executor);

  // 3. 包装为 OMBot 兼容的工具
  return {
    name: "xxx",                    // 工具名称（英文，唯一标识）
    label: "XXX 工具",              // 工具显示名称（中文）
    description: "工具描述...",      // 详细描述，告诉 LLM 何时使用
    parameters: momXxxTool.parameters,  // 参数 schema（直接使用 pi-mom 的）
    async execute(
      _toolCallId: string,          // 工具调用 ID（追踪用）
      params: unknown,              // 调用参数
      signal?: AbortSignal,         // 取消信号
    ): Promise<AgentToolResult<unknown>> {
      // 4. 委托给 pi-mom 工具执行
      return momXxxTool.execute(_toolCallId, params, signal);
    },
  };
}
```

### 关键组件说明

#### 1. Executor（沙箱执行器）

```typescript
const executor = createExecutor({ type: "host" });
```

- **host 模式**：在当前主机环境直接执行（OMBot 当前使用）
- **docker 模式**：在 Docker 容器中执行（未来可扩展）

#### 2. AgentTool 接口

```typescript
interface AgentTool {
  name: string;           // 工具标识符
  label: string;          // 显示名称
  description: string;    // 功能描述（LLM 据此决定何时调用）
  parameters: TSchema;    // JSON Schema 参数定义
  execute: (             // 执行函数
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (update: ToolUpdate) => void
  ) => Promise<AgentToolResult<unknown>>;
}
```

#### 3. AgentToolResult 结果格式

```typescript
interface AgentToolResult<T = unknown> {
  content: Array<{
    type: "text" | "image";
    text?: string;
    mimeType?: string;
  }>;
  details?: T;  // 详细结果（可选，用于调试）
}
```

---

## 各工具详细实现

### 1. Bash 工具

**文件**：`src/tools/local/bash.ts`

**功能**：在本地执行 shell 命令

**pi-mom 来源**：`@mariozechner/pi-mom/dist/tools/bash.js`

**实现特点**：
- 支持超时控制（防止命令无限挂起）
- 支持工作目录指定
- 返回 stdout/stderr/exitCode

**代码实现**：
```typescript
export function createBashTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momBashTool = createMomBashTool(executor);

  return {
    name: "bash",
    label: "执行命令",
    description:
      `执行 bash 命令并返回输出。\n` +
      `支持设置超时时间，默认 30 秒。\n` +
      `可以指定工作目录。\n` +
      `适用于执行系统命令、查看状态、管理服务等。`,
    parameters: momBashTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momBashTool.execute(_toolCallId, params, signal);
    },
  };
}
```

**pi-mom 内部实现要点**：
- 使用 `child_process.spawn` 执行命令
- 通过 `printf` 处理特殊字符，避免 `heredoc` 问题
- 支持超时自动终止进程
- 返回标准输出、标准错误、退出码

---

### 2. Read 工具

**文件**：`src/tools/local/read.ts`

**功能**：读取文件内容

**pi-mom 来源**：`@mariozechner/pi-mom/dist/tools/read.js`

**实现特点**：
- 文本文件分页读取（offset/limit）
- 图片文件识别（OCR）
- 超大文件自动截断提示

**代码实现**：
```typescript
export function createReadTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momReadTool = createMomReadTool(executor);

  return {
    name: "read",
    label: "读取文件",
    description:
      `读取文件内容。支持文本文件和图片文件（jpg, png, gif, webp）。\n` +
      `文本文件自动截断到前 2000 行或 50KB。\n` +
      `支持 offset（起始行号，1-indexed）和 limit（最大行数）参数进行分页读取。\n` +
      `适用于查看配置文件、日志文件、截图分析等场景。`,
    parameters: momReadTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momReadTool.execute(_toolCallId, params, signal);
    },
  };
}
```

**pi-mom 内部实现要点**：
- 检测文件类型（文本 vs 图片）
- 文本文件：使用 `head`/`tail`/`cat` 命令分段读取
- 图片文件：使用 `sharp` + `tesseract.js` 进行 OCR 识别
- 自动截断超大文件，提示如何继续读取

---

### 3. Edit 工具

**文件**：`src/tools/local/edit.ts`

**功能**：精确编辑文件内容（部分替换）

**pi-mom 来源**：`@mariozechner/pi-mom/dist/tools/edit.js`

**实现特点**：
- oldText 必须精确匹配且唯一
- 使用 `sed` 进行原地替换
- 返回 diff 显示变更内容

**代码实现**：
```typescript
export function createEditTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momEditTool = createMomEditTool(executor);

  return {
    name: "edit",
    label: "编辑文件",
    description:
      `精确编辑文件内容，使用 oldText/newText 匹配替换。\n` +
      `要求 oldText 必须在文件中唯一且精确匹配。\n` +
      `适用于修改配置文件中的特定参数、更新代码行等场景。\n` +
      `不支持多行匹配，如需大范围修改请使用 write 工具。`,
    parameters: momEditTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momEditTool.execute(_toolCallId, params, signal);
    },
  };
}
```

**pi-mom 内部实现要点**：
1. 读取文件内容
2. 验证 oldText 存在且唯一
3. 使用 `sed` 命令进行替换（处理特殊字符转义）
4. 验证替换后内容变化
5. 返回变更 diff

**关键约束**：
- oldText 必须精确匹配（包括空格、缩进）
- oldText 在文件中只能出现一次
- 用于局部修改，不适用于大范围重写

---

### 4. Write 工具

**文件**：`src/tools/local/write.ts`

**功能**：创建或覆盖文件

**pi-mom 来源**：`@mariozechner/pi-mom/dist/tools/write.js`

**实现特点**：
- 自动创建父目录
- 使用 `printf` 处理特殊字符
- 完全覆盖现有文件

**代码实现**：
```typescript
export function createWriteTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momWriteTool = createMomWriteTool(executor);

  return {
    name: "write",
    label: "写入文件",
    description:
      `创建或覆盖文件内容。\n` +
      `如果文件不存在则创建，如果存在则完全覆盖。\n` +
      `自动创建所需的父目录。\n` +
      `适用于生成新配置文件、保存脚本、写入日志等场景。\n` +
      `注意：这是一个高风险操作，会覆盖现有文件。如需部分修改请使用 edit 工具。`,
    parameters: momWriteTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momWriteTool.execute(_toolCallId, params, signal);
    },
  };
}
```

**pi-mom 内部实现要点**：
1. 检查并创建父目录（`mkdir -p`）
2. 使用 `printf '%s'` 写入内容（正确处理特殊字符）
3. 返回写入字节数

**与 Edit 的区别**：

| 场景 | 推荐工具 |
|------|----------|
| 创建新文件 | `write` |
| 完全重写文件 | `write` |
| 修改一行配置 | `edit` |
| 更新变量值 | `edit` |

---

### 5. Grep 工具

**文件**：`src/tools/local/grep.ts`

**功能**：在文件中搜索文本

**pi-mom 来源**：`@mariozechner/pi-mom/dist/tools/grep.js`

**实现特点**：
- 支持正则表达式
- 支持递归搜索目录
- 显示匹配行号和上下文

**代码实现**：
```typescript
export function createGrepTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momGrepTool = createMomGrepTool(executor);

  return {
    name: "grep",
    label: "文本搜索",
    description:
      `在文件或目录中搜索匹配的文本内容。\n` +
      `支持正则表达式匹配。\n` +
      `支持递归搜索目录下的所有文件。\n` +
      `返回匹配的行号、内容和上下文。\n` +
      `适用于查找日志中的错误、搜索配置项、代码审查等场景。`,
    parameters: momGrepTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momGrepTool.execute(_toolCallId, params, signal);
    },
  };
}
```

**pi-mom 内部实现**：
- 使用系统 `grep` 命令
- 支持 `-r` 递归、`-n` 显示行号、`-i` 忽略大小写等选项

---

### 6. Find 工具

**文件**：`src/tools/local/find.ts`

**功能**：查找文件

**pi-mom 来源**：`@mariozechner/pi-mom/dist/tools/find.js`

**实现特点**：
- 按名称模式匹配
- 按文件类型过滤
- 限制搜索深度

**代码实现**：
```typescript
export function createFindTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momFindTool = createMomFindTool(executor);

  return {
    name: "find",
    label: "文件查找",
    description:
      `查找符合条件的文件。\n` +
      `支持按名称模式、文件类型过滤。\n` +
      `支持限制搜索深度。\n` +
      `适用于查找配置文件、定位日志位置、清理临时文件等场景。`,
    parameters: momFindTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momFindTool.execute(_toolCallId, params, signal);
    },
  };
}
```

**pi-mom 内部实现**：
- 使用系统 `find` 命令
- 支持 `-name`、`-type`、`-maxdepth` 等选项

---

## 与 pi-mom 的关系

### 职责划分

| 层级 | 职责 | 代表 |
|------|------|------|
| **pi-mom** | 工具底层实现 | 文件读写、命令执行、参数校验 |
| **OMBot Adapter** | 工具包装集成 | 描述文本、工具注册、接口适配 |
| **Agent Runtime** | 工具调度执行 | 调用决策、权限控制、结果渲染 |

### pi-mom 提供的核心能力

1. **Sandbox（执行沙箱）**
   ```typescript
   import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
   ```

2. **工具工厂函数**
   ```typescript
   import { createBashTool } from "@mariozechner/pi-mom/dist/tools/bash.js";
   import { createReadTool } from "@mariozechner/pi-mom/dist/tools/read.js";
   // ... 其他工具
   ```

3. **参数 Schema**
   每个工具都导出了标准的 JSON Schema 参数定义，OMBot 直接使用

### 为什么不直接用 pi-mom？

OMBot 需要：
1. **自定义描述**：根据运维场景定制工具描述，指导 LLM 何时使用
2. **本地化集成**：与 OMBot 的配置、策略、日志系统整合
3. **扩展能力**：未来可能需要添加 pi-mom 没有的工具

---

## 添加新工具指南

### 步骤 1：确认 pi-mom 是否已有实现

```typescript
// 检查 @mariozechner/pi-mom/dist/tools/ 下是否有对应工具
import { createXxxTool } from "@mariozechner/pi-mom/dist/tools/xxx.js";
```

### 步骤 2：创建工具包装文件

创建 `src/tools/local/xxx.ts`：

```typescript
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { createExecutor } from "@mariozechner/pi-mom/dist/sandbox.js";
import { createXxxTool as createMomXxxTool } from "@mariozechner/pi-mom/dist/tools/xxx.js";

export function createXxxTool(cwd: string): AgentTool {
  const executor = createExecutor({ type: "host" });
  const momXxxTool = createMomXxxTool(executor);

  return {
    name: "xxx",
    label: "XXX 工具",
    description:
      `工具功能描述...\n` +
      `适用场景说明...\n` +
      `注意事项...`,
    parameters: momXxxTool.parameters,
    async execute(
      _toolCallId: string,
      params: unknown,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      return momXxxTool.execute(_toolCallId, params, signal);
    },
  };
}
```

### 步骤 3：注册到工具集合

在 `src/tools/pi-tools.ts` 中：

```typescript
// 1. 导入
import { createXxxTool } from "./local/xxx";

// 2. 添加到 createAllPiTools
export function createAllPiTools(cwd: string): AgentTool[] {
  return [
    ...createPiLocalReadOnlyTools(),
    createBashTool(cwd),
    createReadTool(cwd),
    createEditTool(cwd),
    createWriteTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createXxxTool(cwd),  // 新增
  ];
}
```

### 步骤 4：添加测试

创建 `tests/tools/xxx.test.ts`：

```typescript
import { describe, expect, it } from "vitest";
import { createXxxTool } from "../../src/tools/local/xxx";

describe("xxx tool", () => {
  const xxxTool = createXxxTool(process.cwd());

  it("should do something", async () => {
    const result = await xxxTool.execute(
      "test-xxx-1",
      { /* 参数 */ },
      undefined,
    );
    expect(result.content[0].text).toContain("expected");
  });
});
```

### 步骤 5：配置工具策略（如需要）

在 `config/tool_policy.yaml` 中配置风险等级：

```yaml
profiles:
  readonly:
    allowedTools:
      # ... 其他工具

  readwrite:
    allowedTools:
      # ... 其他工具
      - xxx  # 新增工具
```

---

## 总结

### 当前基于 pi-mom 的工具列表

| 工具 | pi-mom 来源 | 风险等级 | 主要用途 |
|------|------------|----------|----------|
| bash | `tools/bash.js` | dangerous | 执行命令 |
| read | `tools/read.js` | readonly | 读取文件 |
| edit | `tools/edit.js` | readwrite | 部分编辑文件 |
| write | `tools/write.js` | dangerous | 创建/覆盖文件 |
| grep | `tools/grep.js` | readonly | 文本搜索 |
| find | `tools/find.js` | readonly | 文件查找 |

### 封装的价值

1. **统一接口**：所有工具对 Agent Runtime 呈现一致的 `AgentTool` 接口
2. **场景定制**：根据 OMBot 运维场景定制描述和示例
3. **易于扩展**：新增工具只需遵循模板，无需关心底层实现
4. **解耦依赖**：未来如果替换 pi-mom，只需修改适配层
