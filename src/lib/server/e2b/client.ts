import { Sandbox } from "e2b";
import type {
  BrowserSession,
  ListedSandbox,
  PreviewCandidate,
  SandboxDetail,
  Workspace,
} from "$lib/werkbench/types";
import type { PlatformEnv, WorkspaceLaunchEnv } from "$lib/server/env";

const defaultBrowserDebugPort = 9222;
const defaultBrowserProxyPort = 8090;
const defaultDomain = "e2b.app";
const defaultPreviewPorts = [3000, 3001, 4173, 5173, 8000, 8080, 8787, 4321];
const defaultTerminalPort = 7681;

type ChromeDebugTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
};

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

function getBrowserDebugPort(env: PlatformEnv) {
  return Number(env.E2B_BROWSER_DEBUG_PORT ?? defaultBrowserDebugPort);
}

function getBrowserProxyPort(env: PlatformEnv) {
  return Number(env.E2B_BROWSER_PROXY_PORT ?? defaultBrowserProxyPort);
}

function getPreviewPorts(env: PlatformEnv) {
  const raw = env.E2B_PREVIEW_PORTS?.trim();
  if (!raw) {
    return defaultPreviewPorts;
  }

  const ports = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  return ports.length > 0 ? [...new Set(ports)] : defaultPreviewPorts;
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
  params.set("state", "running,paused");
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getPreviewUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  port: number,
) {
  return getSandboxPortHttpUrl(env, sandbox, port, "/");
}

export async function detectSandboxPreviewCandidates(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
) {
  const ports = getPreviewPorts(env);

  try {
    const connection = await Sandbox.connect(sandbox.sandboxID, {
      apiKey: env.E2B_API_KEY,
      domain: env.E2B_DOMAIN,
      timeoutMs: getDefaultTimeoutMs(env),
    });
    const probeScript = ports
      .map(
        (port) =>
          `code="$(curl -sS -o /dev/null --max-time 1 -w '%{http_code}' http://localhost:${port}/ || true)"; if [ "$code" = "000" ]; then echo "${port}:inactive"; else echo "${port}:active"; fi`,
      )
      .join("; ");
    const result = await connection.commands.run(probeScript, {
      user: "root",
      timeoutMs: 15000,
    });
    const activeByPort = new Map<number, boolean>();
    for (const line of result.stdout.split("\n")) {
      const [portRaw, state] = line.trim().split(":");
      const port = Number(portRaw);
      if (Number.isInteger(port)) {
        activeByPort.set(port, state === "active");
      }
    }

    return ports.map((port) => ({
      port,
      url: getPreviewUrl(env, sandbox, port),
      active: activeByPort.get(port) ?? false,
    }));
  } catch {
    return ports.map((port) => ({
      port,
      url: getPreviewUrl(env, sandbox, port),
      active: false,
    }));
  }
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
    command: "fish -l",
  });
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey: env.E2B_API_KEY,
    domain: env.E2B_DOMAIN,
    timeoutMs: getDefaultTimeoutMs(env),
  });
  const bootstrapSteps = [
    "mkdir -p /home/user/.cache/werkbench /home/user/workspace",
    `printf '%s' ${shellEscape(terminalConfig)} > /home/user/.cache/werkbench/terminal-session.json`,
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
        kind: "werkbench",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        repoOwner: workspace.owner,
        repoName: workspace.repo,
        repoFullName: `${workspace.owner}/${workspace.repo}`,
      },
      envVars: {
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

function getSandboxChromeDebugUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  path = "/json/version",
) {
  return getSandboxPortHttpUrl(env, sandbox, getBrowserDebugPort(env), path);
}

