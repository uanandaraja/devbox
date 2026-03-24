#!/usr/bin/env python3
import argparse
import asyncio
from typing import Iterable

from aiohttp import ClientSession, ClientTimeout, WSMsgType, web


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


def filtered_headers(
    headers: Iterable[tuple[str, str]],
    upstream_host: str,
    upstream_origin: str,
) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in headers:
        lower = key.lower()
        if lower in HOP_BY_HOP_HEADERS or lower == "host":
            continue
        if lower == "origin":
            result[key] = upstream_origin
            continue
        if lower == "referer":
            result[key] = f"{upstream_origin}/"
            continue
        result[key] = value
    result["Host"] = upstream_host
    return result


async def proxy_http(request: web.Request, upstream_base: str) -> web.StreamResponse:
    upstream_url = f"{upstream_base}{request.rel_url}"
    body = await request.read()
    headers = filtered_headers(
        request.headers.items(),
        request.app["upstream_host"],
        request.app["upstream_origin"],
    )
    timeout = request.app["timeout"]
    async with ClientSession(timeout=timeout) as session:
        async with session.request(
            request.method,
            upstream_url,
            data=body if body else None,
            headers=headers,
            allow_redirects=False,
        ) as response:
            payload = await response.read()
            response_headers = {
                key: value
                for key, value in response.headers.items()
                if key.lower() not in HOP_BY_HOP_HEADERS
                and key.lower() != "content-security-policy"
                and key.lower() != "x-frame-options"
            }
            return web.Response(
                body=payload,
                status=response.status,
                headers=response_headers,
            )


async def proxy_websocket(request: web.Request, upstream_base: str) -> web.StreamResponse:
    protocols = request.headers.getall("Sec-WebSocket-Protocol", [])
    client_ws = web.WebSocketResponse(protocols=protocols)
    await client_ws.prepare(request)

    headers = filtered_headers(
        request.headers.items(),
        request.app["upstream_host"],
        request.app["upstream_origin"],
    )
    timeout = request.app["timeout"]
    upstream_url = f"{upstream_base}{request.rel_url}"

    async with ClientSession(timeout=timeout) as session:
        async with session.ws_connect(
            upstream_url,
            protocols=protocols,
            headers=headers,
            autoclose=True,
            autoping=True,
        ) as upstream_ws:
            async def client_to_upstream() -> None:
                async for message in client_ws:
                    if message.type == WSMsgType.TEXT:
                        await upstream_ws.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await upstream_ws.send_bytes(message.data)
                    elif message.type in {WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED}:
                        await upstream_ws.close()
                        break

            async def upstream_to_client() -> None:
                async for message in upstream_ws:
                    if message.type == WSMsgType.TEXT:
                        await client_ws.send_str(message.data)
                    elif message.type == WSMsgType.BINARY:
                        await client_ws.send_bytes(message.data)
                    elif message.type in {WSMsgType.CLOSE, WSMsgType.CLOSING, WSMsgType.CLOSED}:
                        await client_ws.close()
                        break

            await asyncio.gather(client_to_upstream(), upstream_to_client())

    return client_ws


async def handle_request(request: web.Request) -> web.StreamResponse:
    upstream_base = request.app["upstream_base"]
    if request.headers.get("Upgrade", "").lower() == "websocket":
      return await proxy_websocket(request, upstream_base)
    return await proxy_http(request, upstream_base)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-port", type=int, required=True)
    parser.add_argument("--target-port", type=int, required=True)
    args = parser.parse_args()

    upstream_origin = f"http://localhost:{args.target_port}"
    app = web.Application()
    app["timeout"] = ClientTimeout(total=120)
    app["upstream_base"] = upstream_origin
    app["upstream_origin"] = upstream_origin
    app["upstream_host"] = f"localhost:{args.target_port}"
    app.router.add_route("*", "/{path_info:.*}", handle_request)
    web.run_app(app, host="0.0.0.0", port=args.listen_port, access_log=None)


if __name__ == "__main__":
    main()
