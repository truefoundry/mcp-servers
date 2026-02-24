FROM mcp/arxiv-mcp-server

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /scripts /papers

COPY <<'EOF' /scripts/init.sh
#!/bin/bash
npx -y mcp-proxy --port 8000 --host 0.0.0.0 --server stream --debug -- python -m arxiv_mcp_server
EOF

RUN chmod +x /scripts/init.sh

ENV ARXIV_STORAGE_PATH="/papers"

EXPOSE 8000

ENTRYPOINT []
CMD ["/scripts/init.sh"]
