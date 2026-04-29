"""
Deploy salesforce-mcp to TrueFoundry from the local working copy.

Usage:
    1. tfy login --host https://internal.devtest.truefoundry.tech
    2. python deploy.py

Notes:
    - This MCP server holds NO Salesforce client credentials. The TFY LLM
      Gateway runs the OAuth Web Server Flow against your Connected App and
      forwards the resulting per-user access token in the Authorization header.
      The pod just consumes that bearer.
    - SF_LOGIN_URL configures the host used to discover each user's
      instance_url via /services/oauth2/userinfo. Override per environment:
        - https://login.salesforce.com  (production)
        - https://test.salesforce.com   (sandbox)
        - https://<your-mydomain>.my.salesforce.com  (My Domain)

This uses LocalSource(local_build=False), so TrueFoundry zips this directory
(respecting .tfyignore), uploads it, builds the image remotely, and deploys.
.dockerignore is a second filter that runs inside `docker build` itself.
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
SF_LOGIN_URL = os.environ.get("SF_LOGIN_URL", "https://login.salesforce.com")
SERVICE_HOST = (
    "salesforce-mcp-a2a-3000.tfy-usea1-ctl.devtest.truefoundry.tech"
)
WORKSPACE_FQN = "tfy-usea1-devtest:a2a"
# ----------------------------------------------------------------------------

service = Service(
    name="salesforce-mcp",
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
        "SF_LOGIN_URL": SF_LOGIN_URL,
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
