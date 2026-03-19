import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Sandbox } from "e2b";
import type {
  DesktopSession,
  ListedSandbox,
  SandboxDetail,
  Workspace,
} from "$lib/devbox/types";
import type { PlatformEnv, WorkspaceLaunchEnv } from "$lib/server/env";

const defaultDesktopPort = 6901;
const defaultDesktopWebPort = 6902;
const defaultDomain = "e2b.app";
const defaultTerminalPort = 7681;
const desktopUsername = "devbox";

function getDomain(env: PlatformEnv) {
  return env.E2B_DOMAIN || defaultDomain;
}

function getApiBaseUrl(env: PlatformEnv) {
  return `https://api.${getDomain(env)}`;
}

function getTimeoutSeconds(timeoutMs: number) {
  return Math.max(15, Math.ceil(timeoutMs / 1000));
}

function getDefaultTimeoutMs(env: PlatformEnv) {
  return Number(env.E2B_SANDBOX_TIMEOUT_MS ?? 3600000);
}

function getDesktopPort(env: PlatformEnv) {
  return Number(env.E2B_DESKTOP_PORT ?? defaultDesktopPort);
}

function getDesktopWebPort(env: PlatformEnv) {
  return Number(env.E2B_DESKTOP_WEB_PORT ?? defaultDesktopWebPort);
}

function getTerminalPort(env: PlatformEnv) {
  return Number(env.E2B_TERMINAL_PORT ?? defaultTerminalPort);
}

async function e2bFetch<T>(env: PlatformEnv, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl(env)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.E2B_API_KEY,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`E2B ${response.status}: ${message || response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function listSandboxesPage(env: PlatformEnv, nextToken?: string) {
  const params = new URLSearchParams();
  params.append("state", "running");
  params.append("state", "paused");
  params.set("limit", "100");

  if (nextToken) {
    params.set("nextToken", nextToken);
  }

  const response = await fetch(`${getApiBaseUrl(env)}/v2/sandboxes?${params.toString()}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": env.E2B_API_KEY,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`E2B ${response.status}: ${message || response.statusText}`);
  }

  return {
    sandboxes: (await response.json()) as ListedSandbox[],
    nextToken: response.headers.get("x-next-token") ?? undefined,
  };
}

export async function listSandboxes(env: PlatformEnv) {
  const sandboxes: ListedSandbox[] = [];
  let nextToken: string | undefined;

  do {
    const page = await listSandboxesPage(env, nextToken);
    sandboxes.push(...page.sandboxes);
    nextToken = page.nextToken;
  } while (nextToken);

  return sandboxes.sort(
    (left, right) =>
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime(),
  );
}

export async function getSandboxDetail(env: PlatformEnv, sandboxId: string) {
  return e2bFetch<SandboxDetail>(env, `/sandboxes/${sandboxId}`, {
    method: "GET",
  });
}

function getSandboxHost(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  port: number,
) {
  const domain = sandbox.domain || getDomain(env);
  return `${port}-${sandbox.sandboxID}.${domain}`;
}

function getSandboxPortHttpUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  port: number,
  path: string,
) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `https://${getSandboxHost(env, sandbox, port)}${normalizedPath}`;
}

function getWorkspaceDir(workspace: Pick<Workspace, "repo">) {
  return `/home/user/workspace/${workspace.repo}`;
}

function shellEscape(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function getDesktopPassword(env: PlatformEnv, sandboxId: string) {
  return createHash("sha256")
    .update(`${env.E2B_API_KEY}:${sandboxId}:desktop`)
    .digest("hex")
    .slice(0, 32);
}

async function provisionWorkspaceSandbox(
  env: WorkspaceLaunchEnv,
  sandboxId: string,
  workspace: Workspace,
) {
  const cwd = getWorkspaceDir(workspace);
  const repoUrl = `https://github.com/${workspace.owner}/${workspace.repo}.git`;
  const terminalConfig = JSON.stringify({
    cwd,
    command: "bash -l",
  });
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: env.E2B_API_KEY,
    domain: env.E2B_DOMAIN,
    timeoutMs: getDefaultTimeoutMs(env),
  });
  const bootstrapSteps = [
    "mkdir -p /home/user/.cache/devbox /home/user/workspace",
    `printf '%s' ${shellEscape(terminalConfig)} > /home/user/.cache/devbox/terminal-session.json`,
    "mkdir -p /home/user/.config/gh",
    `if [ ! -f /home/user/.config/gh/hosts.yml ]; then printf '%s' \"$GITHUB_TOKEN\" | env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --with-token --hostname github.com --git-protocol https --insecure-storage; fi`,
    "git config --global --unset-all credential.helper >/dev/null 2>&1 || true",
    "git config --global --unset-all credential.https://github.com.helper >/dev/null 2>&1 || true",
    "env -u GH_TOKEN -u GITHUB_TOKEN gh auth setup-git >/dev/null 2>&1 || true",
    `if [ ! -d ${shellEscape(`${cwd}/.git`)} ]; then git clone ${shellEscape(repoUrl)} ${shellEscape(cwd)}; fi`,
    `git -C ${shellEscape(cwd)} remote set-url origin ${shellEscape(repoUrl)}`,
  ];

  if (workspace.defaultBranch) {
    bootstrapSteps.push(
      `git -C ${shellEscape(cwd)} checkout ${shellEscape(workspace.defaultBranch)} || true`,
    );
  }

  await sandbox.commands.run(bootstrapSteps.join(" && "), {
    user: "user",
    envs: {
      GH_TOKEN: env.GITHUB_TOKEN,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
    },
    timeoutMs: 120000,
  });
}

