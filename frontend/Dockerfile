# =============================================================================
# OpenFireWatch — Angular frontend image (multi-stage: build → nginx)
# =============================================================================

# --- Stage 1: build the Angular application ------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# `npm ci` when a lockfile is committed (reproducible), `npm install` otherwise.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY angular.json tsconfig*.json ./
COPY src ./src
# Static assets (logo, favicon) copied into the bundle by the Angular builder.
COPY public ./public
RUN npm run build

# --- Stage 2: serve static assets with nginx -----------------------------------
FROM nginx:1.27-alpine

# Build identity. Unlike the Node images this one needs no runtime variable:
# the version is compiled into the bundle from frontend/src/app/core/version.ts
# and shown in the about panel. The labels exist so `docker inspect` can still
# answer what a built image is.
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="OpenFireWatch web" \
      org.opencontainers.image.description="Angular situation map, served by nginx" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.source="https://github.com/michifueby/OpenFireWatch" \
      org.opencontainers.image.licenses="MIT"

# nginx serves the SPA and proxies /api + /socket.io to the backend, so the
# browser only ever talks to a single origin (no CORS in production).
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/openfirewatch/browser /usr/share/nginx/html

EXPOSE 80
