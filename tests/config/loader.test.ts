import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileSystemConfigLoader } from "../../src/config/loader";
import { ConfigError } from "../../src/shared/errors";

const tempDirs: string[] = [];

async function createTempProject(files: Record<string, string>) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ombot-config-"));
  tempDirs.push(tempRoot);

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(tempRoot, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }

  return tempRoot;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  delete process.env.LLM_MODEL_NAME;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_TEMPERATURE;
  delete process.env.LLM_TIMEOUT_MS;
});

describe("FileSystemConfigLoader", () => {
  it("loads project config and normalizes paths", async () => {
    process.env.LLM_MODEL_NAME = "gpt-4o-mini";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_TEMPERATURE = "0.2";
    process.env.LLM_TIMEOUT_MS = "90000";

    const loader = new FileSystemConfigLoader();
    const loaded = await loader.load(path.resolve(process.cwd(), "config"));

    expect(loaded.ombot.app.name).toBe("OMBot");
    expect(loaded.llm.apiKey).toBe("test-key");
    expect(loaded.llm.modelName).toBe("gpt-4o-mini");
    expect(loaded.llm.timeoutMs).toBe(90000);
    expect(path.isAbsolute(loaded.ombot.paths.dataDir)).toBe(true);
    expect(path.isAbsolute(loaded.ombot.agent.systemPromptTemplate)).toBe(true);
    expect(path.isAbsolute(loaded.ombot.events.dir)).toBe(true);
    expect(loaded.ombot.events.defaultTimezone).toBe("Asia/Shanghai");
    expect(loaded.monitors.monitors.length).toBeGreaterThanOrEqual(2);
    expect(loaded.toolPolicy.profiles.readonly.defaultAction).toBe("deny");
  });

  it("throws when required env var is missing", async () => {
    delete process.env.LLM_MODEL_NAME;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_TEMPERATURE;
    delete process.env.LLM_TIMEOUT_MS;

    const projectRoot = await createTempProject({
      "config/ombot.yaml": `
app:
  name: OMBot
  env: development
  host_id: test-host
agent:
  max_context_messages: 10
  auto_summary_threshold: 5
  system_prompt_template: "config/prompts/system.txt"
  workspace_files:
    - "workspace/RUNBOOK.md"
gateway:
  mode: embedded
  local_cli_enabled: true
  approval_timeout_sec: 60
logging:
  level: info
  pretty: true
events:
  enabled: true
  dir: "./workspace/events"
  default_timezone: "Asia/Shanghai"
  max_queued_per_session: 3
  startup_scan: true
paths:
  data_dir: "./data"
  workspace_dir: "./workspace"
  transcripts_dir: "./data/sessions"
  audit_db_path: "./data/audit/audit.db"
`,
      "config/monitors.yaml": `
monitors:
  - id: test-monitor
    name: Test
    enabled: true
    type: process
    interval: 60s
    target:
      process_name: nginx
`,
      "config/tool_policy.yaml": `
profiles:
  readonly:
    default_action: deny
`,
      "config/prompts/system.txt": "system prompt",
      "workspace/RUNBOOK.md": "# runbook",
    });

    const loader = new FileSystemConfigLoader();

    await expect(loader.load(path.join(projectRoot, "config"))).rejects.toThrow(ConfigError);
    await expect(loader.load(path.join(projectRoot, "config"))).rejects.toThrow("LLM 环境配置校验失败");
  });

  it("throws when config validation fails", async () => {
    process.env.LLM_MODEL_NAME = "gpt-4o";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.openai.com/v1";
    process.env.LLM_PROVIDER = "openai";
    delete process.env.LLM_TEMPERATURE;
    delete process.env.LLM_TIMEOUT_MS;

    const projectRoot = await createTempProject({
      "config/ombot.yaml": `
app:
  name: OMBot
  env: development
  host_id: test-host
agent:
  max_context_messages: 10
  auto_summary_threshold: 20
  system_prompt_template: "config/prompts/system.txt"
  workspace_files:
    - "workspace/RUNBOOK.md"
gateway:
  mode: embedded
  local_cli_enabled: true
  approval_timeout_sec: 60
logging:
  level: info
  pretty: true
events:
  enabled: true
  dir: "./workspace/events"
  default_timezone: "Asia/Shanghai"
  max_queued_per_session: 3
  startup_scan: true
paths:
  data_dir: "./data"
  workspace_dir: "./workspace"
  transcripts_dir: "./data/sessions"
  audit_db_path: "./data/audit/audit.db"
`,
      "config/monitors.yaml": `
monitors:
  - id: test-monitor
    name: Test
    enabled: true
    type: process
    interval: 60s
    target:
      process_name: nginx
`,
      "config/tool_policy.yaml": `
profiles:
  readonly:
    default_action: deny
`,
      "config/prompts/system.txt": "system prompt",
      "workspace/RUNBOOK.md": "# runbook",
    });

    const loader = new FileSystemConfigLoader();

    await expect(loader.load(path.join(projectRoot, "config"))).rejects.toThrow(
      "agent.autoSummaryThreshold 必须小于等于 agent.maxContextMessages",
    );
  });
});
