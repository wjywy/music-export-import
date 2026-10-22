# Apple Music 导入

渡口有两条 Apple Music 导入路径：

- **免费模式（默认）**：点「生成 Apple Music 导入链接」，渡口把歌单发给 Soundiiz 生成临时导入页；用户打开链接、登录 Apple Music 完成导入。不需要 Apple 开发者账号。
- **站内直写（可选）**：配置 Apple 开发者 token 后，在渡口里匹配并一键写进资料库。

QQ 音乐、网易云音乐不提供面向个人开发者的写入 API；Soundiiz 帮我们完成 Apple Music 侧的授权和写入。TuneMyMusic 保留为下载文件备用。

## 一、免费模式：Soundiiz（默认）

用户操作：

1. 打开歌单 →「迁移」→ 目标选 **Apple Music**；
2. 点「生成 Apple Music 导入链接」；
3. 打开生成的 Soundiiz 链接（已预选 Apple Music）；
4. 登录 / 连接自己的 Apple ID；
5. 确认匹配后开始导入，没匹配到的歌会在结果里列出。

限制：

- 一个链接最多 **200 首**；超过 200 首时，渡口会按 200 首一段生成多个链接，逐段打开导入；
- 链接 **24 小时**有效；Soundiiz 公共导入 API 限流 10 次/分钟/IP；
- 用户需要免费 Soundiiz 账号和有效的 Apple Music 订阅；
- 歌单的曲名 / 歌手会发给 Soundiiz 生成临时链接；渡口不保存 Soundiiz 或 Apple 账号；
- 不想走 Soundiiz 时，弹窗里仍保留「下载 TXT / CSV 用 TuneMyMusic 导入」备用（免费版单次 500 首）。

## 二、费用

- 免费模式：不需要 Apple Developer Program；Soundiiz 免费账户每个链接最多 200 首，不限累计次数；超出可分段。TuneMyMusic 备用通道免费版单次 500 首。
- 站内直写：Apple Developer Program 年费 **99 USD**（按地区以当地货币计价）；一个会员覆盖整个站点，不按用户或调用次数收费。
- 无论哪条路，终端用户都需要自己的 Apple Music 订阅；这笔钱付给 Apple，不是付给渡口。
- 非营利组织、认证教育机构、政府机构可以向 Apple 申请[年费豁免](https://developer.apple.com/support/membership-fee-waiver/)。

## 三、站内直写前提（可选）

- Apple Developer Program 会员；
- 在 Apple Developer 后台创建 **MusicKit 标识**与 **.p8 私钥**，记下 Team ID、Key ID；
- 用于验收的 Apple ID 有有效 Apple Music 订阅；
- v1 只支持中国区（`cn`）。其他区账号会在授权时被明确拒绝。

Apple 的创建入口：[Create a media identifier and private key](https://developer.apple.com/help/account/configure-app-capabilities/create-a-media-identifier-and-private-key/)。

## 四、站内直写环境变量

二选一。

### A. 自动签发（推荐）

```dotenv
APPLE_MUSIC_STOREFRONT=cn
APPLE_MUSIC_TEAM_ID=你的TeamID
APPLE_MUSIC_KEY_ID=你的KeyID
APPLE_MUSIC_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIG...\n-----END PRIVATE KEY-----
```

服务端用 ES256 签一个 1 小时有效的开发者 token，缓存后自动续签。`.p8` 里的换行写成 `\n`；也可以把私钥放到服务器文件里，用 `APPLE_MUSIC_PRIVATE_KEY_PATH` 指向它。

这些变量是**部署者一次性配置**，不是让终端用户输入。未配置时，前端显示 Soundiiz 免费导入；配置后才显示站内直写。

### B. 手工 JWT

```dotenv
APPLE_MUSIC_STOREFRONT=cn
APPLE_MUSIC_TOKEN=手工生成的MusicKit JWT
```

开发者 token 最长 6 个月，过期后需要更换；适合临时验证，不适合长期部署。

`CREDENTIALS_SECRET` 用来加密用户的 `musicUserToken`，生产必须固定且不要泄露。

## 五、验收

### 免费模式

1. 启动 API 与 Web，登录渡口；
2. 导入一张 QQ 音乐或网易云音乐歌单；
3. 打开歌单 →「迁移」→ 目标选 Apple Music；
4. 点「生成 Apple Music 导入链接」，确认返回至少一个链接；
5. 打开链接，登录 Apple Music，完成一次小歌单导入；
6. 再展开「备用：下载文件用 TuneMyMusic 导入」，确认 TXT / CSV 可下载。

### 站内直写

1. 确认 `GET /api/platforms/apple/config` 返回 `configured: true` 且有 `developerToken`；
2. 迁移弹窗里点「连接 Apple Music」，完成 Apple 授权；
3. 点「匹配 Apple Music」，看到「已匹配 X / 共 Y」；
4. 点「写入资料库（X 首）」，打开返回的链接确认歌单和曲目。

## 六、行为与限制

- 免费模式一个 Soundiiz 链接最多 200 首；直写单张歌单上限是 500 首；
- 直写匹配按曲名、歌手、时长打分；Apple 额外拒绝时长差超过 15 秒、Live / Remix 版本不一致、歌手不重叠的结果；
- 直写先匹配、后写入；0 首匹配时不会创建歌单；
- 直写创建歌单时带前 100 首，后续每批 100 首；失败批次会退化为逐首重试；
- 同一用户 + 同一歌单有进程内锁，防止双击创建两张歌单；
- 渡口的「删除」只删本地记录；Apple Music API 没有可依赖的「删除资料库歌单」端点，写坏了只能去 Apple Music App 里手动删；
- Apple 曲库分区号，直写 v1 固定 `cn`，不跨区复用匹配结果。

## 七、常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 免费导入后缺歌 | Soundiiz 没匹配到，或地区曲库没有 | 看 Soundiiz 的结果报告，手动补歌 |
| 免费导入只导入了 200 首 | 免费版单链接上限 | 用分段链接逐段导入，或升级 Soundiiz |
| Soundiiz 返回 429 | 公共导入 API 限流 | 等 60 秒重试，或改用 TuneMyMusic 备用 |
| 连接 Soundiiz 失败 | 服务器出口网络不通，或被环境代理拦截 | 确保服务器能直连 `soundiiz.com`；代码用 `node:https` 直连，不走 `HTTPS_PROXY` |
| `configured: false` | 未配置直写 token，或 `.p8` 读不到 | 这是正常的免费模式；要直写再检查 `APPLE_MUSIC_*` |
| 授权返回 401/403 | 用户令牌失效或没有 Apple Music 订阅 | 确认订阅，重新连接 |
| `当前只支持 cn 区...` | Apple ID 不是中国区 | 换 `cn` 区账号，或后续做多区支持 |
| 匹配 0 首 | 曲库没有，或被严格规则拒绝 | 换歌单；后续可加人工纠错 |
| 写入 401 | 开发者 token 或用户 token 在写入中失效 | 重新连接后重试 |
| 限流/超时 | Apple API 429 或网络中断 | 等一会重试；已创建的半张歌单手动补/删 |
