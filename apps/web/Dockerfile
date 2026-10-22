FROM node:22-alpine AS build

ARG NPM_REGISTRY=https://registry.npmjs.org
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE
RUN npm config set registry "$NPM_REGISTRY" && npm install -g pnpm@10.34.5
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @dukou/web

COPY apps/web ./apps/web
RUN pnpm --filter @dukou/web build

FROM nginx:1.27-alpine
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY tool /usr/share/nginx/html/tool
RUN chmod -R a+rX /usr/share/nginx/html/tool
EXPOSE 80
