# 渡口 · Dukou

> 把歌单，渡到对岸。

渡口只做一件事：**QQ 音乐 / 网易云音乐 → QQ 音乐 / 网易云音乐 / Apple Music** 的歌单迁移。粘贴一张公开歌单链接，授权一次，自动匹配并写进账号。

## 功能

- **来源只支持两个平台**：QQ 音乐、网易云音乐；目标另外支持 Apple Music。
- **导入**：粘贴歌单链接或分享口令，读取曲名、歌手、专辑、时长和顺序。
- **QQ / 网易云写入**：用目标平台 App 扫码一次，渡口自动匹配，在账号里新建一张歌单。
- **Apple Music 一键导入**：没配 Apple 开发者 token 时，点「生成导入链接」，渡口把歌单发给 Soundiiz 生成临时链接；用户打开链接登录 Apple Music 完成导入。免费版单次最多 200 首，超出自动分段。
- **Apple Music 站内直写（可选）**：配置 Apple 开发者 token 后，用 MusicKit 授权一次，先匹配、再一键写进资料库。
- **Apple 直写配置只属于部署者**：开发者 token / 私钥在服务端配置一次；终端用户不填写任何密钥。
- **自动匹配**：按曲名、歌手、时长综合判断；Apple Music 额外拒绝 Live / Remix 版本和时长异常项。
- **可断开**：登录态 AES-256-GCM 加密保存，迁移面板里可以随时断开。

## 怎么用

1. 登录渡口，粘贴一张 QQ 音乐或网易云音乐的歌单链接。
2. 打开这张歌单，点「迁移」，选目标平台。
3. QQ / 网易云扫码；Apple Music 选免费导入或直写（取决于服务端是否配置开发者 token）。
4. QQ / 网易云确认后自动匹配并写入；Apple 直写先点「匹配」确认数量，再点「写入」。
5. Apple 免费导入：点「生成 Apple Music 导入链接」→ 打开 Soundiiz → 登录 Apple Music → 确认导入；超过 200 首按段打开。
6. 写入完成后可以直接打开目标平台的歌单。

QQ / 网易云写入使用平台非公开接口，可能受风控或改版影响；Apple 直写走官方 MusicKit API。失败不会改动你已有的歌单，但可能留下新建了一半的目标歌单，需要到目标平台手动删除。Apple 免费导入使用 Soundiiz 公共导入 API：歌单的曲名 / 歌手会发给 Soundiiz 生成临时链接，渡口不保存 Apple 账号。

## 部署

工具挂在现有站点的子路径：`https://a2a-platform.com/tool/music/`。

前端使用 `/tool/music/` 作为 Vite base，React Router basename 为 `/tool/music`；后端仍由 Docker Compose 启动，现有站点的 nginx 把 `/tool/music/` 反代到 `127.0.0.1:8080`。

完整步骤见 [docs/deploy.md](docs/deploy.md)；Apple Music 开发者账号、私钥与验收步骤见 [docs/apple-music.md](docs/apple-music.md)。

`/tool/` 是公共工具目录入口，静态文件在 [tool/](tool/)，部署与新增工具说明见 [tool/README.md](tool/README.md)。

## 技术栈

| 层 | 选择 |
| --- | --- |
| 前端 | React 19 · Vite 7 · TypeScript · React Router 7 · TanStack Query 5 |
| 后端 | Node.js · NestJS 11 · TypeORM 0.3 |
| 数据库 | MySQL 8；表结构由 TypeORM migration 管理 |
| 测试 | Node.js test runner（单元 + Nest e2e）· Playwright |

```
apps/web  (React + Vite)
   │  /api 由 Vite 代理
apps/api  (NestJS)
   ├── MySQL 8
   ├── netease / qq adapters + 扫码写入
   └── Apple Music adapter + MusicKit 写入
```

## 快速开始

要求：Node.js ≥ 20，pnpm ≥ 9，Docker Desktop（或本机 MySQL 8）。

```bash
pnpm install
cp .env.example apps/api/.env

# 启动 MySQL
docker compose up -d

# 建表
pnpm --filter @dukou/api db:migrate

# 演示数据
pnpm seed

# 同时启动 API 与 Web
pnpm dev
```

打开 <http://localhost:5173>。演示账号：`demo@dukou.app` / `demo1234`。

