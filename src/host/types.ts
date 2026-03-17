export type HostOsFamily = "macos" | "linux" | "unknown";

export interface HostPathInfo {
  path: string;
  exists: boolean;
}

export interface HostCapabilityStatus {
  available: boolean;
  resolvedPath?: string;
}

export interface HostEnvironmentSnapshot {
  collectedAt: string;
  platform: {
    osFamily: HostOsFamily;
    distribution: string;
    version?: string;
    kernel: string;
    architecture: string;
    hostname: string;
  };
  runtime: {
    executionMode: "host" | "docker";
    insideDocker: boolean;
    gui: {
      available: boolean;
      sessionType?: string;
    };
    terminal: {
      termProgram?: string;
      shell?: string;
    };
  };
  user: {
    username: string;
    homeDir: string;
  };
  paths: {
    desktop: HostPathInfo;
    downloads: HostPathInfo;
    documents: HostPathInfo;
    workspace: HostPathInfo;
    data: HostPathInfo;
  };
  capabilities: Record<string, HostCapabilityStatus>;
}

export interface HostProfilePaths {
  jsonPath: string;
  workspaceProfilePath: string;
}
