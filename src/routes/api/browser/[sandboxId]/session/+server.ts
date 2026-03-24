import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSandboxBrowserSession, getSandboxDetail } from "$lib/server/e2b/client";

export const GET: RequestHandler = async ({ params, platform, url }) => {
  if (!platform) {
    throw error(500, "Cloudflare platform unavailable");
  }

  const sandbox = await getSandboxDetail(platform.env, params.sandboxId);
  const portParam = Number(url.searchParams.get("port") ?? "");
  const session = await getSandboxBrowserSession(
    platform.env,
    sandbox,
    Number.isInteger(portParam) && portParam > 0 ? portParam : undefined,
  );

  if (session.devtoolsUrl) {
    const devtoolsUrl = new URL(session.devtoolsUrl, url.origin);
    const wsParam = devtoolsUrl.searchParams.get("ws");

    if (wsParam?.startsWith("/")) {
      const websocketTarget = `${url.host}${wsParam}`;
      if (url.protocol === "https:") {
        devtoolsUrl.searchParams.set("wss", websocketTarget);
        devtoolsUrl.searchParams.delete("ws");
      } else {
        devtoolsUrl.searchParams.set("ws", websocketTarget);
        devtoolsUrl.searchParams.delete("wss");
      }
      session.devtoolsUrl = devtoolsUrl.toString();
    }
  }

  return json(session);
};