async function fetchChromeDebugJson<T>(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  path: string,
) {
  const response = await fetch(getSandboxChromeDebugUrl(env, sandbox, path), {
    method: "GET",
    headers: {
      Accept: "application/json,text/plain,*/*",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Chrome debug ${response.status}: ${message || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function ensureSandboxBrowser(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  targetUrl: string,
) {
  const connection = await Sandbox.connect(sandbox.sandboxID, {
    apiKey: env.E2B_API_KEY,
    domain: env.E2B_DOMAIN,
    timeoutMs: getDefaultTimeoutMs(env),
  });

  await connection.commands.run("/usr/local/bin/start-browser.sh", {
    user: "root",
    envs: {
      E2B_BROWSER_DEBUG_PORT: String(getBrowserDebugPort(env)),
      E2B_BROWSER_PROXY_PORT: String(getBrowserProxyPort(env)),
      E2B_BROWSER_TARGET_PORT: String(new URL(targetUrl).port || 80),
      E2B_BROWSER_START_URL: targetUrl,
    },
    timeoutMs: 60000,
  });
}

async function getChromeTargets(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
) {
  return fetchChromeDebugJson<ChromeDebugTarget[]>(env, sandbox, "/json/list");
}

async function waitForChromeTarget(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  targetUrl: string,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const targets = await getChromeTargets(env, sandbox).catch(() => [] as ChromeDebugTarget[]);
    const target =
      targets.find((entry) => entry.type === "page" && entry.url === targetUrl) ??
      targets.find((entry) => entry.type === "page");

    if (target && (target.devtoolsFrontendUrl || target.webSocketDebuggerUrl || target.id)) {
      return target;
    }

    await delay(500);
  }

  throw new Error("Chrome debug target did not become ready");
}

function getProxyWebSocketPath(sandboxId: string, targetPath: string) {
  return `/api/browser/${sandboxId}/devtools/proxy${targetPath}`;
}

function rewriteDevtoolsFrontendUrl(sandboxId: string, frontendPath: string) {
  const frontendUrl = new URL(frontendPath, "https://chrome-devtools-frontend.appspot.com");
  const ws = frontendUrl.searchParams.get("ws");

  if (ws) {
    const wsUrl = new URL(`ws://${ws}`);
    frontendUrl.searchParams.set("ws", getProxyWebSocketPath(sandboxId, wsUrl.pathname));
  }

  const query = frontendUrl.searchParams.toString();
  return `/api/browser/devtools/frontend${frontendUrl.pathname}${query ? `?${query}` : ""}`;
}

export function getSandboxPreviewProxyUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
) {
  return getSandboxPortHttpUrl(env, sandbox, getBrowserProxyPort(env), "/");
}

export function getSandboxBrowserDevtoolsUpstreamUrl(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID">,
  path = "/json/version",
) {
  return getSandboxChromeDebugUrl(env, sandbox, path);
}

export async function getSandboxBrowserSession(
  env: PlatformEnv,
  sandbox: Pick<SandboxDetail, "domain" | "sandboxID" | "state">,
  requestedPort?: number,
): Promise<BrowserSession> {
  if (sandbox.state !== "running") {
    throw new Error("Sandbox is not running");
  }

  const candidates = await detectSandboxPreviewCandidates(env, sandbox);
  const defaultCandidate = candidates.find((candidate) => candidate.active);
  const selectedPort = requestedPort ?? defaultCandidate?.port;

  if (!selectedPort) {
    return {
      sandboxId: sandbox.sandboxID,
      status: "empty",
      candidates,
      message: "No preview detected. Start your app on 0.0.0.0 and choose a port.",
    };
  }

  const targetUrl = `http://localhost:${selectedPort}/`;

  await ensureSandboxBrowser(env, sandbox, targetUrl);
  const target = await waitForChromeTarget(env, sandbox, targetUrl);

  return {
    sandboxId: sandbox.sandboxID,
    status: "open",
    selectedPort,
    url: getSandboxPreviewProxyUrl(env, sandbox),
    devtoolsUrl: rewriteDevtoolsFrontendUrl(
      sandbox.sandboxID,
      target.devtoolsFrontendUrl ??
        `/devtools/inspector.html?ws=${getProxyWebSocketPath(sandbox.sandboxID, `/devtools/page/${target.id}`)}`,
    ),
    candidates,
  };
}
