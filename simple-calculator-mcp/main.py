from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import JSONResponse


mcp = FastMCP("Simple Calculator 🚀", stateless_http=True)

@mcp.tool
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b

@mcp.tool
def subtract(a: int, b: int) -> int:
    """Subtract two numbers"""
    return a - b

@mcp.tool
def multiply(a: int, b: int) -> int:
    """Multiply two numbers"""
    return a * b

@mcp.tool
def divide(a: int, b: int) -> float:
    """Divide two numbers"""
    return a / b

@mcp.tool
def square(a: int) -> int:
    """Square a number"""
    return a * a

# Health endpoint for monitoring
@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:
    return JSONResponse({"status": "OK"})


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8000, path="/mcp")
