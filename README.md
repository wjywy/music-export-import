# 渡口 · Dukou

> 把歌单，渡到对岸。

渡口只做一件事：**QQ 音乐 ↔ 网易云音乐**的歌单迁移。粘贴一张公开歌单链接，扫码一次，自动匹配并写进账号。

## 功能

- **只支持两个平台**：QQ 音乐、网易云音乐。
- **导入**：粘贴歌单链接或分享口令，读取曲名、歌手、专辑、时长和顺序。
- **扫码写入**：用目标平台 App 扫码一次，渡口自动匹配，在账号里新建一张歌单。
- **自动匹配**：按曲名、歌手、时长综合判断；写入前自动完成，不需要逐首手动指定。
- **可断开**：登录态 AES-256-GCM 加密保存，迁移面板里可以随时断开。

## 怎么用

1. 登录渡口，粘贴一张 QQ 音乐或网易云音乐的歌单链接。
2. 打开这张歌单，点「迁移」，选目标平台。
3. 扫码连接目标平台；确认后渡口自动匹配并写入。
4. 写入完成后可以直接打开目标平台的歌单。

写入使用平台非公开接口，可能受风控或改版影响；失败不会改动你已有的歌单。

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
   └── netease / qq adapters + 扫码写入
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
| `CREDENTIALS_SECRET` | 回退到 `JWT_SECRET` | 加密网易云 / QQ 登录态，生产单独设置 |
| `PORT` | `3000` | API 端口 |
| `WEB_ORIGIN` | `http://localhost:5173` | 允许的跨域来源 |

## 主要接口

所有接口以 `/api` 为前缀；除健康检查外均需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` · `/auth/login` | 注册 / 登录 |
| GET | `/playlists` | 歌单列表 |
| GET | `/playlists/:id` | 歌单详情 |
| DELETE | `/playlists/:id` | 删除歌单 |
| POST | `/imports` | 导入 QQ / 网易云歌单 |
| GET | `/imports/:id` | 导入进度 |
| GET | `/accounts` | QQ / 网易云连接状态 |
| POST | `/accounts/:platform/qr` | 生成扫码二维码 |
| GET | `/accounts/:platform/qr/:key` | 轮询扫码状态 |
| DELETE | `/accounts/:platform` | 断开账号 |
| POST | `/playlists/:id/push` | 自动匹配并写入账号 |
| GET | `/health` | 健康检查 |

## 设计

- 全站只保留两个平台的方向选择、导入和迁移，不展示无关功能。
- Kami 纸张体系：羊皮纸底色、单一墨蓝强调色、衬线正文、发丝线表格。
- 没有阴影、渐变和装饰性色块。

## 验证

- 真实写入：网易云 2 首（隐私歌单）、QQ 音乐 2 首，均回读确认。
- 单元 20 项、Nest e2e 18 项、Playwright UI 4 项通过。
- 扫码登录、自动匹配、写入、断开账号均已手动走通。

## 注意

- 写入依赖平台非公开接口，可能触发风控或随改版失效。
- 扫码登录态只存在服务端加密字段中，可随时断开；不要在生产使用默认 `CREDENTIALS_SECRET`。
- 项目未附许可证；演示数据中的曲名、歌手仅用于界面展示。
