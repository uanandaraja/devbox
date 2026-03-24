import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { proxyBrowserDevtoolsRequest } from "../_shared";

const handler: RequestHandler = async ({ params, platform, request }) => {
  if (!platform) {
    throw error(500, "Cloudflare platform unavailable");
  }

  return proxyBrowserDevtoolsRequest(
    request,
    platform,
    params.sandboxId,
    `/${params.path}`,
  );
};

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
