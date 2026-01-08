# Build from monorepo root context
# Usage: docker build -f apps/load-tests/Dockerfile .
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy root package files for yarn workspace setup
COPY package.json yarn.lock ./

# Copy tsconfig.base.json (needed for TypeScript compilation)
COPY tsconfig.base.json ./

# Enable corepack for Yarn 4
RUN corepack enable

# Copy workspace package.json files in a way that preserves structure
# First create directories
RUN mkdir -p packages/core packages/dapp-client packages/wallet-client \
    apps/load-tests apps/web-demo apps/rn-demo apps/integration-tests

# Copy all package.json files (needed for yarn workspace resolution)
COPY packages/core/package.json ./packages/core/
COPY packages/dapp-client/package.json ./packages/dapp-client/
COPY packages/wallet-client/package.json ./packages/wallet-client/
COPY apps/load-tests/package.json ./apps/load-tests/
COPY apps/web-demo/package.json ./apps/web-demo/
COPY apps/rn-demo/package.json ./apps/rn-demo/
COPY apps/integration-tests/package.json ./apps/integration-tests/

# Copy load-tests tsconfig
COPY apps/load-tests/tsconfig.json ./apps/load-tests/

# Install dependencies (without frozen lockfile for Docker build)
RUN yarn install

# Copy load-tests source code
COPY apps/load-tests/src ./apps/load-tests/src
# Copy config directory (if it doesn't exist, create empty one)
COPY apps/load-tests/config ./apps/load-tests/config

# Set working directory to load-tests app
WORKDIR /app/apps/load-tests

# Set entrypoint to load test CLI
# Use yarn start which will use tsx from node_modules
ENTRYPOINT ["yarn", "start"]

# Default command (can be overridden)
CMD ["--help"]