export async function createSandbox(env: WorkspaceLaunchEnv, workspace: Workspace) {
  const timeoutMs = getDefaultTimeoutMs(env);

  if (!env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const sandbox = await e2bFetch<{
    alias?: string;
    domain?: string | null;
    sandboxID: string;
    templateID: string;
  }>(env, "/sandboxes", {
    method: "POST",
    body: JSON.stringify({
      templateID: env.E2B_TEMPLATE,
      timeout: getTimeoutSeconds(timeoutMs),
      autoPause: true,
      metadata: {
        kind: "devbox",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        repoOwner: workspace.owner,
        repoName: workspace.repo,
        repoFullName: `${workspace.owner}/${workspace.repo}`,
      },
      envVars: {
        E2B_DESKTOP_PORT: String(getDesktopPort(env)),
        E2B_DESKTOP_WEB_PORT: String(getDesktopWebPort(env)),
        E2B_TERMINAL_PORT: String(getTerminalPort(env)),
      },
    }),
  });

  try {
    await provisionWorkspaceSandbox(env, sandbox.sandboxID, workspace);
  } catch (error) {
    await killSandbox(env, sandbox.sandboxID).catch(() => undefined);
    throw error;
  }

  return sandbox;
}

export async function resumeSandbox(
  env: PlatformEnv,
  sandboxId: string,
  timeoutMs?: number,
) {
  return e2bFetch<{
    alias?: string;
    domain?: string | null;
    sandboxID: string;
    templateID: string;
  }>(env, `/sandboxes/${sandboxId}/connect`, {
    method: "POST",
    body: JSON.stringify({
      timeout: getTimeoutSeconds(timeoutMs ?? getDefaultTimeoutMs(env)),
    }),
  });
}

export async function pauseSandbox(env: PlatformEnv, sandboxId: string) {
  await e2bFetch<void>(env, `/sandboxes/${sandboxId}/pause`, {
    method: "POST",
  });
}

export async function killSandbox(env: PlatformEnv, sandboxId: string) {
  await e2bFetch<void>(env, `/sandboxes/${sandboxId}`, {
    method: "DELETE",
  });
}

export function getSandboxTerminalUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
) {
  return `wss://${getSandboxHost(env, sandbox, getTerminalPort(env))}`;
}

export function getSandboxDesktopUpstreamUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  path = "/",
) {
  const desktopUrl = new URL(
    getSandboxPortHttpUrl(env, sandbox, getDesktopWebPort(env), path),
  );

  // Fit the desktop inside the app iframe and hide Kasm's left control handle.
  desktopUrl.searchParams.set("autoconnect", "1");
  desktopUrl.searchParams.set("resize", "scale");
  desktopUrl.searchParams.set("show_control_bar", "0");

  return desktopUrl.toString();
}

export function getSandboxDesktopProxyUrl(sandboxId: string, path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/api/desktop/${sandboxId}/proxy${normalizedPath}`;
}

export function getSandboxDesktopAuthHeader(env: PlatformEnv, sandboxId: string) {
  const credentials = `${desktopUsername}:${getDesktopPassword(env, sandboxId)}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

async function ensureSandboxDesktop(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
) {
  const connection = await Sandbox.connect(sandbox.sandboxID, {
    apiKey: env.E2B_API_KEY,
    domain: env.E2B_DOMAIN,
    timeoutMs: getDefaultTimeoutMs(env),
  });

  await connection.commands.run("/usr/local/bin/start-desktop.sh", {
    user: "root",
    envs: {
      E2B_DESKTOP_PASSWORD: getDesktopPassword(env, sandbox.sandboxID),
      E2B_DESKTOP_PORT: String(getDesktopPort(env)),
      E2B_DESKTOP_WEB_PORT: String(getDesktopWebPort(env)),
      E2B_DESKTOP_USER: desktopUsername,
    },
    timeoutMs: 90000,
  });
}

export async function getSandboxDesktopSession(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID" | "state">,
): Promise<DesktopSession> {
  if (sandbox.state !== "running") {
    throw new Error("Sandbox is not running");
  }

  await ensureSandboxDesktop(env, sandbox);

  return {
    sandboxId: sandbox.sandboxID,
    status: "open",
    url: getSandboxDesktopUpstreamUrl(env, sandbox, "/"),
  };
}
