#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <backup.sql.gz>" >&2
  exit 1
fi

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_NAME="${DB_NAME:-dukou}"
ROOT_PASSWORD="${MYSQL_ROOT_PASSWORD:?set MYSQL_ROOT_PASSWORD}"
archive="$1"

if [[ ! -f "$archive" ]]; then
  echo "backup not found: $archive" >&2
  exit 1
fi

echo "This will overwrite database '$DB_NAME' from $archive."
read -r -p "Type the database name to continue: " confirm
if [[ "$confirm" != "$DB_NAME" ]]; then
  echo "aborted"
  exit 1
fi

gunzip -c "$archive" | docker compose -f "$COMPOSE_FILE" exec -T \
  -e MYSQL_PWD="$ROOT_PASSWORD" mysql \
  mysql -uroot "$DB_NAME"

echo "restore finished: $archive"
