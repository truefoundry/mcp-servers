from fastmcp import FastMCP

mcp = FastMCP("Simple Calculator 🚀")

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
def divide(a: int, b: int) -> int:
    """Divide two numbers"""
    return a / b

@mcp.tool
def square(a: int) -> int:
    """Square a number"""
    return a * a


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8000, path="/")
