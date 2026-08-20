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

# Build identity. The release version comes from package.json, which is copied
# in below and read at runtime; the commit cannot be — git is not in the image
# — so it is passed in. Both default to nothing, which keeps a plain
# `docker compose build` working and simply reports the revision as unknown.
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# Standard OCI labels: `docker inspect` answers what an image is without
# having to start it or guess from the tag.
LABEL org.opencontainers.image.title="OpenFireWatch workers" \
      org.opencontainers.image.description="Ingestion workers: satellite, weather and soil-moisture polling" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/michifueby/OpenFireWatch" \
      org.opencontainers.image.licenses="MIT"

COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never run as root inside the container ("node" user ships with the image).
USER node
CMD ["node", "dist/index.js"]
