import { startCliRepl } from "./cli/repl";
import { bootstrap } from "./bootstrap";

async function main() {
  const projectRoot = process.cwd();
  const app = await bootstrap(projectRoot);

  // 启动监控引擎（定时检查在后台运行）
  // 注意：先启动 monitor，再启动 TUI REPL，这样 TUI 能接收首批 monitor 消息
  await app.monitorEngine.start();
  app.eventsWatcher?.start();

  await startCliRepl({
    gateway: app.gateway,
    eventsDir: app.config.ombot.events.dir,
    eventsEnabled: app.config.ombot.events.enabled,
    subscribeGatewayEvents: (callback) => app.eventBus.subscribe(callback),
    onMonitorMessage: (callback) => {
      // 将 monitor 的消息回调注册到 TUI，所有 monitor 输出都通过此回调进入 TUI 渲染
      app.monitorEngine.onMessage = callback;
    },
  });

  // CLI 退出后停止监控引擎并关闭审计存储
  app.eventsWatcher?.stop();
  await app.monitorEngine.stop();
  app.auditStore.close();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OMBot 启动失败: ${message}`);
  process.exitCode = 1;
});
