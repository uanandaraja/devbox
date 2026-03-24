import { getRequestEvent } from "$app/server";

export type PlatformEnv = App.Platform["env"] & {
  DB: D1Database;
  E2B_API_KEY: string;
  E2B_BROWSER_DEBUG_PORT?: string;
  E2B_BROWSER_PROXY_PORT?: string;
  E2B_DOMAIN?: string;
  E2B_PREVIEW_PORTS?: string;
  E2B_SANDBOX_TIMEOUT_MS?: string;
  E2B_TEMPLATE: string;
  E2B_TERMINAL_PORT?: string;
};

export type WorkspaceLaunchEnv = PlatformEnv & {
  GITHUB_TOKEN: string;
};

export function getPlatformEnv(): PlatformEnv {
  const event = getRequestEvent();

  if (!event.platform) {
    throw new Error("Cloudflare platform bindings are unavailable");
  }

  return event.platform.env as PlatformEnv;
}