常用脚本：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 并行启动 API 与 Web |
| `pnpm build` | 构建前后端 |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm seed` | 写入演示账号与歌单 |
| `pnpm test:unit` / `test:e2e` / `test:ui` | 分层测试 |

## 关键环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DB_DRIVER` | `mysql` | 使用 MySQL |
| `JWT_SECRET` | 开发默认 | 生产必须替换 |
| `CREDENTIALS_SECRET` | 回退到 `JWT_SECRET` | 加密网易云 / QQ / Apple Music 登录态，生产单独设置 |
| `PORT` | `3000` | API 端口 |
| `WEB_ORIGIN` | `http://localhost:5173` | 允许的跨域来源 |
| `APPLE_MUSIC_STOREFRONT` | `cn` | Apple Music 直写区号；v1 只支持中国区 |
| `APPLE_MUSIC_TOKEN` | 空 | 手工 MusicKit JWT；不配则走 Soundiiz 免费导入 |
| `APPLE_MUSIC_TEAM_ID` / `APPLE_MUSIC_KEY_ID` / `APPLE_MUSIC_PRIVATE_KEY` | 空 | 自动签发开发者 token；不配则走 Soundiiz 免费导入 |

## 主要接口

所有接口以 `/api` 为前缀；除健康检查外均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` · `/auth/login` | 注册 / 登录 |
| GET | `/playlists` | 歌单列表 |
| GET | `/playlists/:id` | 歌单详情 |
| DELETE | `/playlists/:id` | 删除本地歌单（不影响目标平台） |
| POST | `/imports` | 导入 QQ / 网易云歌单 |
| GET | `/imports/:id` | 导入进度 |
| GET | `/accounts` | QQ / 网易云连接状态 |
| POST | `/accounts/:platform/qr` | 生成扫码二维码 |
| GET | `/accounts/:platform/qr/:key` | 轮询扫码状态 |
| DELETE | `/accounts/:platform` | 断开账号 |
| POST | `/playlists/:id/push` | QQ / 网易云：自动匹配并写入账号 |
| POST | `/playlists/:id/match` | 匹配到目标平台（Apple 两步预览用） |
| GET | `/platforms/apple/config` | Apple 开发者 token 与授权状态 |
| POST | `/platforms/apple/authorize` | 保存 MusicKit 用户令牌 |
| DELETE | `/platforms/apple/authorize` | 断开 Apple Music |
| POST | `/platforms/apple/playlists/:id/push` | 写入 Apple Music 资料库 |
| GET | `/health` | 健康检查 |

## 设计

- 来源保留 QQ / 网易云两个方向，目标增加 Apple Music；不展示无关功能。
- Kami 纸张体系：羊皮纸底色、单一墨蓝强调色、衬线正文、发丝线表格。
- 没有阴影、渐变和装饰性色块。

## 验证

- 真实写入：网易云 2 首（隐私歌单）、QQ 音乐 2 首，均回读确认。
- 单元 29 项、Nest e2e 22 项、Playwright UI 5 项通过。
- QQ / 网易云扫码登录、自动匹配、写入、断开账号均已手动走通。
- Apple Music 免费导入已接入 Soundiiz：后端生成临时导入链接，用户只点链接、登录 Apple Music；Playwright 覆盖了链接生成和 TuneMyMusic 备用下载。
- Apple Music 站内直写已按官方 MusicKit API 实现；需要 Apple Developer Program、MusicKit 私钥和有订阅的测试 Apple ID 做真机验收。

## 注意

- QQ / 网易云写入依赖平台非公开接口，可能触发风控或随改版失效。
- Apple Music 免费导入依赖 Soundiiz：免费版单次最多 200 首，链接 24 小时有效；超过 200 首分段。TuneMyMusic 保留为下载文件备用。
- 歌单曲名 / 歌手会发给 Soundiiz 生成临时链接；渡口不保存 Soundiiz 或 Apple 账号。
- Apple Music 站内直写走官方 API，但需要 Apple Developer Program 和用户 Apple Music 订阅；v1 只支持 `cn` 区。
- Apple Music API 没有可依赖的删除资料库歌单端点；渡口的「删除」只删本地记录，目标歌单需到 Apple Music 中手动删除。
- 扫码登录态只存在服务端加密字段中，可随时断开；不要在生产使用默认 `CREDENTIALS_SECRET`。
- 项目未附许可证；演示数据中的曲名、歌手仅用于界面展示。
