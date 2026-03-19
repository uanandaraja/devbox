#!/usr/bin/env python3
import argparse
import asyncio
from contextlib import suppress
from urllib.parse import urljoin

from aiohttp import ClientSession, WSMsgType, web

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def is_websocket(request: web.Request) -> bool:
    connection = request.headers.get("Connection", "").lower()
    upgrade = request.headers.get("Upgrade", "").lower()
    return "upgrade" in connection and upgrade == "websocket"


def rewrite_location(location: str, request: web.Request, upstream: str) -> str:
    resolved = urljoin(upstream, location)
    if not resolved.startswith(upstream):
        return location
    suffix = resolved[len(upstream) :]
    if not suffix.startswith("/"):
        suffix = f"/{suffix}"
    return f"{request.scheme}://{request.host}{suffix}"


def get_ws_protocols(request: web.Request) -> list[str]:
    header = request.headers.get("Sec-WebSocket-Protocol", "")
    return [part.strip() for part in header.split(",") if part.strip()]


async def relay_websocket(request: web.Request) -> web.StreamResponse:
    session: ClientSession = request.app["session"]
    upstream: str = request.app["upstream"]
    auth_header: str = request.app["auth_header"]
    upstream_url = f"{upstream}{request.rel_url}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }
    headers["Authorization"] = auth_header
    headers["Host"] = upstream.removeprefix("http://").removeprefix("https://")
    if "Origin" in request.headers:
        headers["Origin"] = upstream
    protocols = get_ws_protocols(request)

    downstream = web.WebSocketResponse(protocols=protocols)
    await downstream.prepare(request)

    async with session.ws_connect(
        upstream_url,
        headers=headers,
        protocols=protocols,
    ) as upstream_ws:
        async def to_upstream():
            async for message in downstream:
                if message.type is WSMsgType.TEXT:
                    await upstream_ws.send_str(message.data)
                elif message.type is WSMsgType.BINARY:
                    await upstream_ws.send_bytes(message.data)
                elif message.type is WSMsgType.CLOSE:
                    await upstream_ws.close()

        async def to_downstream():
            async for message in upstream_ws:
                if message.type is WSMsgType.TEXT:
                    await downstream.send_str(message.data)
                elif message.type is WSMsgType.BINARY:
                    await downstream.send_bytes(message.data)
                elif message.type is WSMsgType.CLOSE:
                    await downstream.close()

        tasks = [asyncio.create_task(to_upstream()), asyncio.create_task(to_downstream())]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        for task in done:
            with suppress(Exception):
                await task

    return downstream


async def relay_http(request: web.Request) -> web.StreamResponse:
    session: ClientSession = request.app["session"]
    upstream: str = request.app["upstream"]
    auth_header: str = request.app["auth_header"]
    upstream_url = f"{upstream}{request.rel_url}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }
    headers["Authorization"] = auth_header
    headers["Host"] = upstream.removeprefix("http://").removeprefix("https://")
    if "Origin" in request.headers:
        headers["Origin"] = upstream
    if "Referer" in request.headers:
        headers["Referer"] = f"{upstream}/"

    body = None if request.method in {"GET", "HEAD"} else await request.read()
    async with session.request(
        request.method,
        upstream_url,
        headers=headers,
        data=body,
        allow_redirects=False,
    ) as upstream_response:
        response_headers = {
            key: value
            for key, value in upstream_response.headers.items()
            if key.lower() not in HOP_BY_HOP_HEADERS and key.lower() != "content-length"
        }
        location = upstream_response.headers.get("Location")
        if location:
            response_headers["Location"] = rewrite_location(location, request, upstream)
        payload = await upstream_response.read()
        return web.Response(
            body=payload,
            status=upstream_response.status,
            headers=response_headers,
        )


async def handle(request: web.Request) -> web.StreamResponse:
    if is_websocket(request):
        return await relay_websocket(request)
    return await relay_http(request)


async def on_startup(app: web.Application) -> None:
    app["session"] = ClientSession()


async def on_cleanup(app: web.Application) -> None:
    await app["session"].close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen", default="0.0.0.0")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--auth-header", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app = web.Application()
    app["upstream"] = args.upstream.rstrip("/")
    app["auth_header"] = args.auth_header
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    app.router.add_route("*", "/{path_info:.*}", handle)
    web.run_app(app, host=args.listen, port=args.port, handle_signals=True)


if __name__ == "__main__":
    main()
