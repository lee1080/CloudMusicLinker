const path = require('path');

module.exports = {
    // Server Port
    PORT: 3000,

    // Netease Cloud Music Cookie
    // IMPORTANT: You must fill this in!
    // How to get: Login to music.163.com in browser, open DevTools (F12) -> Application -> Cookies.
    // Copy the 'MUSIC_U' value or the entire cookie string.
    NETEASE_COOKIE: '',

    // Paths
    DOWNLOAD_DIR: path.join(__dirname, 'downloads'),
    TEMP_DIR: path.join(__dirname, 'temp'),

    // Executable Paths (If not in system PATH, specify absolute paths here)
    // Example: 'C:\\Program Files\\yt-dlp\\yt-dlp.exe'
    YTDLP_PATH: 'bin/yt-dlp', // Relative path for portability (auto-detected on startup)
    FFMPEG_PATH: 'ffmpeg', // Assume in PATH or use relative if bundled

    // Browser for YouTube cookies (to bypass bot detection)
    // Options: 'chrome', 'firefox', 'edge', 'safari', 'brave', 'chromium', 'opera', 'vivaldi'
    // Set to null or empty string to disable
    COOKIES_FROM_BROWSER: '',

    // Enable/Disable YouTube downloads
    // YouTube has strict anti-bot measures that may cause download failures
    // Set to false to skip YouTube and show alternative download instructions
    ENABLE_YOUTUBE: false

    // Proxy (Optional)
    // Example: 'http://127.0.0.1:7890' or 'socks5://user:pass@host:port'
    // PROXY: ''
};
