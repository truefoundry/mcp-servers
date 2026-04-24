# Google Workspace MCP Server — Docker image
# syntax=docker/dockerfile:1
#
# Builds inside the image so it works with TrueFoundry remote builds
# (Build(LocalSource(local_build=False), DockerFileBuild(...))).

FROM node:20-slim

WORKDIR /app

COPY package*.json ./

# `prepare` lifecycle would invoke `npm run build` before src/ is copied; skip it.
RUN npm ci --no-audit --no-fund --ignore-scripts

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

# Drop devDependencies for a leaner runtime image.
RUN npm prune --omit=dev

# /config is the canonical mount path for OAuth credentials and tokens.
RUN mkdir -p /config && chown -R node:node /app /config

ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000 \
    PORT=3000 \
    HOST=0.0.0.0 \
    TRANSPORT=http

USER node

EXPOSE 3000

CMD ["node", "dist/index.js", "start", "--transport", "http", "--port", "3000", "--host", "0.0.0.0"]
