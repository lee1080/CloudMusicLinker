const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_SETTINGS = {
    neteaseCookie: "",
    douyinCookie: "",
    bilibiliCookie: "",
    tiktokCookie: "",
    youtubeCookie: "",
    audioQuality: "best",
    // 青龙面板配置
    qlEnabled: false,           // 是否启用青龙面板获取 Cookie
    qlUrl: "",                  // 青龙面板地址，例如 http://192.168.1.100:5700
    qlClientId: "",             // 青龙面板 Client ID
    qlClientSecret: "",         // 青龙面板 Client Secret
    qlBilibiliEnvName: "bilibili_cookie",  // B站 Cookie 环境变量名
    qlDouyinEnvName: "douyin_cookie",      // 抖音 Cookie 环境变量名
    qlNeteaseEnvName: "netease_cookie"     // 网易云音乐 Cookie 环境变量名
};

function getSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
        }
    } catch (error) {
        console.error('[Settings] Error reading settings:', error);
    }
    return DEFAULT_SETTINGS;
}

function saveSettings(newSettings) {
    try {
        const current = getSettings();
        const updated = { ...current, ...newSettings };
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
        return updated;
    } catch (error) {
        console.error('[Settings] Error saving settings:', error);
        throw error;
    }
}

module.exports = {
    getSettings,
    saveSettings
};
