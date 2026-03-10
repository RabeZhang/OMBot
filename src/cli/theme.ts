import chalk from "chalk";
import type { EditorTheme } from "@mariozechner/pi-tui";
import type { MarkdownTheme } from "@mariozechner/pi-tui";
import type { SelectListTheme } from "@mariozechner/pi-tui";

/**
 * OMBot TUI 主题。
 */

const selectListTheme: SelectListTheme = {
  selectedPrefix: (s) => chalk.cyan(s),
  selectedText: (s) => chalk.bold.cyan(s),
  description: (s) => chalk.gray(s),
  scrollInfo: (s) => chalk.gray(s),
  noMatch: (s) => chalk.gray(s),
};

export const editorTheme: EditorTheme = {
  borderColor: (s) => chalk.gray(s),
  selectList: selectListTheme,
};

export const markdownTheme: MarkdownTheme = {
  heading: (s) => chalk.bold.cyan(s),
  link: (s) => chalk.underline.blue(s),
  linkUrl: (s) => chalk.gray(s),
  code: (s) => chalk.yellow(s),
  codeBlock: (s) => chalk.white(s),
  codeBlockBorder: (s) => chalk.gray(s),
  quote: (s) => chalk.italic.gray(s),
  quoteBorder: (s) => chalk.gray(s),
  hr: (s) => chalk.gray(s),
  listBullet: (s) => chalk.cyan(s),
  bold: (s) => chalk.bold(s),
  italic: (s) => chalk.italic(s),
  strikethrough: (s) => chalk.strikethrough(s),
  underline: (s) => chalk.underline(s),
};

/** 工具调用颜色 */
export const toolCall = (s: string) => chalk.blue(s);
export const toolResult = (s: string) => chalk.gray(s);

/** Agent 状态颜色 */
export const agentStart = (s: string) => chalk.cyan(s);

/** 系统消息 */
export const systemMessage = (s: string) => chalk.gray(s);
export const errorMessage = (s: string) => chalk.red(s);
