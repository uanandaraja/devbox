import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { proxyDesktopRequest } from "./_shared";

const handler: RequestHandler = async ({ params, platform, request }) => {
  if (!platform) {
    throw error(500, "Cloudflare platform unavailable");
  }

  return proxyDesktopRequest(request, platform, params.sandboxId, "/");
};

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
