#!/usr/bin/env bash
#
# OpenFireWatch — database backup.
#
# Dumps PostgreSQL to a timestamped, compressed file and prunes old ones.
# Run it from the project directory, e.g. daily via cron:
#
#   0 3 * * * cd /opt/openfirewatch && ./deploy/backup.sh >> /var/log/ofw-backup.log 2>&1
#
# What is worth backing up: the hazard zones and the evaluation history in
# `validated_events` (the audit trail of every alert ever raised). Raw
# detections regenerate themselves from the satellite feed, so losing those
# costs little — but they are small, so the dump simply takes everything.
#
# A dump on the same disk protects against mistakes, NOT against losing the
# server. Copy BACKUP_DIR off the machine as well.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

# Read database credentials from the deployment's own .env.
set -a; . ./.env; set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/openfirewatch_$STAMP.sql.gz"

echo "[$(date -Is)] dumping to $OUT"
"${COMPOSE[@]}" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip > "$OUT"

# Fail loudly on an empty or truncated dump rather than reporting success.
SIZE=$(wc -c < "$OUT")
if [ "$SIZE" -lt 1024 ]; then
  echo "[$(date -Is)] ERROR: dump is only ${SIZE} bytes — treating as failed" >&2
  exit 1
fi

find "$BACKUP_DIR" -name 'openfirewatch_*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "[$(date -Is)] ok — ${SIZE} bytes, keeping $KEEP_DAYS days"
