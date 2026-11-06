#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
context_root=$(mktemp -d "${TMPDIR:-/tmp}/dukou-context-check.XXXXXX")
trap 'rm -rf -- "$context_root"' EXIT

cp "$repo_root/.dockerignore" "$context_root/.dockerignore"
mkdir -p "$context_root/apps/api" "$context_root/apps/web"
for env_path in .env .env.production apps/api/.env apps/api/.env.production apps/web/.env.local; do
  printf 'DUMMY_CONTEXT_SECRET=not-a-real-secret\n' > "$context_root/$env_path"
done
printf 'EXAMPLE_ONLY=\n' > "$context_root/.env.example"
printf 'source stays in the image\n' > "$context_root/apps/api/source.txt"

cat > "$context_root/Dockerfile" <<'DOCKERFILE'
FROM node:22-alpine
COPY . /probe/
RUN test ! -e /probe/.env \
 && test ! -e /probe/.env.production \
 && test ! -e /probe/apps/api/.env \
 && test ! -e /probe/apps/api/.env.production \
 && test ! -e /probe/apps/web/.env.local \
 && test -e /probe/.env.example \
 && test -e /probe/apps/api/source.txt
DOCKERFILE

docker build --quiet "$context_root" > /dev/null
printf 'Docker context excludes real environment files and retains examples/source.\n'
