# Docker Deployment Guide

Simple, production-ready Docker setup for the Google Calendar MCP Server. Follow the quick start guide if you already have the project downloaded.

## Quick Start 

```bash
# 1. Place OAuth credentials in project root 
# * optional if you have already place the file in the root of this project folder
cp /path/to/your/gcp-oauth.keys.json ./gcp-oauth.keys.json

# 2. Copy example .env file to configure environment variables (optional)
cp .env.example .env

# 3. Build and start the server
docker compose up -d

# 4. Authenticate (one-time setup)
# This will show the authentication URL that needs to be 
# visited to give authorization to the applicaiton. 
# Visit the URL and complete the OAuth process.
docker compose exec calendar-mcp npm run auth
# Note: This step only needs to be done once unless the app is in testing mode
# in which case the tokens expire after 7 days 

# 5. Add to Claude Desktop config (see stdio Mode section below)
```

## Two Modes

### stdio Mode (Recommended for Claude Desktop)
**Direct process integration for Claude Desktop:**

#### Step 1: Initial Setup
```bash
# Clone and setup
git clone https://github.com/nspady/google-calendar-mcp.git
cd google-calendar-mcp

# Place your OAuth credentials in the project root
cp /path/to/your/gcp-oauth.keys.json ./gcp-oauth.keys.json

# Build and start the container
docker compose up -d

# Authenticate (one-time setup)
docker compose exec calendar-mcp npm run auth
```

#### Step 2: Claude Desktop Configuration
Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--mount", "type=bind,src=/absolute/path/to/your/gcp-oauth.keys.json,dst=/app/gcp-oauth.keys.json",
        "--mount", "type=volume,src=google-calendar-mcp_calendar-tokens,dst=/home/nodejs/.config/google-calendar-mcp",
        "google-calendar-mcp"
      ]
    }
  }
}
```

**⚠️ Important**: Replace `/absolute/path/to/your/gcp-oauth.keys.json` with the actual absolute path to your credentials file.

#### Step 3: Restart Claude Desktop
Restart Claude Desktop to load the new configuration. The server should now work without authentication prompts.

### HTTP Mode
**For testing, debugging, and web integration (Claude Desktop uses stdio):**

#### Step 1: Configure Environment
```bash
# Clone and setup
git clone https://github.com/nspady/google-calendar-mcp.git
cd google-calendar-mcp

# Place your OAuth credentials in the project root
cp /path/to/your/gcp-oauth.keys.json ./gcp-oauth.keys.json

# Configure for HTTP mode
cp .env.example .env
# Edit .env to set:
echo "TRANSPORT=http" >> .env
echo "HOST=0.0.0.0" >> .env
echo "PORT=3000" >> .env
echo "GOOGLE_OAUTH_CREDENTIALS=./gcp-oauth.keys.json" >> .env
```

#### Step 2: Start and Authenticate
```bash
# Build and start the server in HTTP mode
docker compose up -d

# Authenticate (one-time setup)
docker compose exec calendar-mcp npm run auth
# This will show authentication URLs (visit the displayed URL)
# This step only needs to be done once unless the app is in testing mode
# in which case the tokens expire after 7 days 

# Verify server is running
curl http://localhost:3000/health
# Should return: {"status":"healthy","server":"google-calendar-mcp","version":"1.3.0"}
```

#### Step 3: Test with cURL Example
```bash
# Run comprehensive HTTP tests
bash examples/http-with-curl.sh

# Or test specific endpoint
bash examples/http-with-curl.sh http://localhost:3000
```

#### Step 4: Claude Desktop HTTP Configuration
Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "google-calendar": {
      "command": "mcp-client",
      "args": ["http://localhost:3000"]
    }
  }
}
```

**Note**: HTTP mode requires the container to be running (`docker compose up -d`)