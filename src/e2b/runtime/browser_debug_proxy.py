#!/usr/bin/env python3
import argparse
import asyncio
from typing import Iterable

from aiohttp import ClientSession, WSMsgType, web


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def filtered_headers(headers: Iterable[tuple[str, str]], host: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in headers:
        lower = key.lower()
        if lower in HOP_BY_HOP_HEADERS or lower == "host":
            continue
        result[key] = value
    result["Host"] = host
    return result


async def proxy_http(request: web.Request, upstream_base: str) -> web.StreamResponse:
    upstream_url = f"{upstream_base}{request.rel_url}"
    body = await request.read()
    timeout = request.app["timeout"]
    async with ClientSession(timeout=timeout) as session:
        async with session.request(
            request.method,
            upstream_url,
            data=body if body else None,
            headers=filtered_headers(request.headers.items(), "127.0.0.1"),
            allow_redirects=False,
        ) as response:
            payload = await response.read()
            headers = {
                key: value
                for key, value in response.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
            }
            return web.Response(
                body=payload,
                status=response.status,
                headers=headers,
            )


async def proxy_websocket(request: web.Request, upstream_base: str) -> web.StreamResponse:
    upstream_url = f"{upstream_base}{request.rel_url}"
    protocols = request.headers.getall("Sec-WebSocket-Protocol", [])
    client_ws = web.WebSocketResponse(protocols=protocols)
    await client_ws.prepare(request)

    timeout = request.app["timeout"]
    async with ClientSession(timeout=timeout) as session:
        async with session.ws_connect(
            upstream_url,
            protocols=protocols,
            headers=filtered_headers(request.headers.items(), "127.0.0.1"),
            autoclose=True,
            autoping=True,
        ) as upstream_ws:
            async def client_to_upstream():
                async for message in client_ws:
                    if message.type == WSMsgType.TEXT:
                        await upstream_ws.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await upstream_ws.send_bytes(message.data)
                    elif message.type == WSMsgType.CLOSE:
                        await upstream_ws.close()
                        break

            async def upstream_to_client():
                async for message in upstream_ws:
                    if message.type == WSMsgType.TEXT:
                        await client_ws.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await client_ws.send_bytes(message.data)
                    elif message.type == WSMsgType.CLOSE:
                        await client_ws.close()
                        break

            await asyncio.gather(client_to_upstream(), upstream_to_client())

    return client_ws


async def handle_request(request: web.Request) -> web.StreamResponse:
    upstream_base = request.app["upstream_base"]
    upgrade = request.headers.get("Upgrade", "")
    if upgrade.lower() == "websocket":
        return await proxy_websocket(request, upstream_base)
    return await proxy_http(request, upstream_base)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--upstream-port", type=int, required=True)
    args = parser.parse_args()

    app = web.Application()
    app["timeout"] = aiohttp.ClientTimeout(total=60)  # type: ignore[name-defined]
    app["upstream_base"] = f"http://127.0.0.1:{args.upstream_port}"
    app.router.add_route("*", "/{path_info:.*}", handle_request)
    web.run_app(app, host="0.0.0.0", port=args.listen_port, access_log=None)


if __name__ == "__main__":
    import aiohttp

    main()
