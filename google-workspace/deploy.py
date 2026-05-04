"""
Deploy google-workspace-mcp to TrueFoundry from the local working copy.

Usage:
    1. export GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (see .env.example or
       Google Cloud Console -> Credentials -> your OAuth web client).
    2. tfy login --host https://internal.devtest.truefoundry.tech
    3. python deploy.py

This uses LocalSource(local_build=False), so TrueFoundry zips this directory
(respecting .dockerignore), uploads it, builds the image remotely, and deploys.
"""

import json
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
    StringDataMount,
)

logging.basicConfig(level=logging.INFO)

# ---- EDIT THESE -------------------------------------------------------------
GOOGLE_CLIENT_ID = os.environ.get(
    "GOOGLE_CLIENT_ID",
    "REPLACE_WITH_CLIENT_ID",
)
GOOGLE_CLIENT_SECRET = os.environ.get(
    "GOOGLE_CLIENT_SECRET",
    "REPLACE_WITH_CLIENT_SECRET",
)
GOOGLE_PROJECT_ID = os.environ.get(
    "GOOGLE_PROJECT_ID",
    "vocal-exchanger-487911-t1",
)
REDIRECT_URI = (
    "https://internal.devtest.truefoundry.tech"
    "/api/svc/v1/llm-gateway/mcp-servers/oauth2/callback"
)
SERVICE_HOST = (
    "google-workspace-mcp-a2a-3000.tfy-usea1-ctl.devtest.truefoundry.tech"
)
WORKSPACE_FQN = "tfy-usea1-devtest:a2a"
# ----------------------------------------------------------------------------

assert GOOGLE_CLIENT_ID != "REPLACE_WITH_CLIENT_ID", "Set GOOGLE_CLIENT_ID"
assert GOOGLE_CLIENT_SECRET != "REPLACE_WITH_CLIENT_SECRET", "Set GOOGLE_CLIENT_SECRET"

gcp_keys = {
    "web": {
        "client_id": GOOGLE_CLIENT_ID,
        "project_id": GOOGLE_PROJECT_ID,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uris": [REDIRECT_URI],
    }
}

service = Service(
    name="google-workspace-mcp",
    image=Build(
        build_source=LocalSource(local_build=False),
        build_spec=DockerFileBuild(
            dockerfile_path="./Dockerfile",
            build_context_path="./",
            command="node dist/index.js start --transport http --port 3000 --host 0.0.0.0",
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
        "HOST": "0.0.0.0",
        "PORT": "3000",
        "TRANSPORT": "http",
        "MCP_HTTP_HOST": "0.0.0.0",
        "MCP_HTTP_PORT": "3000",
        "MCP_TRANSPORT": "http",
        "GOOGLE_WORKSPACE_OAUTH_CREDENTIALS": "/app/gcp.json",
        # Back-compat with shared auth module
        "GOOGLE_DRIVE_OAUTH_CREDENTIALS": "/app/gcp.json",
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
    mounts=[
        StringDataMount(
            mount_path="/app/gcp.json",
            data=json.dumps(gcp_keys, indent=2),
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
