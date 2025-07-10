# Simple Calculator MCP Server

A Model Context Protocol (MCP) server that provides basic mathematical operations. This server demonstrates how to create a custom MCP server using FastMCP with health monitoring capabilities.

## Quick Start

### Creating your first server using "fastmcp"

You can create your mcp server as shown below. All the tools can be defined as functions and decorated with the `@mcp.tool` decorator.
Please make sure that the inputs and outputs are properly type annotated and have short descriptions in the docstring.

```python
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
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8000)
```

## Available Tools

The server provides the following mathematical operations:

- `add(a: int, b: int)` - Add two numbers
- `subtract(a: int, b: int)` - Subtract two numbers  
- `multiply(a: int, b: int)` - Multiply two numbers
- `divide(a: int, b: int)` - Divide two numbers (returns float)
- `square(a: int)` - Square a number

## Health Endpoint

The server includes a health endpoint for monitoring and deployment:

### `/health`
Simple health check endpoint suitable for load balancers and monitoring systems.

**Example:**
```bash
curl http://localhost:8000/health
```

**Response:**
```json
{
  "status": "OK"
}
```

## Running Locally

### Prerequisites
- Python 3.12+
- pip or uv for package management

### Installation & Running

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python main.py
```

The server will start on `http://localhost:8000` with the following endpoints:
- **MCP Protocol**: `http://localhost:8000/mcp/` (Streamable HTTP)
- **Health Check**: `http://localhost:8000/health`

### Testing the Server

#### Using MCP Inspector
```bash
npx @modelcontextprotocol/inspector
```

Enter the URL `http://localhost:8000/mcp/` and click "Connect" to test the server.

---

## TrueFoundry Deployment

The server can be deployed on TrueFoundry using the included `truefoundry.yaml` configuration.

### Configuration
Update the following placeholders in `truefoundry.yaml`:
- `host`: Replace with the pre-configured host for your application. You can read [here](https://docs.truefoundry.com/docs/define-ports-and-domains#endpoint) for more details.
- `workspace_fqn`: Replace with the workspace_fqn of the server. You can read [here](https://docs.truefoundry.com/docs/key-concepts#fqn) for more details.
- `commit_hash`: Replace with the commit hash of the latest main branch.


You can deploy the server on Truefoundry by running the following command (Please make sure you have [Truefoundry CLI](https://docs.truefoundry.com/docs/setup-cli) installed on your machine):

### Deploy
```bash
# Install TrueFoundry CLI (if not already installed)
pip install truefoundry

tfy login --host <host>

# Deploy the server
tfy apply -f truefoundry.yaml
```

This will deploy the server on Truefoundry and you can use the server in your applications.