#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB_NAME="${DB_NAME:-dukou}"
ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:?set MYSQL_ROOT_PASSWORD}"

mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$BACKUP_DIR/${DB_NAME}-${stamp}.sql.gz"

docker compose -f "$COMPOSE_FILE" exec -T \
  -e MYSQL_PWD="$ROOT_PASSWORD" mysql \
  mysqldump --single-transaction --quick --routines --triggers \
  -uroot "$DB_NAME" | gzip > "$out"

find "$BACKUP_DIR" -type f -name "${DB_NAME}-*.sql.gz" -mtime +"$KEEP_DAYS" -delete

echo "backup written: $out"
echo "size: $(du -h "$out" | cut -f1)"
