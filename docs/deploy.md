# 部署

结论先说：

- **推荐：阿里云 ECS + Docker Compose + Caddy 自动 HTTPS**。前端、API、MySQL 全在一台机器上，一个域名，最少的心智负担。
- **Vercel 只能托管前端**。API、MySQL、扫码会话必须放在阿里云；适合“前端放 Vercel、API 放阿里云”的拆分布署。
- **GitHub 不是运行环境**。GitHub Pages 只能放静态前端，跑不了 NestJS、MySQL 和扫码接口；GitHub Actions 用来做 CI/CD。

## 一、阿里云全栈部署（推荐）

### 1. 准备

- 一台阿里云 ECS，建议 2 核 4G 起，Ubuntu 22.04 / Alibaba Cloud Linux 均可。
- 一个域名，A 记录指向 ECS 公网 IP。
- 安全组放行：`22`（SSH）、`80`、`443`。**不要**放行 `3306` 和 `3000`。
- 安装 Docker 与 Compose 插件：

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker

# 验证
docker version
docker compose version
```

### 2. 拉代码

```bash
sudo mkdir -p /srv && sudo chown "$USER" /srv
git clone git@github.com:wjywy/music-export-import.git /srv/dukou
cd /srv/dukou
```

> 服务器没有配置 GitHub SSH key 时，用 HTTPS clone，或先在服务器生成 key 加到 GitHub。

### 3. 配置环境变量

```bash
cp .env.production.example .env.production
```

生成两个独立密钥：

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # CREDENTIALS_SECRET
```

编辑 `.env.production`，至少改这些：

```dotenv
DOMAIN=music.example.com
WEB_ORIGIN=https://music.example.com
WEB_BASE_URL=https://music.example.com

MYSQL_ROOT_PASSWORD=...
DB_PASSWORD=...

JWT_SECRET=...
CREDENTIALS_SECRET=...

NPM_REGISTRY=https://registry.npmmirror.com
```

注意：

- `CREDENTIALS_SECRET` 必须固定。换掉后，已连接的网易云 / QQ 会话无法解密，用户需要重新扫码。
- `WEB_ORIGIN` 必须和浏览器地址完全一致（协议、域名、端口）。
- `.env.production` 不要提交到 Git。

### 4. 启动

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.tls.yml \
  --env-file .env.production \
  up -d --build
```

首次会：

1. 启动 MySQL；
2. API 自动执行 TypeORM migration；
3. 启动 NestJS；
4. nginx 提供前端；
5. Caddy 申请 Let's Encrypt 证书并反代到 `web:80`。

查看状态：

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env.production ps
```

### 5. 验证

```bash
curl -fsS https://music.example.com/api/health
# {"ok":true,"driver":"mysql","time":"...","platforms":2}
```

打开 `https://music.example.com`，注册账号，导入一张 QQ / 网易云歌单，扫码迁移。

> 生产环境不要执行 `pnpm seed`，它会写入演示账号和演示歌单。需要演示数据时再单独执行。

### 6. 更新

```bash
cd /srv/dukou
git pull --ff-only
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.tls.yml \
  --env-file .env.production \
  up -d --build
```

migration 会在 API 启动前自动执行。

### 7. 日志与备份

```bash
# 日志
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env.production logs -f api

# 备份（会读取 MYSQL_ROOT_PASSWORD）
set -a; source .env.production; set +a
./scripts/backup-mysql.sh
```

备份文件在 `backups/`，默认保留 14 天。

### 8. 常见问题

**Docker Hub 拉不动 MySQL / Node / nginx**

给 Docker 配置镜像加速，或把 `MYSQL_IMAGE` 换为可达镜像，例如：

```dotenv
MYSQL_IMAGE=docker.m.daocloud.io/library/mysql:8.4
```

`node:22-alpine`、`nginx:1.27-alpine`、`caddy:2-alpine` 也需要能拉取；国内服务器建议配置阿里云容器镜像服务的加速地址。

**HTTPS 证书一直申请不到**

- 域名 A 记录是否已生效；
- 安全组是否放行 80 / 443；
- Caddy 日志：`docker compose ... logs -f caddy`。

**页面打开但接口 404 / CORS**

- nginx 已把 `/api/` 反代到 API，前端默认用相对路径；
- 如果前端单独部署（Vercel），必须设置 `VITE_API_BASE`，并把该域名加到 API 的 `WEB_ORIGIN`。

**不想用 Caddy / 已有宿主机 nginx**

只用 `docker-compose.prod.yml`，把 `.env.production` 里的 `WEB_BIND` 改为 `0.0.0.0`，由宿主机 nginx 反代 `127.0.0.1:8080`，再自行配 certbot。

## 二、GitHub Actions 自动部署到阿里云

工作流：`.github/workflows/deploy.yml`，只能手动触发，避免没有服务器密钥时每次 push 都失败。

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 说明 |
| --- | --- |
| `ALIYUN_HOST` | ECS 公网 IP 或域名 |
| `ALIYUN_USER` | SSH 用户，例如 `root` 或 `ubuntu` |
| `ALIYUN_PORT` | SSH 端口，默认 22 |
| `ALIYUN_SSH_KEY` | 私钥全文，对应服务器 `~/.ssh/authorized_keys` |
| `ALIYUN_DEPLOY_PATH` | 服务器仓库路径，例如 `/srv/dukou` |

前提：服务器已经按上面步骤 clone 仓库、创建 `.env.production`，并且 `docker compose` 可用。

触发：**Actions → Deploy to Aliyun → Run workflow**。它会：

```bash
git fetch/checkout/pull
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml --env-file .env.production up -d --build
```

## 三、Vercel 部署前端（可选）

Vercel 不能跑这个 NestJS + MySQL 后端。可行形态是：

```
Vercel: apps/web 静态前端
阿里云: API + MySQL + HTTPS
```

### 1. Vercel 导入

- 导入 `wjywy/music-export-import`；
- 根目录保持仓库根目录，仓库里的 `vercel.json` 会执行：
  - `pnpm install --frozen-lockfile`
  - `pnpm --filter @dukou/web build`
  - 输出 `apps/web/dist`
- 环境变量：

```dotenv
VITE_API_BASE=https://music.example.com/api
```

### 2. 阿里云 API 允许 Vercel 域名

`.env.production`：

```dotenv
WEB_ORIGIN=https://your-app.vercel.app,https://music.example.com
```

重启 API。

### 3. 注意

- 扫码会话、歌单、匹配结果都在阿里云；
- 前端域名和 API 域名不同，必须正确配置 CORS；
- 自定义域名后记得把新域名加进 `WEB_ORIGIN`。

## 四、GitHub Pages 可以吗

只能放静态前端，不能跑 API、MySQL 和扫码登录。除非你愿意把 API 继续放在阿里云，否则不建议。GitHub 更适合当代码仓库和 CI/CD，而不是运行环境。

## 五、上线检查清单

- [ ] 域名 A 记录指向 ECS
- [ ] 安全组只放行 22 / 80 / 443
- [ ] `.env.production` 已填强密码和两个独立密钥
- [ ] `WEB_ORIGIN` / `WEB_BASE_URL` 是最终 HTTPS 域名
- [ ] `docker compose ... ps` 三个服务健康
- [ ] `https://域名/api/health` 返回 `ok: true`
- [ ] 注册账号、导入歌单、扫码迁移走通
- [ ] 备份脚本能跑
- [ ] `.env.production` 没有被提交
