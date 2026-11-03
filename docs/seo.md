# SEO：`/tool/music/`

目标地址：<https://a2a-platform.com/tool/music/>

这里记录渡口的 SEO 实现、上线后要做的提交动作，以及当前方案的边界。

## 一、已实现

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 静态 head | [`apps/web/index.html`](../apps/web/index.html) | 标题、描述、robots、canonical、hreflang、Open Graph、Twitter Card、JSON-LD、no-JS 兜底 |
| 路由级 head | [`apps/web/src/components/Seo.tsx`](../apps/web/src/components/Seo.tsx) | 客户端切换路由时更新 title / description / canonical / OG / JSON-LD，原地更新静态标签，不产生重复 |
| 单一数据源 | [`apps/web/src/lib/seo.ts`](../apps/web/src/lib/seo.ts) | 站点常量、页面标题、FAQ 文案、结构化数据生成 |
| 结构化数据 | 同上 | `Organization`、`WebSite`、`WebPage`、`WebApplication`、`BreadcrumbList`、`FAQPage` |
| 爬虫文件 | [`apps/web/public/`](../apps/web/public/) | `robots.txt`、`sitemap.xml`、`site.webmanifest` |
| 社交分享图 | `apps/web/public/og-image.png` | 1200 × 630 PNG，品牌纸张 + 墨蓝 |
| 图标 | `favicon.svg`、`apple-touch-icon.png`、`icon-192.png`、`icon-512.png` | 浏览器标签、iOS 桌面、PWA |
| 构建校验 | [`apps/web/scripts/check-seo.mjs`](../apps/web/scripts/check-seo.mjs) | `pnpm --filter @dukou/web build` 结束前校验 15 项 SEO 契约 |
| 服务端 | [`docker/nginx/default.conf`](../docker/nginx/default.conf) | HTML 不缓存、哈希资源长缓存、robots / sitemap / manifest 的 MIME 与缓存、gzip |
| 端到端测试 | [`tests/ui/seo.spec.ts`](../tests/ui/seo.spec.ts) | 校验静态 head、结构化数据与可见 FAQ 一致、私有页 noindex、爬虫文件可访问 |

### 路由索引策略

| 路由 | robots | canonical |
| --- | --- | --- |
| `/`（落地页） | `index, follow, max-image-preview:large…` | `https://a2a-platform.com/tool/music/` |
| `/login`、`/register` | `noindex, follow` | 自身 |
| `/app`、`/app/import`、`/app/playlists/:id` | `noindex, follow` | 自身 |
| 未匹配路由（404 页） | `noindex, follow` | 自身 |

登录、注册和迁移后台没有检索价值，还会稀释落地页的主题权重，所以统一 noindex；`robots.txt` 里也 Disallow 了 `/app`。

### 落地页内容

落地页新增了两块可索引内容，FAQ 与 `FAQPage` 结构化数据共用 [`HOME_FAQ`](../apps/web/src/lib/seo.ts) 一份文案：

- **常见问题**：网易云 ↔ QQ 音乐、Apple Music、源歌单是否被改动、是否需要装插件、大歌单、支持平台。
- **关于渡口**：产品是什么、支持哪些平台和导入方式，含一个内部链接。

改 FAQ 时只改 `HOME_FAQ`，页面和 JSON-LD 会一起更新；`index.html` 里的静态 JSON-LD 需要同步（它服务于不执行 JS 的爬虫），`check-seo.mjs` 会校验静态 FAQ 数量。

## 二、上线后要做的提交

域名根目录的 `robots.txt` 属于主站（Caddy），不属于本容器；`/tool/music/robots.txt` 只是给本路由用的说明文件。**搜索引擎读取的是 `https://a2a-platform.com/robots.txt`**，请确认其中有一行：

```text
Sitemap: https://a2a-platform.com/tool/music/sitemap.xml
```

然后：

1. **Google Search Console**：在 `https://a2a-platform.com/` 属性下提交
   `https://a2a-platform.com/tool/music/sitemap.xml`，用「网址检查」抓取 `/tool/music/`，确认“已编入索引”。
