# CloudMusicLinker (提取音频至网易云)

这是一个全栈 Web 服务，旨在作为个人媒体中心。它允许用户通过 Web 界面或 iOS 快捷指令提交社交媒体链接（如 Bilibili、YouTube、抖音、TikTok 等），服务会自动下载音频，转换为 MP3，并上传到用户的网易云音乐云盘。

## 功能特性

- **多平台支持**：基于 `yt-dlp`，支持下载几乎所有主流视频/音频平台的资源。
- **抖音解析（V2OB）**：抖音链接优先通过 [V2OB](https://www.v2ob.com/douyin) 获取 CDN 直链并直接下载，**无需配置抖音 Cookie**；失败时依次回退到本地页面解析与 `yt-dlp`。
- **Cookie 前置校验**：提交链接后先验证网易云 Cookie 是否有效，无效则立即返回错误，避免浪费解析与下载时间。
- **云盘上传增强**：修正 NOS `resourceId` 与分片上传；大文件（>20MB）自动 8MB 分片，降低 504 超时；`cloud/pub` 发布成功后校验云盘列表 MD5，避免误报成功。
- **调试模式**：`config.js` 中 `DEBUG_MODE: true` 时，按抖音视频 ID 缓存 MP3；相同链接跳过下载/转码直接上传；不同链接自动清理旧 MP3。
- **自动转换**：自动将下载的媒体转换为 MP3 格式（默认 192k）。
- **自动依赖管理**：启动时自动检测并下载 `yt-dlp` 和 `ffmpeg`，无需手动配置环境。
- **Web 界面**：提供简洁的网页端，支持实时查看处理日志，并可配置各平台 Cookie。
- **青龙面板集成**：快捷指令或 Web 可传入青龙配置；未传入时回退 `data/settings.json`（详见 [iOS_Shortcut_Guide.md](./iOS_Shortcut_Guide.md)）。
- **API 支持**：异步任务 + 轮询，适配 iOS 快捷指令。
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

4. **配置**（`config.js` / `data/settings.json`）

   | 配置项 | 说明 |
   |--------|------|
   | `PORT` | 服务端口（默认 `3000`） |
   | `DEBUG_MODE` | 调试模式：`true` 时缓存 MP3、相同视频跳过下载（默认 `true`） |
   | `NETEASE_COOKIE` | 网易云 Cookie（也可在请求体或青龙中传入） |
   | `ENABLE_YOUTUBE` | 是否启用 YouTube 下载（默认 `false`） |

   **各平台 Cookie**

   - **网易云**：必填，需含 `MUSIC_U`；提交前会校验登录状态
   - **抖音**：选填；V2OB 成功时不需要
   - **B 站 / YouTube / TikTok**：按需选填

5. **Docker 运行**

   ```bash
   docker compose up -d
   ```

   端口映射见 `docker-compose.yml`（如 `3010:3000`）。容器需能访问 `wanproxy.127.net`、`nosup-*.127.net`（网易上传节点）。

6. **Docker 构建镜像**

   ```bash
   docker compose -f docker-compose.build.yml build
   docker push lee1080/cloudmusic-linker:latest
   ```

## 使用方法

### Web 界面

访问 `http://localhost:3000`，粘贴视频链接或完整分享文案（抖音建议含 `v.douyin.com` 短链）。

### iOS 快捷指令

采用 **「任务提交 → 轮询状态」** 机制。

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/process` | `POST` | Body: `{ "url", "cookies", "qinglongConfig" }`。Cookie 无效时 HTTP 400 |
| `/api/status/:taskId` | `GET` | 查询任务状态 |

`qinglongConfig` 字段：`enabled`（**布尔**）、`url`、`clientId`、`clientSecret`、`neteaseEnvName` 等。

详见 [iOS_Shortcut_Guide.md](./iOS_Shortcut_Guide.md)。

## 任务处理流程

```
收到链接
    ↓
合并 Cookie（请求体 / 青龙 / data/settings.json）
    ↓
校验网易云 Cookie
    ├─ 无效 → 立即返回
    └─ 有效 → 继续
    ↓
[调试模式] 相同视频 ID → 跳过下载，直接上传缓存 MP3
    ↓
解析链接（抖音优先 V2OB）→ 下载 → 转 MP3
    ↓
NOS 上传（>20MB 自动分片）→ cloud/info → cloud/pub
    ↓
校验云盘列表 MD5 → 成功
```

## 调试模式说明

`DEBUG_MODE: true`（默认开启）时：

| 场景 | 行为 |
|------|------|
| **相同视频**（按 `douyin:视频ID` 识别） | 跳过下载与转码，直接上传 `downloads/` 中已有 MP3 |
| **不同视频** | 删除旧 MP3 与 `data/debug-cache.json`，重新下载 |
| **任务结束** | 清理 `temp/` 中下载的视频；**保留** `downloads/` 中 MP3 |

关闭调试：在 `config.js` 设 `DEBUG_MODE: false`，任务结束后自动删除临时文件。

## 抖音处理流程

```
分享文案
    ↓
① V2OB 解析（优先）
    ↓ 失败
② 本地 _ROUTER_DATA 解析
    ↓ 失败
③ yt-dlp
    ↓
转 MP3 → 上传云盘
```

## 目录结构

```
├── data/
│   ├── settings.json       # 服务端青龙等配置
│   └── debug-cache.json    # 调试模式：视频 ID ↔ MP3 路径
├── downloads/              # 转码后的 MP3（调试模式保留）
├── temp/                   # 临时视频（任务结束清理）
├── docker-compose.yml
├── docker-compose.build.yml
├── services/coreHandler.js
└── utils/
    ├── v2obHelper.js       # V2OB 抖音解析
    ├── v2obCrypto.js
    ├── mediaHelper.js      # 下载与转码
    ├── neteaseHelper.js    # Cookie 校验、云盘上传
    ├── nosCloudUpload.js   # NOS 大文件分片上传
    ├── debugCache.js       # 调试模式链接缓存
    ├── qinglongHelper.js
    └── settings.js
```

## 注意事项

- 服务器需能访问目标视频网站、`www.v2ob.com`、网易上传节点（`*.127.net`）。
- **大文件（约 100MB+）**：上传耗时较长；若出现 `504 Gateway Timeout`，检查上行带宽或换网络环境；2 小时长音频可能因网易 `pub` 限制失败，可尝试更短视频验证。
- **上传成功判定**：终端需出现 `云盘列表已确认`；仅 `cloud/info` 成功不会出现在云盘列表。
- **青龙**：`netease_cookie` 须含 `MUSIC_U`；快捷指令中 `enabled` 须为布尔类型。
- **V2OB**：连续请求可能限频，程序会自动等待约 6 秒后重试。
- **系统代理**：Charles 等代理可能影响 `yt-dlp`；V2OB 已设置 `proxy: false`。
- **Cookies 安全**：勿泄露 Cookie，仅在可信环境使用。

## License

[MIT](https://github.com/lee1080/CloudMusicLinker/blob/master/LICENSE) © [lee1080](https://github.com/lee1080)
