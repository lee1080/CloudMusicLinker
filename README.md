# CloudMusicLinker (提取音频至网易云)

这是一个全栈 Web 服务，旨在作为个人媒体中心。它允许用户通过 Web 界面或 iOS 快捷指令提交社交媒体链接（如 Bilibili、YouTube、抖音、TikTok 等），服务会自动下载音频，转换为 MP3，并上传到用户的网易云音乐云盘。

## 功能特性

- **多平台支持**：基于 `yt-dlp`，支持下载几乎所有主流视频/音频平台的资源。
- **抖音解析（V2OB）**：抖音链接优先通过 [V2OB](https://www.v2ob.com/douyin) 获取 CDN 直链并直接下载，**无需配置抖音 Cookie**；失败时依次回退到本地页面解析与 `yt-dlp`。
- **Cookie 前置校验**：提交链接后先验证网易云 Cookie 是否有效，无效则立即返回错误，避免浪费解析与下载时间。
- **自动转换**：自动将下载的媒体转换为 MP3 格式。
- **云盘上传**：自动上传至网易云音乐个人云盘，方便在各端收听。
- **自动依赖管理**：启动时自动检测并下载 `yt-dlp` 和 `ffmpeg`，无需手动配置环境（支持 Windows / Linux / macOS）。
- **Web 界面**：提供简洁的网页端，支持实时查看处理日志，并可配置各平台 Cookie。
- **青龙面板集成**：快捷指令或 Web 可传入青龙配置；未传入时回退 `data/settings.json` 中的青龙设置（详见 [iOS_Shortcut_Guide.md](./iOS_Shortcut_Guide.md)）。
- **API 支持**：提供异步查询 API，完美支持 iOS 快捷指令轮询机制，解决超时问题。
- **快捷指令**：https://www.icloud.com/shortcuts/569b4aaa381e4bac8dfee0238195ea6a

## 安装与配置

1. **克隆或下载项目**

   ```bash
   git clone https://github.com/lee1080/CloudMusicLinker.git
   cd cloud-music-linker
   ```

2. **安装依赖**

   ```bash
   npm install
   ```

3. **启动服务**

   ```bash
   npm start
   ```

   *首次运行时，程序会自动检查并下载必要的 `yt-dlp` 和 `ffmpeg` 二进制文件，这可能需要几分钟。*

4. **配置**

   访问 Web 界面 `http://localhost:3000` 的设置页，或直接修改 `config.js` / `data/settings.json`：

   | 配置项 | 说明 |
   |--------|------|
   | `PORT` | 服务端口（默认 `3000`） |
   | `NETEASE_COOKIE` | 网易云 Cookie（也可在 Web 设置或请求体中传入） |
   | `COOKIES_FROM_BROWSER` | 从浏览器读取 Cookie（主要用于 YouTube） |
   | `ENABLE_YOUTUBE` | 是否启用 YouTube 下载（默认 `false`） |

   **各平台 Cookie（Web 设置页 / 快捷指令 `cookies` 字典）**

   - **网易云**：必填（上传云盘），需包含 `MUSIC_U`；提交任务时会先调用登录接口校验
   - **抖音**：选填；V2OB 成功时不需要，仅作本地解析 / `yt-dlp` 回退
   - **B 站 / YouTube / TikTok**：按平台需要选填

5. **Docker 运行**

   ```bash
   docker compose up -d
   ```

   默认映射端口见项目内 `docker-compose.yml`（如 `3010:3000`）。

6. **Docker 构建镜像**

   ```bash
   docker compose -f docker-compose.build.yml build
   docker push lee1080/cloudmusic-linker:latest
   ```

   构建完成后镜像名为 `lee1080/cloudmusic-linker:latest`。

## 使用方法

### 1. Web 界面

浏览器访问 `http://localhost:3000`，输入视频链接或分享文案，点击转换即可。界面会实时显示下载和转码进度。

**抖音建议**：直接粘贴完整分享文案（含 `v.douyin.com` 短链），程序会自动提取链接并调用 V2OB。

### 2. iOS 快捷指令（推荐）

为解决上传时间较长导致的超时，采用 **「任务提交 → 轮询状态」** 机制。

**API 接口**

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/process` | `POST` | 提交任务。Body: `{ "url": "...", "cookies": {...}, "qinglongConfig": {...} }`。Cookie 校验通过后返回 `{ "status": "processing", "taskId": "..." }`；校验失败立即返回 `{ "status": "error", "message": "..." }`（HTTP 400） |
| `/api/status/:taskId` | `GET` | 查询状态，返回 `{ "status": "processing" \| "success" \| "error", "message": "..." }` |

**快捷指令 `qinglongConfig` 字段**：`enabled`（布尔）、`url`、`clientId`、`clientSecret`、`neteaseEnvName`、`bilibiliEnvName`、`douyinEnvName`。

详细配置请参考 [iOS_Shortcut_Guide.md](./iOS_Shortcut_Guide.md)。

## 任务处理流程

```
收到链接
    ↓
合并 Cookie（请求体 / 青龙面板 / data/settings.json）
    ↓
校验网易云 Cookie（login_status）
    ├─ 无效 → 立即返回错误，终止
    └─ 有效 → 继续
    ↓
解析链接（抖音优先 V2OB）
    ↓
下载 → 转 MP3 → 上传云盘
```

## 抖音处理流程

```
分享链接/文案
    ↓
① V2OB 解析（优先，无需抖音 Cookie）
    ↓ 失败
② 本地页面解析（需抖音 Cookie，解析 _ROUTER_DATA）
    ↓ 失败
③ yt-dlp 下载（建议配置抖音 Cookie）
    ↓
提取音频 → 转 MP3 → 上传网易云云盘
```

V2OB 成功后会得到 `365yg.com` 等 CDN 直链，由 `mediaHelper` 直接下载视频再转码，速度通常优于纯 `yt-dlp`。

## 目录结构

```
├── bin/                    # 自动下载的 yt-dlp、ffmpeg
├── data/settings.json      # 服务端设置（含青龙配置）
├── downloads/              # 转换后的 MP3
├── temp/                   # 临时下载文件
├── public/                 # 前端静态资源
├── docker-compose.yml      # Docker 运行
├── docker-compose.build.yml# Docker 构建镜像
├── services/               # 核心业务（coreHandler 等）
└── utils/
    ├── v2obHelper.js       # V2OB 抖音解析
    ├── v2obCrypto.js       # V2OB Authorization 签名
    ├── mediaHelper.js      # 下载与转码（含直链下载）
    ├── neteaseHelper.js    # Cookie 校验与云盘上传
    ├── qinglongHelper.js   # 青龙面板 Cookie
    └── settings.js         # 服务端默认设置
```

## 注意事项

- 请确保服务器网络可以访问目标视频网站及 `www.v2ob.com`。
- 自动下载依赖需要能访问 GitHub 及相关下载源。
- **网易云 Cookie**：快捷指令可通过青龙拉取 `netease_cookie` 环境变量，也可在 `cookies.neteaseCookie` 中直接填写；提交前会校验，无效时不会开始下载。
- **青龙面板**：`clientId` / `clientSecret` 需在青龙「应用设置」中创建；环境变量 `netease_cookie` 必须包含 `MUSIC_U`。
- **V2OB 频率限制**：连续请求可能提示等待若干秒；程序会自动等待约 6 秒后重试一次。建议不要过于频繁提交抖音链接。
- **抖音 Cookie**：V2OB 可用时不必配置；若 V2OB 与本地解析均失败，再配置 Cookie 供 `yt-dlp` 使用。
- **系统代理**：若本机开启了 Charles 等抓包代理（如 `127.0.0.1:8888`），可能影响 `yt-dlp` 访问抖音；V2OB 请求已设置 `proxy: false` 绕过代理。必要时请关闭系统代理或仅在需要时开启。
- **Cookies 安全**：请妥善保管各平台 Cookie，不要泄露。建议仅在受信任的网络环境中使用。

## License

[MIT](https://github.com/lee1080/CloudMusicLinker/blob/master/LICENSE) © [lee1080](https://github.com/lee1080)
