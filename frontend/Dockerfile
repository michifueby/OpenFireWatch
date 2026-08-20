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

# nginx serves the SPA and proxies /api + /socket.io to the backend, so the
# browser only ever talks to a single origin (no CORS in production).
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/openfirewatch/browser /usr/share/nginx/html

EXPOSE 80
