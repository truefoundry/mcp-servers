FROM tfy.jfrog.io/tfy-mirror/node:24

# Install dependencies: curl, unzip, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install kubectl v1.34.0
RUN curl -LO "https://dl.k8s.io/release/v1.34.0/bin/linux/amd64/kubectl" \
    && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl \
    && rm kubectl

# Create the init script
RUN mkdir -p /scripts
RUN cat > /scripts/init.sh << 'EOF'
#!/bin/bash
mkdir -p ~/.kube
echo "$KUBECONFIG_JSON" > ~/.kube/config
kubectl config use-context "$K8S_CONTEXT"
kubectl config set-context --current --namespace="$K8S_NAMESPACE"
npx -y mcp-proxy --port 8000 --host 0.0.0.0 --server stream --debug npx mcp-server-kubernetes
EOF

# Make the script executable
RUN chmod +x /scripts/init.sh

# Set the script as the container entrypoint to run on startup
CMD ["/scripts/init.sh"]
