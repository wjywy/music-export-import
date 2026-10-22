FROM node:22-alpine

ARG NPM_REGISTRY=https://registry.npmjs.org
RUN npm config set registry "$NPM_REGISTRY" && npm install -g pnpm@10.34.5
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @dukou/api

COPY apps/api ./apps/api
RUN pnpm --filter @dukou/api build

WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
