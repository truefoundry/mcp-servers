# Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install yarn
RUN corepack enable && corepack prepare yarn@4.9.2 --activate

# Copy package files
COPY package.json yarn.lock .yarnrc.yml ./

# Install dependencies
RUN yarn install --immutable

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install yarn
RUN corepack enable && corepack prepare yarn@4.9.2 --activate

# Copy package files and install production dependencies
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable && yarn workspaces focus --production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production

CMD ["node", "dist/SlackServer.js"]