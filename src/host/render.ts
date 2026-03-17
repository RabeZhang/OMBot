import type { HostCapabilityStatus, HostEnvironmentSnapshot } from "./types";

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

function capabilityLine(name: string, status: HostCapabilityStatus): string {
  return status.available
    ? `- ${name}: yes (${status.resolvedPath ?? "detected"})`
    : `- ${name}: no`;
}

export function renderHostProfile(snapshot: HostEnvironmentSnapshot): string {
  const lines = [
    "# Host Profile",
    "",
    "## Platform",
    `- OS: ${snapshot.platform.distribution}${snapshot.platform.version ? ` ${snapshot.platform.version}` : ""}`,
    `- Kernel: ${snapshot.platform.kernel}`,
    `- Architecture: ${snapshot.platform.architecture}`,
    `- Hostname: ${snapshot.platform.hostname}`,
    "",
    "## Runtime",
    `- Execution mode: ${snapshot.runtime.executionMode}`,
    `- Inside Docker: ${yesNo(snapshot.runtime.insideDocker)}`,
    `- GUI available: ${yesNo(snapshot.runtime.gui.available)}`,
    `- GUI session: ${snapshot.runtime.gui.sessionType ?? "unknown"}`,
    `- Terminal: ${snapshot.runtime.terminal.termProgram ?? "unknown"}`,
    `- Shell: ${snapshot.runtime.terminal.shell ?? "unknown"}`,
    "",
    "## User",
    `- Username: ${snapshot.user.username}`,
    `- Home: ${snapshot.user.homeDir}`,
    "",
    "## Common Paths",
    `- Desktop: ${snapshot.paths.desktop.path} (${yesNo(snapshot.paths.desktop.exists)})`,
    `- Downloads: ${snapshot.paths.downloads.path} (${yesNo(snapshot.paths.downloads.exists)})`,
    `- Documents: ${snapshot.paths.documents.path} (${yesNo(snapshot.paths.documents.exists)})`,
    `- Workspace: ${snapshot.paths.workspace.path} (${yesNo(snapshot.paths.workspace.exists)})`,
    `- Data: ${snapshot.paths.data.path} (${yesNo(snapshot.paths.data.exists)})`,
    "",
    "## Available Tools",
    ...Object.entries(snapshot.capabilities).map(([name, status]) => capabilityLine(name, status)),
    "",
    "## Collection",
    `- Collected at: ${snapshot.collectedAt}`,
  ];

  return lines.join("\n");
}

export function renderHostSummary(snapshot: HostEnvironmentSnapshot): string {
  return [
    `  🖥  ${snapshot.platform.distribution}${snapshot.platform.version ? ` ${snapshot.platform.version}` : ""} / ${snapshot.platform.architecture}`,
    `  Runtime: mode=${snapshot.runtime.executionMode} docker=${yesNo(snapshot.runtime.insideDocker)} gui=${yesNo(snapshot.runtime.gui.available)}`,
    `  User: ${snapshot.user.username}  Home: ${snapshot.user.homeDir}`,
    `  Desktop: ${snapshot.paths.desktop.path} (${yesNo(snapshot.paths.desktop.exists)})`,
    `  Downloads: ${snapshot.paths.downloads.path} (${yesNo(snapshot.paths.downloads.exists)})`,
    `  Documents: ${snapshot.paths.documents.path} (${yesNo(snapshot.paths.documents.exists)})`,
  ].join("\n");
}
