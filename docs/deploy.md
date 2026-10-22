# 部署：挂到现有站点 /tool/music

目标地址：

```text
https://a2a-platform.com/tool/music/
```

架构：

```text
浏览器
  └─ https://a2a-platform.com/tool/music/     （现有站点 nginx，已有证书）
       └─ 127.0.0.1:8080                      （本项目的 web 容器）
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
git clone git@github.com:wjywy/music-export-import.git /srv/dukou
cd /srv/dukou
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
WEB_PORT=8080
WEB_BIND=127.0.0.1
NPM_REGISTRY=https://registry.npmmirror.com
```

启动：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

确认容器：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl http://127.0.0.1:8080/api/health
```

## 三、现有站点 nginx 加两个 location

在 `a2a-platform.com` 的 `server { ... }` 里加：

```nginx
# 访问 /tool/music 时补斜杠
location = /tool/music {
    return 301 /tool/music/;
}

# 整个工具挂到子路径
location /tool/music/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

**`proxy_pass` 末尾的 `/` 不能丢。** 它会把 `/tool/music/xxx` 改写成 `/xxx`，这样 web 容器仍然按根路径提供静态文件，API 也仍然是 `/api/*`。

> 如果现有站点的 nginx 本身也在 Docker 容器里，`127.0.0.1:8080` 指的是 nginx 容器自己；此时改成 `host.docker.internal:8080`，或让两个 compose 共享网络。

然后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 四、验证

```bash
curl -I https://a2a-platform.com/tool/music/
curl -fsS https://a2a-platform.com/tool/music/api/health
```

- `/tool/music/` 返回 200；
- `/tool/music/api/health` 返回 `{"ok":true,...}`；
- 直接刷新 `/tool/music/app` 不 404；
- 注册、导入、扫码迁移走通。

## 五、更新

```bash
cd /srv/dukou
git pull --ff-only
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

migration 会在 API 启动前自动执行。`VITE_BASE` 变了才需要重新构建前端；普通后端更新只重建 API。

## 六、备份

```bash
set -a; source .env.production; set +a
./scripts/backup-mysql.sh
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
| `ALIYUN_DEPLOY_PATH` | 服务器仓库路径，例如 `/srv/dukou` |

服务器需要先按上面步骤 clone、创建 `.env.production`，并且 nginx 已加好 location。工作流只负责 `git pull` + `docker compose up -d --build`，不会改 nginx。

## 八、常见问题

**页面空白 / assets 404**

- 构建时 `VITE_BASE` 不是 `/tool/music/`；
- 或者 nginx `proxy_pass` 末尾少了 `/`。

**`/tool/music/api/health` 404**

- 检查 `proxy_pass` 是否是 `http://127.0.0.1:8080/`；
- 检查容器是否健康：`curl http://127.0.0.1:8080/api/health`。

**刷新子路由 404**

- web 容器 nginx 已经有 `try_files ... /index.html`；
- 确认请求被 host nginx 转发到了 web 容器，而不是被现有站点的 `/` 规则截走。

**8080 是否需要开安全组**

不需要。它只绑定 `127.0.0.1`，由现有 nginx 反代。确认 `.env.production` 里是 `WEB_BIND=127.0.0.1`。

**Docker Hub 拉不动**

配置镜像加速，或把 `MYSQL_IMAGE` 换成可达镜像。`node:22-alpine`、`nginx:1.27-alpine` 也需要能拉取。
