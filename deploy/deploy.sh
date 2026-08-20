#!/usr/bin/env bash
#
# OpenFireWatch — build and start the production stack, labelled with what it
# actually is.
#
# `docker compose up --build` on its own produces images that cannot say which
# commit they came from, which is exactly the question worth asking right
# after a deploy: is the fix I just pushed the one that is running? This wraps
# the same command and passes the answer in.
#
# Usage (on the server, from /opt/openfirewatch):
#   deploy/deploy.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_VERSION="$(cat VERSION)"
# Marked dirty when the working tree has uncommitted changes: an image built
# from edited files is not the commit it names, and finding that out later
# costs more than the two seconds this check takes.
GIT_SHA="$(git rev-parse --short HEAD)"
if ! git diff --quiet || ! git diff --cached --quiet; then
  GIT_SHA="${GIT_SHA}-dirty"
fi
export APP_VERSION GIT_SHA

echo "Building OpenFireWatch v${APP_VERSION} (${GIT_SHA})"

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

echo
echo "Deployed. Verify what is running with:"
echo "  curl -s https://openfirewatch.org/api/health"
