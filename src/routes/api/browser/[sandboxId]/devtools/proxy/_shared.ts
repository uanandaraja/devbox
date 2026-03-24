import {
  getSandboxBrowserDevtoolsUpstreamUrl,
  getSandboxDetail,
} from "$lib/server/e2b/client";

export async function proxyBrowserDevtoolsRequest(
  request: Request,
  platform: App.Platform,
  sandboxId: string,
  path: string,
) {
  const sandbox = await getSandboxDetail(platform.env, sandboxId);

  if (sandbox.state !== "running") {
    return new Response("Sandbox is not running", { status: 409 });
  }

  const requestUrl = new URL(request.url);
  const targetUrl = new URL(
    getSandboxBrowserDevtoolsUpstreamUrl(platform.env, sandbox, path),
  );
  targetUrl.search = requestUrl.search;

  const headers = new Headers(request.headers);
  headers.set("host", targetUrl.host);

  if (headers.has("origin")) {
    headers.set("origin", targetUrl.origin);
  }

  if (headers.has("referer")) {
    headers.set("referer", `${targetUrl.origin}/`);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstreamResponse = await fetch(new Request(targetUrl.toString(), init));

  if (upstreamResponse.status === 101) {
    return upstreamResponse;
  }

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("x-frame-options");
  responseHeaders.delete("content-security-policy");

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
