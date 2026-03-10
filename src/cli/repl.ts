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

export interface CliReplOptions {
  gateway: Gateway;
  onMonitorMessage?: (callback: (message: string, type: "alert" | "recovered" | "info") => void) => void;
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

  // ── 消息区 ──
  const messagesContainer = new Container();
  tui.addChild(messagesContainer);

  // ── 自动补全 ──
  const autocompleteProvider = new CombinedAutocompleteProvider(
    [
      { name: "help", description: "查看帮助" },
      { name: "sessions", description: "列出当前会话" },
      { name: "use", description: "切换到指定会话" },
      { name: "clear", description: "清除当前会话绑定" },
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
      const handle = await options.gateway.sendUserMessage({
        content,
        sessionId: activeSessionId,
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
        addTextMsg(systemMessage("再见。"));
        tui.requestRender();
        setTimeout(() => { tui.stop(); resolveExit(); }, 100);
        return;
      }

      if (command.type === "help") { addTextMsg(renderHelp()); return; }

      if (command.type === "sessions") {
        const sessions = await options.gateway.listSessions();
        addTextMsg(renderSessionSummaries(sessions));
        return;
      }

      if (command.type === "clear") {
        activeSessionId = undefined;
        addTextMsg(systemMessage("已清除当前会话绑定。"));
        return;
      }

      if (command.type === "use") {
        if (!command.sessionId) {
          addTextMsg(systemMessage("请提供 sessionId，例如 /use sess_xxx"));
          return;
        }
        const snapshot = await options.gateway.getSession(command.sessionId);
        if (!snapshot) { addTextMsg(systemMessage(`未找到会话: ${command.sessionId}`)); return; }
        activeSessionId = snapshot.session.sessionId;
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

      await handleAgentMessage(command.content ?? trimmed);
    };
  });

  tui.start();
  tui.setFocus(editor);

  await exitPromise;
}