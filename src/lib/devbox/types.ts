export type SandboxState = "running" | "paused";

export type Workspace = {
  id: string;
  name: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInput = {
  name: string;
  repoUrl: string;
  defaultBranch?: string | null;
  notes?: string | null;
};

export type ListedSandbox = {
  alias?: string;
  cpuCount: number;
  diskSizeMB: number;
  endAt: string;
  envdVersion: string;
  memoryMB: number;
  metadata?: Record<string, string>;
  sandboxID: string;
  startedAt: string;
  state: SandboxState;
  templateID: string;
};

export type SandboxDetail = {
  alias?: string;
  cpuCount: number;
  diskSizeMB: number;
  domain?: string | null;
  endAt: string;
  envdVersion: string;
  memoryMB: number;
  metadata?: Record<string, string>;
  sandboxID: string;
  startedAt: string;
  state: SandboxState;
  templateID: string;
};

export type DesktopSession = {
  sandboxId: string;
  status: "idle" | "starting" | "open" | "error";
  url?: string;
};

export type DashboardData = {
  workspaces: Workspace[];
  sandboxes: ListedSandbox[];
};
