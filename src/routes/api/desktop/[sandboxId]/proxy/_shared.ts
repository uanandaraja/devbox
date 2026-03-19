import {
  getSandboxDetail,
  getSandboxDesktopAuthHeader,
  getSandboxDesktopUpstreamUrl,
} from "$lib/server/e2b/client";

function rewriteLocation(
  location: string,
  requestUrl: URL,
  sandboxId: string,
  upstreamOrigin: string,
) {
  const resolved = new URL(location, upstreamOrigin);

  if (resolved.origin !== upstreamOrigin) {
    return location;
  }

  const rewritten = new URL(
    `/api/desktop/${sandboxId}/proxy${resolved.pathname}`,
    requestUrl.origin,
  );
  rewritten.search = resolved.search;
  return rewritten.toString();
}

export async function proxyDesktopRequest(
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
  const targetUrl = new URL(getSandboxDesktopUpstreamUrl(platform.env, sandbox, path));
  targetUrl.search = requestUrl.search;

  const headers = new Headers(request.headers);
  headers.set("authorization", getSandboxDesktopAuthHeader(platform.env, sandboxId));
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
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("www-authenticate");

  const location = responseHeaders.get("location");
  if (location) {
    responseHeaders.set(
      "location",
      rewriteLocation(location, requestUrl, sandboxId, targetUrl.origin),
    );
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}
