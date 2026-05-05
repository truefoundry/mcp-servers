"""Unified MCP test server supporting all three transport variants.

Usage:
    python server.py streamable-http       # JSON responses (Variant 1)
    python server.py streamable-http-sse   # SSE streaming responses (Variant 2)
    python server.py sse                   # Legacy SSE (Variant 3)
"""

import argparse
import logging
import os

import uvicorn
from fastmcp import FastMCP
from fastmcp.server.http import create_streamable_http_app
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-test-server")

mcp = FastMCP("test-echo-server")


class LogHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        logger.info("--- Incoming %s %s ---", request.method, request.url.path)
        for name, value in request.headers.items():
            logger.info("  %s: %s", name, value)
        return await call_next(request)


@mcp.tool()
def echo(message: str) -> str:
    """Echoes back the input"""
    return f"echoed: {message}"


def create_json_app():
    app = create_streamable_http_app(mcp, streamable_http_path="/mcp", json_response=True)
    app.add_middleware(LogHeadersMiddleware)
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("transport", choices=["streamable-http", "streamable-http-sse", "sse"])
    args = parser.parse_args()

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))

    if args.transport == "streamable-http":
        uvicorn.run(
            "server:create_json_app",
            factory=True,
            host=host,
            port=port,
        )
    elif args.transport == "streamable-http-sse":
        mcp.run(transport="streamable-http", host=host, port=port)
    elif args.transport == "sse":
        mcp.run(transport="sse", host=host, port=port)
