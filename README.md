# CloudMusicLinker (提取音频至网易云)

这是一个全栈 Web 服务，旨在作为个人媒体中心。它允许用户通过 Web 界面或 iOS 快捷指令提交社交媒体链接（如 Bilibili, YouTube, 抖音, TikTok 等），服务会自动下载音频，转换为 MP3，并上传到用户的网易云音乐云盘。

## 功能特性

- **多平台支持**：基于 `yt-dlp`，支持下载几乎所有主流视频/音频平台的资源。
- **自动转换**：自动将下载的媒体转换为 MP3 格式。
- **云盘上传**：自动上传至网易云音乐个人云盘，方便在各端收听。
- **自动依赖管理**：启动时自动检测并下载 `yt-dlp` 和 `ffmpeg`，无需手动配置环境（支持 Windows/Linux/macOS）。
- **Web 界面**：提供简洁的网页端，支持实时查看处理日志。
- **API 支持**：提供异步查询 API，完美支持 iOS 快捷指令轮询机制，解决超时问题。
- **API 支持**：快捷指令地址：`https://www.icloud.com/shortcuts/569b4aaa381e4bac8dfee0238195ea6a`
## 安装与配置

1.  **克隆或下载项目**
    ```bash
    git clone https://github.com/lee1080/CloudMusicLinker.git
    cd cloud-music-linker
    ```

2.  **安装依赖**
    ```bash
    npm install
    ```

3.  **启动服务**
    ```bash
    npm start
    ```
    *首次运行时，程序会自动检查并下载必要的 `yt-dlp` 和 `ffmpeg` 二进制文件，这可能需要几分钟时间。*

4.  **配置**
    访问 Web 界面 `http://localhost:3000` 的设置页，或直接修改 `config.js`/环境变量来配置：
    - `PORT`: 服务端口 (默认 3000)
    - `NETEASE_COOKIE`: (可选，推荐在请求时动态传入) 网易云音乐 Cookie

4.  **一键docker启动**
    创建`docker-compose.yml`文件
    ```yaml
    version: '3'
    services:
      cloud-musiclinker:
        image: lee1080/cloudmusic-linker:latest
        container_name: cloudmusic-linker
        restart: always
        ports:
          - "3000:3000"
        environment:
          - TZ=Asia/Shanghai
    ```
    执行`docker-compose up -d`启动容器

## 使用方法

### 1. Web 界面
浏览器访问 `http://localhost:3000`。
输入视频链接，点击转换即可。界面会实时显示下载和转码进度。

### 2. iOS 快捷指令 (推荐)
为了解决上传时间较长导致的超时问题，我们采用了 **“任务提交 -> 轮询状态”** 的机制。

**API 接口说明**:
- **提交任务**: `POST /api/process`
  - Body: `{ "url": "...", "cookies": {...} }`
  - Returns: `{ "status": "processing", "taskId": "..." }`
- **查询状态**: `GET /api/status/:taskId`
  - Returns: `{ "status": "processing" | "success" | "error", "message": "..." }`

**详细配置指南**:
请参考项目中的 [iOS_Shortcut_Guide.md](./iOS_Shortcut_Guide.md) 文档，里面有详细的图文步骤教你如何创建一个支持轮询的快捷指令。

## 目录结构

- `bin/`: 存放自动下载的 `yt-dlp` 和 `ffmpeg` 可执行文件。
- `downloads/`: 存放转换后的 MP3 文件。
- `temp/`: 临时下载文件。
- `public/`: 前端静态资源。
- `services/`: 核心业务逻辑。
- `utils/`: 工具函数。

## 注意事项

- 请确保服务器网络可以访问目标视频网站。
- 自动下载依赖功能需要服务器能够访问 GitHub 和相关下载源。
- **Cookies 安全**: 请妥善保管你的网易云 Cookie，不要泄露给他人。建议仅在受信任的局域网环境中使用。

## License

[MIT](https://github.com/lee1080/CloudMusicLinker/blob/master/LICENSE) © [lee1080](https://github.com/lee1080)
