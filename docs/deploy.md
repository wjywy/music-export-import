# 部署：挂到现有站点 /tool/music

目标地址：

```text
https://a2a-platform.com/tool/music/
```

公共工具入口 `/tool/` 是独立静态页，文件和反代顺序见 [tool/README.md](../tool/README.md)；它不能覆盖 `/tool/music/`。

架构：

```text
浏览器
  └─ https://a2a-platform.com/tool/music/     （现有站点 Caddy，已有证书）
       └─ 127.0.0.1:8090                      （本项目的 web 容器）
            ├─ /assets/*                      前端静态文件
            └─ /api/*                         转发到 api 容器
                 └─ MySQL（仅容器网络）
```

前端和 API 同一个域名，**不需要额外域名、不需要 CORS、不需要再起 TLS 服务**。

## 一、代码已经按子路径改好

- Vite `base`：`/tool/music/`
- React Router `basename`：`/tool/music`
- API 默认地址：`/tool/music/api`
- 页面内所有 `/app`、`/login` 链接都会自动带 `/tool/music` 前缀
- 生产构建通过 `VITE_BASE` 注入，开发环境仍然是 `/`

## 二、服务器启动

```bash
git clone git@github.com:wjywy/music-export-import.git /home/admin/dukou
cd /home/admin/dukou
cp .env.production.example .env.production
```

编辑 `.env.production`：

```dotenv
MYSQL_ROOT_PASSWORD=强密码
DB_PASSWORD=强密码
JWT_SECRET=openssl rand -base64 32
CREDENTIALS_SECRET=openssl rand -base64 32

VITE_BASE=/tool/music/
WEB_ORIGIN=https://a2a-platform.com
WEB_BASE_URL=https://a2a-platform.com/tool/music
WEB_PORT=8090
WEB_BIND=127.0.0.1
NPM_REGISTRY=https://registry.npmmirror.com

# Apple Music 站内直写（可选）：自动签发开发者 token（推荐）
# 不配置 APPLE_MUSIC_* 时，前端使用 Soundiiz 免费导入
APPLE_MUSIC_STOREFRONT=cn
APPLE_MUSIC_TEAM_ID=
APPLE_MUSIC_KEY_ID=
# .p8 内容；换行写成 \n
APPLE_MUSIC_PRIVATE_KEY=
# 也可以改为手工 JWT：APPLE_MUSIC_TOKEN=
```

Apple Music 的 `APPLE_MUSIC_*` 变量会传给 API 容器；`APPLE_MUSIC_PRIVATE_KEY` 里的 `$` 等字符不要做 shell 展开。配置后用 `GET /api/platforms/apple/config` 确认 `configured: true`。

启动：

```bash
sudo docker compose -p dukou -f docker-compose.prod.yml --env-file .env.production up -d --build
```

确认容器：

```bash
sudo docker compose -p dukou -f docker-compose.prod.yml --env-file .env.production ps
curl http://127.0.0.1:8090/api/health
```

## 三、现有站点反向代理

### 当前服务器：Caddy

配置文件在 `/home/admin/caddy/Caddyfile`，是挂进 `caddy` 容器的。在 `a2a-platform.com { ... }` 里、默认 `handle` 之前加：

```caddyfile
  redir /tool /tool/ 308
  redir /tool/music /tool/music/ 308

  # 渡口：去掉 /tool/music 前缀后交给容器里的 nginx
  handle_path /tool/music/* {
    reverse_proxy 127.0.0.1:8090
  }

  # /tool/ 工具入口：静态文件已经打进 web 镜像的 /tool/
  handle /tool/* {
    reverse_proxy 127.0.0.1:8090
  }
```

`handle_path` 会去掉 `/tool/music` 前缀，再交给 web 容器，所以容器内部仍然按 `/` 和 `/api` 工作。

```bash
sudo docker exec caddy caddy reload \
  --config /etc/caddy/Caddyfile \
  --adapter caddyfile
```

### 如果站点用 nginx

在 `a2a-platform.com` 的 `server { ... }` 里加：

```nginx
location = /tool {
    return 301 /tool/;
}

location = /tool/music {
    return 301 /tool/music/;
}

# 工具入口：web 容器里的 /tool/
location /tool/ {
    proxy_pass http://127.0.0.1:8090;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /tool/music/ {
    proxy_pass http://127.0.0.1:8090/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

`proxy_pass` 末尾的 `/` 不能丢。改完：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 四、验证

```bash
curl -I https://a2a-platform.com/tool/
curl -I https://a2a-platform.com/tool/music/
curl -fsS https://a2a-platform.com/tool/music/api/health
```

- `/tool/` 返回 200，且能看到渡口卡片；
- `/tool/tools.js` 返回 200；
- `/tool/music/` 返回 200；
- `/tool/music/api/health` 返回 `{"ok":true,...}`；
- 直接刷新 `/tool/music/app` 不 404；
- 注册、导入、扫码迁移走通。

## 五、更新

```bash
cd /home/admin/dukou
git pull --ff-only
sudo docker compose -p dukou -f docker-compose.prod.yml --env-file .env.production up -d --build
```

migration 会在 API 启动前自动执行。`VITE_BASE` 变了才需要重新构建前端；普通后端更新只重建 API。

## 六、备份

```bash
set -a; source .env.production; set +a
sudo -E ./scripts/backup-mysql.sh
```

## 七、GitHub Actions 自动部署

工作流：`.github/workflows/deploy.yml`，手动触发。

GitHub Secrets：

| Secret | 说明 |
| --- | --- |
| `ALIYUN_HOST` | 现有站点服务器 IP / 域名 |
| `ALIYUN_USER` | SSH 用户 |
| `ALIYUN_PORT` | SSH 端口 |
| `ALIYUN_SSH_KEY` | 私钥 |
| `ALIYUN_DEPLOY_PATH` | 服务器仓库路径，例如 `/home/admin/dukou` |

服务器需要先按上面步骤 clone、创建 `.env.production`，并且反向代理已加好 `/tool/music` 路由。工作流只负责 `git pull` + `docker compose up -d --build`，不会改 nginx。

## 八、常见问题

**页面空白 / assets 404**

- 构建时 `VITE_BASE` 不是 `/tool/music/`；
- 或者 nginx `proxy_pass` 末尾少了 `/`。

**`/tool/music/api/health` 404**

- 检查 `proxy_pass` 是否是 `http://127.0.0.1:8080/`；
- 检查容器是否健康：`curl http://127.0.0.1:8090/api/health`。

**刷新子路由 404**

- web 容器 nginx 已经有 `try_files ... /index.html`；
- 确认请求被 host nginx 转发到了 web 容器，而不是被现有站点的 `/` 规则截走。

**8080 是否需要开安全组**

不需要。它只绑定 `127.0.0.1`，由现有 nginx 反代。确认 `.env.production` 里是 `WEB_BIND=127.0.0.1`。

**Docker Hub 拉不动**

配置镜像加速，或把 `MYSQL_IMAGE` 换成可达镜像。`node:22-alpine`、`nginx:1.27-alpine` 也需要能拉取。
