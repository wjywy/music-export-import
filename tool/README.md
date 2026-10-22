# /tool 公共入口

Kami 纸张体系的公共工具目录。纯静态 HTML / CSS / JS，无构建步骤，直接部署在 `/tool/`。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.html` | 入口页：介绍、搜索、工具卡片、页脚 |
| `styles.css` | Kami tokens 与页面样式 |
| `tools.js` | 搜索、分类筛选、`/` 快捷键 |
| `preview-server.mjs` | 本地同时预览 `/tool/` 与 `/tool/music/` |
| `screenshots/` | 桌面 / 移动端验收截图（可删） |

## 本地连渡口预览

三个终端：

```bash
# 1. API（MySQL 需要先启动）
pnpm --filter @dukou/api dev

# 2. 渡口 Web，挂在 /tool/music/ 下
VITE_BASE=/tool/music/ \
VITE_PROXY_TARGET=http://127.0.0.1:3000 \
pnpm --filter @dukou/web dev --host 127.0.0.1 --port 5173 --strictPort

# 3. 工具入口 + /tool/music 代理
node tool/preview-server.mjs
```

打开 <http://127.0.0.1:4173/tool/>，点「打开渡口」会进入 `/tool/music/`，API 请求也会经 Vite 代理到 3000。

演示账号需要先执行一次 `pnpm seed`：`demo@dukou.app` / `demo1234`。

## 部署

`tool/` 已经打进渡口 web 镜像的 `/usr/share/nginx/html/tool/`，不需要单独准备静态目录。部署时重建 web 容器即可：

```bash
cd /home/admin/dukou
git pull --ff-only
sudo docker compose -p dukou -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Caddy / nginx 的反代配置（`/tool/` 工具入口 + `/tool/music/` 渡口）见 [docs/deploy.md](../docs/deploy.md)。核心是：

- `/tool/` 原样转发到 web 容器；
- `/tool/music/` 去掉 `/tool/music` 前缀后再转发；
- 两个 location / handle 都要保留。

## 新增工具

在 `index.html` 的 `.tool-grid` 里复制一张 `.tool-card`：

```html
<a
  class="tool-card"
  href="/tool/xxx/"
  data-category="music"
  data-search="工具名 english 关键词 用途"
>
  <span class="card-top">
    <span class="card-index">02</span>
    <span class="status">可用</span>
  </span>
  <span class="card-mark" aria-hidden="true">字</span>
  <span class="card-title-row">
    <span class="card-title">工具名</span>
    <span class="card-en">English</span>
  </span>
  <span class="card-desc">一句话说明它解决什么问题。</span>
  <span class="card-tags">
    <span>分类</span>
    <span>关键词</span>
  </span>
  <span class="card-foot">打开工具 <span aria-hidden="true">↗</span></span>
</a>
```

如果新增了分类，在 `.filters` 里加一个按钮：

```html
<button class="filter" type="button" data-filter="text" aria-pressed="false">文本</button>
```

工具数量、搜索结果和空状态由 `tools.js` 自动更新；hero 的已上线数量也会同步。

## 设计边界

- 羊皮纸底色、单一墨蓝强调色、衬线正文、发丝线分隔；
- 无阴影、无渐变、无装饰性色块；
- 工具按用途排列，不按热度或推广位；
- 品牌字目前用 `A2A`，如果主站名称不同，改页头和页脚两处即可。
