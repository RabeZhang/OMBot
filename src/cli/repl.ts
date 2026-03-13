import chalk from "chalk";
import {
  TUI,
  ProcessTerminal,
  Editor,
  Text,
  Markdown,
  Container,
  CombinedAutocompleteProvider,
} from "@mariozechner/pi-tui";

import type { Gateway } from "../gateway/types";
import {
  editorTheme,
  markdownTheme,
  toolCall as toolCallStyle,
  toolResult as toolResultStyle,
  systemMessage,
} from "./theme";
import { parseCliCommand } from "./commands";
import { renderSessionSummaries, renderHelp } from "./render";
import { createImmediateEventFile, deleteEventFile, listEventFiles, readEventFile } from "../events/files";

export interface CliReplOptions {
  gateway: Gateway;
  onMonitorMessage?: (callback: (message: string, type: "alert" | "recovered" | "info") => void) => void;
  eventsDir?: string;
  eventsEnabled?: boolean;
}

/**
 * 基于 pi-tui 的 TUI REPL — 渐进式披露模式。
 *
 * 工具调用实时显示，最终回复出现后折叠为摘要。
 */
export async function startCliRepl(options: CliReplOptions): Promise<void> {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  let activeSessionId: string | undefined;
  let agentRunning = false;
  let lastUserInput: string | undefined;

  // ── Session 列表缓存（用于 /use 1, /use 2 编号切换）──
  let sessionListCache: Array<{ sessionId: string; title?: string }> = [];

  // ── 消息区 ──
  const messagesContainer = new Container();
  tui.addChild(messagesContainer);

  // ── 自动补全 ──
  const autocompleteProvider = new CombinedAutocompleteProvider(
    [
      { name: "help", description: "查看帮助" },
      { name: "sessions", description: "列出当前会话" },
      { name: "use <id|number>", description: "切换到指定会话 (/use 1 或 /use sess_xxx)" },
      { name: "clear", description: "清除当前会话绑定" },
      { name: "events", description: "列出当前事件文件" },
      { name: "events show <file>", description: "查看指定事件文件内容" },
      { name: "event now <text>", description: "创建一个 immediate 事件" },
      { name: "event rm <file>", description: "删除指定事件文件" },
      { name: "monitor", description: "查看最近的监控告警" },
      { name: "expand", description: "展开折叠的工具调用 (可选: /expand <序号>)" },
      { name: "exit", description: "退出 CLI" },
    ],
    process.cwd(),
  );

  // ── Editor ──
  const editor = new Editor(tui, editorTheme);
  editor.setAutocompleteProvider(autocompleteProvider);
  tui.addChild(editor);

  // ── 辅助函数 ──
  function addTextMsg(text: string) {
    messagesContainer.addChild(new Text(text, 1, 0));
    tui.requestRender();
  }

  function addMarkdownMsg(content: string) {
    messagesContainer.addChild(new Markdown(content, 1, 1, markdownTheme));
    tui.requestRender();
  }

  function renderUserInput(text: string): string {
    return chalk.bgHex("#1e1e2e").white(` > ${text} `);
  }

  function formatMonitorMessage(message: string, type: "alert" | "recovered" | "info"): string {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;
    if (type === "alert") return chalk.yellow(`  ⚠️  [${ts}] ${message}`);
    if (type === "recovered") return chalk.green(`  ✅ [${ts}] ${message}`);
    return chalk.gray(`  ℹ️  [${ts}] ${message}`);
  }

  // ── Monitor 缓冲 ──
  const monitorHistory: Array<{ message: string; type: "alert" | "recovered" | "info"; ts: Date }> = [];
  const MAX_MONITOR_HISTORY = 20;

  // ── 折叠工具区历史（用于 /expand 展开）──
  const collapsedRuns: Array<{ label: string; lines: string[] }> = [];

  // 欢迎信息
  addTextMsg(systemMessage("OMBot CLI 已启动，输入 /help 查看命令。"));

  if (options.onMonitorMessage) {
    options.onMonitorMessage((message, type) => {
      monitorHistory.push({ message, type, ts: new Date() });
      if (monitorHistory.length > MAX_MONITOR_HISTORY) monitorHistory.shift();
    });
  }

  // ── 渐进式披露：处理 Agent 运行流 ──
  async function handleAgentMessage(content: string) {
    if (agentRunning) {
      addTextMsg(systemMessage("Agent 正在处理中，请稍候..."));
      return;
    }

    agentRunning = true;
    editor.disableSubmit = true;

    // 工具调用活跃区：Container + 追踪状态
    const toolContainer = new Container();
    messagesContainer.addChild(toolContainer);

    const toolRecord: Array<{
      name: string;
      inputSummary: string;
      resultSummary?: string;
      startedAt: number;
    }> = [];

    let currentToolStartedAt = 0;
    let assistantContent = "";

    function addToolLine(text: string) {
      toolContainer.addChild(new Text(text, 0, 0));
      tui.requestRender();
    }

    // 初始 "思考中" 状态
    addToolLine(systemMessage("⏳ Agent 思考中..."));

    try {
      // 生成 session title：取用户输入前 20 个字符
      const title = content.length > 20 ? content.slice(0, 20) + "..." : content;

      const handle = await options.gateway.sendUserMessage({
        content,
        sessionId: activeSessionId,
        title: title || undefined,
      });
      activeSessionId = handle.sessionId;

      // 清除"思考中"文字，开始实时流式展示
      messagesContainer.removeChild(toolContainer);
      const liveContainer = new Container();
      messagesContainer.addChild(liveContainer);

      function addLiveLine(text: string) {
        liveContainer.addChild(new Text(text, 0, 0));
        tui.requestRender();
      }

      for await (const event of handle.stream) {
        switch (event.type) {
          case "agent.start":
            addLiveLine(systemMessage("⏳ Agent 思考中..."));
            break;

          case "tool.call": {
            currentToolStartedAt = Date.now();
            const inputStr = JSON.stringify(event.toolInput);
            const inputSummary = inputStr.length > 60 ? inputStr.slice(0, 57) + "..." : inputStr;
            toolRecord.push({ name: event.toolName, inputSummary, startedAt: currentToolStartedAt });
            addLiveLine(toolCallStyle(`  ▶ ${event.toolName}  ${chalk.gray(inputSummary)}`));
            break;
          }

          case "tool.result": {
            const elapsed = Date.now() - currentToolStartedAt;
            const outputRaw = typeof event.toolOutput === "string"
              ? event.toolOutput
              : JSON.stringify(event.toolOutput ?? "");
            const preview = outputRaw.length > 80 ? outputRaw.slice(0, 77) + "..." : outputRaw;
            const resultSummary = `${preview}  ${chalk.gray(`(${elapsed}ms)`)}`;
            if (toolRecord.length > 0) {
              toolRecord[toolRecord.length - 1]!.resultSummary = resultSummary;
            }
            addLiveLine(toolResultStyle(`    └ ${resultSummary}`));
            break;
          }

          case "agent.message_update":
            assistantContent = event.content;
            break;

          case "agent.end": {
            // 折叠工具调用区 → 摘要行，并存入历史供 /expand 使用
            if (toolRecord.length > 0) {
              const totalElapsed = Math.round((Date.now() - toolRecord[0]!.startedAt) / 100) / 10;
              // 收集完整行
              const expandedLines: string[] = toolRecord.flatMap((t) => [
                toolCallStyle(`  ▶ ${t.name}  ${chalk.gray(t.inputSummary)}`),
                ...(t.resultSummary ? [toolResultStyle(`    └ ${t.resultSummary}`)] : []),
              ]);
              const runIndex = collapsedRuns.length + 1;
              collapsedRuns.push({ label: `第 ${runIndex} 次`, lines: expandedLines });
              messagesContainer.removeChild(liveContainer);
              const hint = chalk.gray(` (输入 /expand ${runIndex} 展开)`);
              const summaryLine = chalk.gray(`  ▼ ${toolRecord.length} 个工具调用，耗时 ${totalElapsed}s`) + hint;
              messagesContainer.addChild(new Text(summaryLine, 0, 0));
              tui.requestRender();
            } else {
              messagesContainer.removeChild(liveContainer);
            }
            break;
          }

          case "gateway.run.completed":
            break;
        }
      }

      // 渲染最终 Markdown 回复
      if (assistantContent) {
        addMarkdownMsg(assistantContent);
      }
    } catch (err) {
      addTextMsg(systemMessage(`[error] ${err instanceof Error ? err.message : String(err)}`));
    } finally {
      agentRunning = false;
      editor.disableSubmit = false;
    }
  }

  // ── 用户提交处理 ──
  const exitPromise = new Promise<void>((resolveExit) => {
    editor.onSubmit = async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const command = parseCliCommand(trimmed);
      addTextMsg(renderUserInput(trimmed));

      if (command.type === "exit") {
        // 兜底：如果 session 没有标题，用最后一次用户输入截断作为标题
        if (activeSessionId && lastUserInput) {
          const fallbackTitle = lastUserInput.length > 20
            ? lastUserInput.slice(0, 17) + "..."
            : lastUserInput;
          await options.gateway.updateSessionTitle(activeSessionId, fallbackTitle).catch(() => {});
        }
        addTextMsg(systemMessage("再见。"));
        tui.requestRender();
        setTimeout(() => { tui.stop(); resolveExit(); }, 100);
        return;
      }

      if (command.type === "help") { addTextMsg(renderHelp()); return; }

      if (command.type === "sessions") {
        const allSessions = await options.gateway.listSessions();
        const limit = command.limit ?? 10;

        // 缓存 session 列表用于编号切换（按 updatedAt 倒序，最新的在前面）
        sessionListCache = allSessions.map(s => ({ sessionId: s.sessionId, title: s.title }));

        if (limit === "all") {
          addTextMsg(renderSessionSummaries(allSessions, { limit: "all", total: allSessions.length }));
        } else {
          const limitedSessions = allSessions.slice(0, limit);
          addTextMsg(renderSessionSummaries(limitedSessions, { limit, total: allSessions.length }));
        }
        return;
      }

      if (command.type === "clear") {
        activeSessionId = undefined;
        addTextMsg(systemMessage("已清除当前会话绑定。"));
        return;
      }

      if (command.type === "events") {
        if (!options.eventsDir) {
          addTextMsg(systemMessage("当前未配置 events 目录。"));
          return;
        }

        if (command.action === "list") {
          const files = await listEventFiles(options.eventsDir);
          if (files.length === 0) {
            addTextMsg(systemMessage("当前没有事件文件。"));
            return;
          }

          addTextMsg(chalk.cyan.bold(`  ⏰ 当前 ${files.length} 个事件文件：`));
          for (const file of files) {
            addTextMsg(`  - ${file.filename}  ${chalk.gray(`${file.size}B ${file.updatedAt}`)}`);
          }
          return;
        }

        if (command.action === "show") {
          if (!command.filename) {
            addTextMsg(systemMessage("请提供事件文件名，例如 /events show example.json"));
            return;
          }

          try {
            const content = await readEventFile(options.eventsDir, command.filename);
            addTextMsg(chalk.cyan.bold(`  ⏰ ${command.filename}`));
            addTextMsg(content);
          } catch (error) {
            addTextMsg(systemMessage(`读取事件文件失败: ${error instanceof Error ? error.message : String(error)}`));
          }
          return;
        }
      }

      if (command.type === "event") {
        if (!options.eventsDir) {
          addTextMsg(systemMessage("当前未配置 events 目录。"));
          return;
        }

        if (command.action === "now") {
          if (!command.content) {
            addTextMsg(systemMessage("请提供事件内容，例如 /event now 检查 nginx 状态"));
            return;
          }

          const filename = await createImmediateEventFile(options.eventsDir, {
            text: command.content,
            sessionId: activeSessionId,
            title: command.content.slice(0, 20),
            profile: "readonly",
            metadata: {
              source: "cli",
            },
          });
          const extra = options.eventsEnabled ? "" : "（注意：events watcher 当前未启用，仅创建了文件）";
          addTextMsg(systemMessage(`已创建 immediate 事件: ${filename}${extra}`));
          return;
        }

        if (command.action === "rm") {
          if (!command.filename) {
            addTextMsg(systemMessage("请提供事件文件名，例如 /event rm example.json"));
            return;
          }

          try {
            await deleteEventFile(options.eventsDir, command.filename);
            addTextMsg(systemMessage(`已删除事件文件: ${command.filename}`));
          } catch (error) {
            addTextMsg(systemMessage(`删除事件文件失败: ${error instanceof Error ? error.message : String(error)}`));
          }
          return;
        }
      }

      if (command.type === "use") {
        let targetSessionId: string | undefined;

        if (command.sessionIndex !== undefined) {
          // 使用编号切换 /use 1, /use 2
          if (sessionListCache.length === 0) {
            // 如果缓存为空，先刷新列表
            const allSessions = await options.gateway.listSessions();
            sessionListCache = allSessions.map(s => ({ sessionId: s.sessionId, title: s.title }));
          }
          const idx = command.sessionIndex - 1; // 用户输入是 1-based
          if (idx < 0 || idx >= sessionListCache.length) {
            addTextMsg(systemMessage(`无效的编号: ${command.sessionIndex}，当前共有 ${sessionListCache.length} 个会话`));
            return;
          }
          targetSessionId = sessionListCache[idx]!.sessionId;
        } else if (command.sessionId) {
          // 使用 sessionId 切换 /use sess_xxx
          targetSessionId = command.sessionId;
        } else {
          addTextMsg(systemMessage("请提供 sessionId 或编号，例如 /use 1 或 /use sess_xxx"));
          return;
        }

        const snapshot = await options.gateway.getSession(targetSessionId);
        if (!snapshot) { addTextMsg(systemMessage(`未找到会话: ${targetSessionId}`)); return; }
        activeSessionId = snapshot.session.sessionId;

        // 加载并显示历史对话记录
        messagesContainer.clear();
        collapsedRuns.length = 0;

        if (snapshot.transcript.length > 0) {
          addTextMsg(systemMessage(`── 历史记录 (${snapshot.transcript.length} 条) ──`));

          let currentToolRun: Array<{
            name: string;
            inputSummary: string;
            resultSummary?: string;
            startedAt: number;
          }> = [];
          let toolRunStartTime = 0;

          for (const entry of snapshot.transcript) {
            switch (entry.kind) {
              case "message": {
                // 先处理之前累积的工具调用
                if (currentToolRun.length > 0) {
                  const totalElapsed = Math.round((Date.now() - toolRunStartTime) / 100) / 10;
                  const runIndex = collapsedRuns.length + 1;
                  const expandedLines = currentToolRun.flatMap((t) => [
                    toolCallStyle(`  ▶ ${t.name}  ${chalk.gray(t.inputSummary)}`),
                    ...(t.resultSummary ? [toolResultStyle(`    └ ${t.resultSummary}`)] : []),
                  ]);
                  collapsedRuns.push({ label: `第 ${runIndex} 次`, lines: expandedLines });
                  const hint = chalk.gray(` (输入 /expand ${runIndex} 展开)`);
                  const summaryLine = chalk.gray(`  ▼ ${currentToolRun.length} 个工具调用，耗时 ${totalElapsed}s`) + hint;
                  messagesContainer.addChild(new Text(summaryLine, 0, 0));
                  currentToolRun = [];
                }

                const role = entry.payload.role as string;
                const content = entry.payload.content as string;
                if (role === "user") {
                  addTextMsg(renderUserInput(content));
                } else if (role === "assistant" && content) {
                  addMarkdownMsg(content);
                }
                break;
              }

              case "tool_call": {
                if (currentToolRun.length === 0) {
                  toolRunStartTime = Date.now();
                }
                const toolName = entry.payload.toolName as string;
                const input = entry.payload.input as Record<string, unknown>;
                const inputStr = JSON.stringify(input);
                const inputSummary = inputStr.length > 60 ? inputStr.slice(0, 57) + "..." : inputStr;
                currentToolRun.push({ name: toolName, inputSummary, startedAt: Date.now() });
                break;
              }

              case "tool_result": {
                if (currentToolRun.length > 0) {
                  const tool = currentToolRun[currentToolRun.length - 1]!;
                  const elapsed = Date.now() - tool.startedAt;
                  const output = entry.payload.output;
                  const outputRaw = typeof output === "string" ? output : JSON.stringify(output ?? "");
                  const preview = outputRaw.length > 80 ? outputRaw.slice(0, 77) + "..." : outputRaw;
                  tool.resultSummary = `${preview}  ${chalk.gray(`(${elapsed}ms)`)}`;
                }
                break;
              }
            }
          }

          // 处理最后一批工具调用
          if (currentToolRun.length > 0) {
            const totalElapsed = Math.round((Date.now() - toolRunStartTime) / 100) / 10;
            const runIndex = collapsedRuns.length + 1;
            const expandedLines = currentToolRun.flatMap((t) => [
              toolCallStyle(`  ▶ ${t.name}  ${chalk.gray(t.inputSummary)}`),
              ...(t.resultSummary ? [toolResultStyle(`    └ ${t.resultSummary}`)] : []),
            ]);
            collapsedRuns.push({ label: `第 ${runIndex} 次`, lines: expandedLines });
            const hint = chalk.gray(` (输入 /expand ${runIndex} 展开)`);
            const summaryLine = chalk.gray(`  ▼ ${currentToolRun.length} 个工具调用，耗时 ${totalElapsed}s`) + hint;
            messagesContainer.addChild(new Text(summaryLine, 0, 0));
          }

          addTextMsg(systemMessage(`── 以上为历史记录，继续对话 ──`));
        } else {
          addTextMsg(systemMessage("该会话暂无历史记录。"));
        }

        tui.requestRender();
        addTextMsg(systemMessage(`已切换到会话: ${activeSessionId}`));
        return;
      }

      if (trimmed === "/monitor") {
        if (monitorHistory.length === 0) {
          addTextMsg(systemMessage("暂无监控告警记录。"));
        } else {
          addTextMsg(chalk.cyan.bold(`  📡 最近 ${monitorHistory.length} 条监控记录：`));
          for (const entry of monitorHistory) {
            addTextMsg(formatMonitorMessage(entry.message, entry.type));
          }
        }
        return;
      }

      // /expand [n] — 展开第 n 次（默认最后一次）折叠的工具调用区
      if (trimmed.startsWith("/expand")) {
        if (collapsedRuns.length === 0) {
          addTextMsg(systemMessage("暂无可展开的工具调用记录。"));
          return;
        }
        const arg = trimmed.slice(7).trim();
        const idx = arg ? parseInt(arg, 10) - 1 : collapsedRuns.length - 1;
        const run = collapsedRuns[idx];
        if (!run) {
          addTextMsg(systemMessage(`未找到第 ${idx + 1} 次工具调用记录，共 ${collapsedRuns.length} 次。`));
          return;
        }
        addTextMsg(chalk.cyan.bold(`  ▶ 展开${run.label}工具调用详情：`));
        for (const line of run.lines) addTextMsg(line);
        return;
      }

      // 记录最后一次用户输入（用于退出时兜底生成标题）
      lastUserInput = command.content ?? trimmed;
      await handleAgentMessage(lastUserInput);
    };
  });

  tui.start();
  tui.setFocus(editor);

  await exitPromise;
}