2. **Bing Webmaster Tools**：同样提交上面的 sitemap；Bing 会执行 JS，路由级标签可正常读取。
3. **百度搜索资源平台**：提交 sitemap；百度的 JS 渲染不稳定，主要依赖 `index.html` 的静态 head、noscript 内容和外链。落地页的静态标题、描述、FAQ 已直接写进 HTML。
4. **分享卡片调试**：Facebook Sharing Debugger、X Card Validator、Telegram `@WebpageBot` 各抓一次，刷新旧缓存。
5. **可选验证标签**：在 `apps/web/index.html` 的 `<head>` 里加 Google / Bing / 百度站长给出的 `meta` 验证标签，然后重新构建部署。

## 三、本地验收

```bash
# 构建时自动跑 SEO 校验（15 项）
VITE_BASE=/tool/music/ pnpm --filter @dukou/web build

# 只跑校验
pnpm --filter @dukou/web check:seo

# 起生产预览
VITE_BASE=/tool/music/ pnpm --filter @dukou/web preview --port 5174
```

打开 <http://127.0.0.1:5174/tool/music/>，或：

```bash
curl -s http://127.0.0.1:5174/tool/music/ | grep -E "canonical|og:image|seo-structured-data"
curl -sI http://127.0.0.1:5174/tool/music/sitemap.xml
curl -s  http://127.0.0.1:5174/tool/music/robots.txt
```

线上验收：

```bash
curl -s https://a2a-platform.com/tool/music/ | grep -o '<title>[^<]*</title>'
curl -sI https://a2a-platform.com/tool/music/robots.txt
curl -s  https://a2a-platform.com/tool/music/sitemap.xml
curl -sI https://a2a-platform.com/tool/music/og-image.png
```

## 四、结构化数据

静态 `index.html` 和运行时 `Seo.tsx` 都会生成同一套 `@graph`：

- `Organization`：渡口 Dukou、logo
- `WebSite`：站点名、语言、发布者
- `WebPage`：当前路由的标题、描述、主图
- `WebApplication`：仅落地页，包含分类、免费 Offer、功能列表
- `BreadcrumbList`：二级页面（如登录、注册）
- `FAQPage`：落地页 6 条问答，文案与可见内容一致

验证工具：

- <https://search.google.com/test/rich-results>
- <https://validator.schema.org/>
- <https://www.bing.com/webmasters>

Google 从 2023 年起把 FAQ 富媒体结果收窄到政府和医疗类站点，本站的 `FAQPage` 主要用于 Bing / 百度理解页面内容，不保证出现富媒体卡片。

## 五、边界与后续

当前是 **SPA + 静态外壳** 方案：

- Google、Bing 执行 JavaScript，能看到路由级 title / description / canonical / JSON-LD；百度主要看到 `index.html` 的静态内容和 noscript 兜底。
- 公开可索引页面只有落地页，`/login`、`/register`、`/app/*` 都 noindex，所以不需要为每条路由预渲染 HTML。
- SPA 对未知路由返回 HTTP 200 + noindex，而不是真正的 404。若以后公开页面变多，再考虑构建期预渲染（prerender）或 SSR，并为未知路径返回真实 404。

如果以后要把公开页面扩展到多页，优先做构建期预渲染：为 `/`、`/faq` 等公开路由各生成一份带完整 head 的 HTML，再由 nginx `try_files` 命中；现有 `Seo.tsx` 的 head 契约可以直接复用。

## 六、换域名时改哪里

按顺序改这几处，改完跑一次 `pnpm --filter @dukou/web build` 校验：

1. [`apps/web/src/lib/seo.ts`](../apps/web/src/lib/seo.ts) 的 `SITE_URL`
2. [`apps/web/index.html`](../apps/web/index.html) 的 canonical、hreflang、`og:url`、`og:image`、Twitter image、JSON-LD 里的绝对 URL
3. [`apps/web/public/sitemap.xml`](../apps/web/public/sitemap.xml) 的 `<loc>`
4. [`apps/web/public/robots.txt`](../apps/web/public/robots.txt) 的 `Sitemap:` 和 Disallow 前缀
5. 部署侧的 `VITE_BASE`、`WEB_BASE_URL`、Caddy / nginx 的 `/tool/music` 前缀

`check-seo.mjs` 会以 `seo.ts` 里的 `SITE_URL` 为准，把第 1、2 步的不一致拦在构建阶段。

每次明显改动落地页内容，记得更新 [`sitemap.xml`](../apps/web/public/sitemap.xml) 的 `<lastmod>`；改 FAQ 时同步 `index.html` 里的静态 JSON-LD。
