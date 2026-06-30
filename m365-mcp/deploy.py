"""
Deploy m365-mcp to TrueFoundry (prod: tfy-prod-euwe1:mcp-servers).

Usage:
    1. tfy login --host https://internal.truefoundry.cloud
    2. python deploy.py

Notes:
    - This MCP server holds NO Microsoft credentials. The TFY LLM Gateway runs
      the OAuth flow against the Entra ID app registration and forwards the
      resulting per-user Graph access token in the Authorization header. The pod
      passes that bearer straight through to Microsoft Graph and is stateless.
    - LocalSource(local_build=False): TrueFoundry zips this directory (respecting
      .tfyignore), uploads it, and builds the image remotely. m365-mcp is plain
      JS and runs straight from src/ via `node src/index.js` (no build step);
      node_modules is reinstalled inside the image by `npm ci`.
"""

import logging

from truefoundry.deploy import (
    DockerFileBuild,
    HealthProbe,
    HttpProbe,
    LocalSource,
    Port,
    Service,
    Resources,
    Build,
    NodeSelector,
)

logging.basicConfig(level=logging.INFO)

service = Service(
    name="m365-mcp",
    image=Build(
        build_source=LocalSource(local_build=False),
        build_spec=DockerFileBuild(
            dockerfile_path="./Dockerfile",
            build_context_path="./",
            command="node src/index.js",
        ),
    ),
    resources=Resources(
        cpu_request=0.2,
        cpu_limit=1.0,
        memory_request=200,
        memory_limit=500,
        ephemeral_storage_request=1000,
        ephemeral_storage_limit=2000,
        node=NodeSelector(capacity_type="spot_fallback_on_demand"),
    ),
    env={"PORT": "3000"},
    ports=[
        Port(
            port=3000,
            protocol="TCP",
            expose=True,
            app_protocol="http",
            host="m365.mcp.truefoundry.com",
        )
    ],
    liveness_probe=HealthProbe(
        config=HttpProbe(path="/health", port=3000),
        initial_delay_seconds=10,
        period_seconds=10,
        timeout_seconds=1,
        success_threshold=1,
        failure_threshold=3,
    ),
    readiness_probe=HealthProbe(
        config=HttpProbe(path="/health", port=3000),
        initial_delay_seconds=5,
        period_seconds=10,
        timeout_seconds=1,
        success_threshold=1,
        failure_threshold=3,
    ),
    workspace_fqn="tfy-prod-euwe1:mcp-servers",
    replicas=1.0,
)


service.deploy(workspace_fqn="tfy-prod-euwe1:mcp-servers", wait=False)
