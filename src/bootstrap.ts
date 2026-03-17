import fs from "node:fs/promises";
import path from "node:path";

import { buildPromptContext } from "./agent/context";
import { PiAgentRuntimeAdapter } from "./agent/pi-runtime";
import { InMemoryApprovalCenter } from "./gateway/approvals";
import { GatewayCore } from "./gateway/core";
import { InMemoryEventBus } from "./gateway/event-bus";
import { loadProjectEnv } from "./config/dotenv";
import { FileSystemConfigLoader } from "./config/loader";
import { FileSessionStore } from "./memory/session-store";
import { FileTranscriptStore } from "./memory/transcript-store";
import { InMemoryToolApprovalModeController } from "./tools/approval-mode";
import { createAllPiTools } from "./tools/pi-tools";
import { createPiModel } from "./llm/pi-model";
import { MonitorEngine } from "./monitor/engine";
import { SqliteAuditStore } from "./audit/sqlite-store";
import { EventsWatcher } from "./events/watcher";
import { HostEnvironmentCollector } from "./host/collector";
import { HostProfileManager } from "./host/files";

async function ensureRuntimeDirs(paths: {
  dataDir: string;
  transcriptsDir: string;
  auditDbPath: string;
  hostProfileJsonPath: string;
  hostWorkspaceProfilePath: string;
}) {
  await fs.mkdir(paths.dataDir, { recursive: true });
  await fs.mkdir(paths.transcriptsDir, { recursive: true });
  await fs.mkdir(path.dirname(paths.auditDbPath), { recursive: true });
  await fs.mkdir(path.dirname(paths.hostProfileJsonPath), { recursive: true });
  await fs.mkdir(path.dirname(paths.hostWorkspaceProfilePath), { recursive: true });
}

export async function bootstrap(projectRoot: string) {
  // bootstrap 负责把当前阶段的运行时组件组装起来，供 CLI 和测试共同复用。
  loadProjectEnv(projectRoot);

  const configLoader = new FileSystemConfigLoader();
  const config = await configLoader.load(`${projectRoot}/config`);
  await ensureRuntimeDirs({
    ...config.ombot.paths,
    hostProfileJsonPath: config.ombot.hostProfile.jsonPath,
    hostWorkspaceProfilePath: config.ombot.hostProfile.workspaceProfilePath,
  });

  const hostProfileManager = new HostProfileManager({
    collector: new HostEnvironmentCollector({
      executionMode: config.ombot.execution.mode,
      workspaceDir: config.ombot.paths.workspaceDir,
      dataDir: config.ombot.paths.dataDir,
    }),
    paths: {
      jsonPath: config.ombot.hostProfile.jsonPath,
      workspaceProfilePath: config.ombot.hostProfile.workspaceProfilePath,
    },
  });

  if (config.ombot.hostProfile.autoRefreshOnStart) {
    await hostProfileManager.refresh();
  }

  const eventBus = new InMemoryEventBus();
  const approvalCenter = new InMemoryApprovalCenter({
    eventBus,
    persistenceFilePath: path.join(config.ombot.paths.dataDir, "approvals", "pending.json"),
  });
  await approvalCenter.init?.();
  const toolApprovalMode = new InMemoryToolApprovalModeController("default");
  const piModel = createPiModel(config.llm);
  const piTools = createAllPiTools({
    cwd: projectRoot,
    eventsDir: config.ombot.events.dir,
    defaultTimezone: config.ombot.events.defaultTimezone,
    secureExecution: {
      approvalCenter,
      approvalTimeoutSec: config.ombot.gateway.approvalTimeoutSec,
      getApprovalMode: () => toolApprovalMode.getMode(),
    },
  });
  const agentRuntime = new PiAgentRuntimeAdapter({
    model: piModel,
    tools: piTools,
    apiKey: config.llm.apiKey,
    temperature: config.llm.temperature,
  });
  const promptContext = await buildPromptContext(config.ombot, config.monitors);
  const sessionStore = new FileSessionStore({
    indexFilePath: path.join(config.ombot.paths.dataDir, "sessions", "index.json"),
    hostId: config.ombot.app.hostId,
  });
  const transcriptStore = new FileTranscriptStore({
    transcriptsDir: config.ombot.paths.transcriptsDir,
  });

  // 审计存储（SQLite）
  const auditStore = new SqliteAuditStore(config.ombot.paths.auditDbPath);
  await auditStore.init();

  const gateway = new GatewayCore({
    eventBus,
    approvalCenter,
    agentRuntime,
    promptContext,
    sessionStore,
    transcriptStore,
    auditStore,
    eventsDir: config.ombot.events.dir,
    toolApprovalMode,
  });

  const monitorEngine = new MonitorEngine({
    gateway,
    rules: config.monitors.monitors,
  });

  const eventsWatcher = config.ombot.events.enabled
    ? new EventsWatcher({
        eventsDir: config.ombot.events.dir,
        gateway,
        defaultTimezone: config.ombot.events.defaultTimezone,
        startupScan: config.ombot.events.startupScan,
      })
    : null;

  return {
    config,
    hostProfileManager,
    piModel,
    agentRuntime,
    promptContext,
    eventBus,
    gateway,
    monitorEngine,
    eventsWatcher,
    auditStore,
  };
}
