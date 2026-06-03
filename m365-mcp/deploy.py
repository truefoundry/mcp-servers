"""
Deploy m365-mcp to TrueFoundry from the local working copy.

Usage:
    1. tfy login --host https://internal.devtest.truefoundry.tech
    2. python deploy.py

Overrides (optional env vars):
    WORKSPACE_FQN  -> target workspace, "<cluster>:<workspace>" form.
    SERVICE_HOST   -> public host for the exposed port.

Notes:
    - This MCP server holds NO Microsoft credentials. The TFY LLM Gateway runs
      the OAuth flow against your Entra ID app registration and forwards the
      resulting per-user Graph access token in the Authorization header. The pod
      just passes that bearer straight through to Microsoft Graph and is fully
      stateless.

This uses LocalSource(local_build=False), so TrueFoundry zips this directory
(respecting .tfyignore), uploads it, builds the image remotely, and deploys.
.dockerignore is a second filter that runs inside `docker build` itself. Unlike
the TypeScript servers in this repo, m365-mcp is plain JS and runs straight from
`src/` via `node src/index.js` (no build step), so node_modules is reinstalled
inside the image by `npm ci`.
"""

import logging
import os

from truefoundry.deploy import (
    Build,
    DockerFileBuild,
    HealthProbe,
    HttpProbe,
    LocalSource,
    NodeSelector,
    Port,
    Resources,
    Service,
)

logging.basicConfig(level=logging.INFO)

# ---- EDIT THESE -------------------------------------------------------------
# Deploying into the harsh-ws workspace. Confirm the cluster/host for your
# environment and override via env vars if they differ.
WORKSPACE_FQN = os.environ.get("WORKSPACE_FQN", "tfy-usea1-devtest:harsh-ws")
SERVICE_HOST = os.environ.get(
    "SERVICE_HOST",
    "m365-mcp-harsh-ws-3000.tfy-usea1-ctl.devtest.truefoundry.tech",
)
# ----------------------------------------------------------------------------

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
        cpu_request=0.1,
        cpu_limit=0.5,
        memory_request=256,
        memory_limit=1024,
        ephemeral_storage_request=500,
        ephemeral_storage_limit=500,
        node=NodeSelector(capacity_type="spot_fallback_on_demand"),
    ),
    env={
        "PORT": "3000",
    },
    ports=[
        Port(
            port=3000,
            protocol="TCP",
            expose=True,
            app_protocol="http",
            host=SERVICE_HOST,
        )
    ],
    liveness_probe=HealthProbe(
        config=HttpProbe(path="/health", port=3000),
        period_seconds=10,
        timeout_seconds=1,
        failure_threshold=3,
        success_threshold=1,
        initial_delay_seconds=10,
    ),
    readiness_probe=HealthProbe(
        config=HttpProbe(path="/health", port=3000),
        period_seconds=10,
        timeout_seconds=1,
        failure_threshold=3,
        success_threshold=1,
        initial_delay_seconds=5,
    ),
    replicas=1.0,
)

service.deploy(workspace_fqn=WORKSPACE_FQN, wait=False)
