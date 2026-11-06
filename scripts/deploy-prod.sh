#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$repo_root"
if [[ ! -r .env.production ]]; then
  printf '缺少 .env.production，请先按 docs/deploy.md 配置生产环境。\n' >&2
  exit 1
fi

compose=(sudo docker compose -p dukou -f docker-compose.prod.yml --env-file .env.production)
"${compose[@]}" config --quiet

# Build both images before replacing any running service.
"${compose[@]}" build api
"${compose[@]}" build web
"${compose[@]}" up -d --wait --wait-timeout 180 mysql api
# Nginx resolves api's container address at startup, so recreate web after api.
"${compose[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 60 web

for attempt in {1..10}; do
  if health=$("${compose[@]}" exec -T web wget -q -T 5 -O - http://127.0.0.1/api/health) &&
      [[ ${health//[[:space:]]/} == *'"ok":true'* ]]; then
    "${compose[@]}" ps
    deploy_revision=$(git rev-parse --short HEAD 2>/dev/null || printf 'unknown')
    printf '\n部署完成，提交 %s\n%s\n' "$deploy_revision" "$health"
    exit 0
  fi
  sleep 2
done

printf '部署后健康检查未通过，请检查 api 和 web 容器日志。\n' >&2
exit 1
