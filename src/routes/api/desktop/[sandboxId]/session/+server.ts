import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getSandboxDetail, getSandboxDesktopSession } from "$lib/server/e2b/client";

export const GET: RequestHandler = async ({ params, platform }) => {
  if (!platform) {
    throw error(500, "Cloudflare platform unavailable");
  }

  const sandbox = await getSandboxDetail(platform.env, params.sandboxId);
  const session = await getSandboxDesktopSession(platform.env, sandbox);

  return json(session);
};
