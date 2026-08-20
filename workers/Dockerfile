# =============================================================================
# OpenFireWatch — ingestion workers image (multi-stage: build → slim runtime)
# =============================================================================

# --- Stage 1: compile TypeScript ---------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first to maximize Docker layer caching.
# `npm ci` when a lockfile is committed (reproducible), `npm install` otherwise.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: production runtime ----------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never run as root inside the container ("node" user ships with the image).
USER node
CMD ["node", "dist/index.js"]
