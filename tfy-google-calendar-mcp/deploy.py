import logging
from truefoundry.deploy import (
    Service,
    LocalSource,
    Autoshutdown,
    StringDataMount,
    NodeSelector,
    DockerFileBuild,
    Build,
    Resources,
    Port,
)

logging.basicConfig(level=logging.INFO)

service = Service(
    name="google-calendar-mcp",
    image=Build(
        build_source=LocalSource(),
        build_spec=DockerFileBuild(
            dockerfile_path="./Dockerfile",
            build_context_path="./",
            command="node build/index.js",
        ),
    ),
    resources=Resources(
        cpu_request=0.5,
        cpu_limit=0.5,
        memory_request=1000,
        memory_limit=1000,
        ephemeral_storage_request=500,
        ephemeral_storage_limit=500,
        node=NodeSelector(capacity_type="spot"),
    ),
    env={"GOOGLE_OAUTH_CREDENTIALS": "gcp.json", "HOST": "0.0.0.0", "PORT": "3000", "TRANSPORT": "http"},
    ports=[
        Port(
            port=3000,
            protocol="TCP",
            expose=True,
            app_protocol="http",
            host="google-calendar-mcp-mcp-3000.tfy-usea1-ctl.devtest.truefoundry.tech",
        )
    ],
    mounts=[
        StringDataMount(
            mount_path="/app/gcp.json",
            data='{\n  "installed": {\n    "client_id": "443285865465-k377bgt1dhp46vnj2svt01mgunr74jgh.apps.googleusercontent.com",\n    "project_id": "tfy-devtest",\n    "auth_uri": "https://accounts.google.com/o/oauth2/auth",\n    "token_uri": "https://oauth2.googleapis.com/token",\n    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",\n    "client_secret": "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",\n    "redirect_uris": [\n      "https://internal.devtest.truefoundry.tech/api/svc/v1/llm-gateway/mcp-servers/oauth2/callback"\n    ]\n  }\n}\n',
        )
    ],
    replicas=1.0,
    auto_shutdown=Autoshutdown(wait_time=900),
)


service.deploy(workspace_fqn="tfy-usea1-devtest:mcp", wait=False)
