# Simple Calculator MCP Server

A Model Context Protocol (MCP) server that provides basic mathematical operations. This can be considered a template to create your custom MCP Server.

## Quick Start

### Creating your first server using "fastmcp"

You can create your mcp server as shown below. All the tools can be defined as functions and decorated with the `@mcp.tool` decorator.
Please make sure that the inputs and outputs are properly type annotated and have short descriptions in the docstring.

```python
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

```

### Running Locally

#### Run the Server
```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python main.py
```

#### Test the Server
Run the following command to test the server.

```bash
npx @modelcontextprotocol/inspector
```

This spins up a UI that you can use to test the server.

Please enter the url (http://localhost:8000) and click on the "Connect" button.

You can now test the server by entering the tool name and the arguments.

## Deploying the Server on Truefoundry
Please replace the following placeholders in the `truefoundry.yaml` file:
- `host`: Replace with the pre-configured host for your application. You can read [here](https://docs.truefoundry.com/docs/define-ports-and-domains#endpoint) for more details.
- `workspace_fqn`: Replace with the workspace_fqn of the server. You can read [here](https://docs.truefoundry.com/docs/key-concepts#fqn) for more details.



You can deploy the server on Truefoundry by running the following command (Please make sure you have [Truefoundry CLI](https://docs.truefoundry.com/docs/setup-cli) installed on your machine):

```bash
tfy apply -f truefoundry.yaml
```

This will deploy the server on Truefoundry and you can use the server in your applications.