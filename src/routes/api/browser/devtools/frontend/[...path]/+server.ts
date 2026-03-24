import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const upstreamOrigin = "https://chrome-devtools-frontend.appspot.com";

const handler: RequestHandler = async ({ params, request }) => {
  const requestUrl = new URL(request.url);
  const upstreamPath = Array.isArray(params.path) ? params.path.join("/") : params.path;

  if (!upstreamPath) {
    throw error(404, "DevTools asset not found");
  }

  const upstreamUrl = new URL(`${upstreamOrigin}/${upstreamPath}`);
  upstreamUrl.search = requestUrl.search;

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      "user-agent": request.headers.get("user-agent") ?? "werkbench-devtools-proxy",
    },
    redirect: "follow",
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("x-frame-options");
  responseHeaders.delete("content-security-policy");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
};

export const GET = handler;
export const HEAD = handler;
