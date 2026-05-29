const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const coreHandler = require('./services/coreHandler');
const settings = require('./utils/settings');
const envCheck = require('./utils/envCheck');
const qinglongHelper = require('./utils/qinglongHelper');
const neteaseHelper = require('./utils/neteaseHelper');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE Clients
let clients = [];

/**
 * Send SSE event to all connected clients
 * @param {string} message 
 */
function broadcastLog(message) {
    const data = `data: ${JSON.stringify({ message })}\n\n`;
    clients.forEach(client => client.res.write(data));
}

// Routes

// 1. Web Interface (served by static middleware for /)

// 2. SSE Endpoint for logs
app.get('/api/sse', (req, res) => {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);

    const clientId = Date.now();
    const newClient = {
        id: clientId,
        res
    };
    clients.push(newClient);

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
});

// 3. Settings Endpoints
app.get('/api/settings', (req, res) => {
    res.json(settings.getSettings());
});

app.post('/api/settings', (req, res) => {
    try {
        const updated = settings.saveSettings(req.body);
        res.json({ status: 'success', settings: updated });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 青龙面板连接测试接口
app.post('/api/qinglong/test', async (req, res) => {
    try {
        const { qlUrl, qlClientId, qlClientSecret } = req.body;
        const result = await qinglongHelper.testConnection({ qlUrl, qlClientId, qlClientSecret });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// In-memory Task Store
const taskStore = new Map();

function parseJsonObject(value, label) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (e) {
            console.warn(`[API] 无法解析 ${label}:`, e.message);
            return null;
        }
    }
    return null;
}

function isTruthyEnabled(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    }
    return false;
}

function hasCookieValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function buildQinglongConfigFromRequest(qinglongConfig) {
    const parsed = parseJsonObject(qinglongConfig, 'qinglongConfig');
    if (parsed && isTruthyEnabled(parsed.enabled)) {
        return {
            source: 'client',
            qlEnabled: true,
            qlUrl: parsed.url,
            qlClientId: parsed.clientId,
            qlClientSecret: parsed.clientSecret,
            qlBilibiliEnvName: parsed.bilibiliEnvName || 'bilibili_cookie',
            qlDouyinEnvName: parsed.douyinEnvName || 'douyin_cookie',
            qlNeteaseEnvName: parsed.neteaseEnvName || 'netease_cookie'
        };
    }

    const serverSettings = settings.getSettings();
    if (isTruthyEnabled(serverSettings.qlEnabled)) {
        return {
            source: 'server',
            qlEnabled: true,
            qlUrl: serverSettings.qlUrl,
            qlClientId: serverSettings.qlClientId,
            qlClientSecret: serverSettings.qlClientSecret,
            qlBilibiliEnvName: serverSettings.qlBilibiliEnvName || 'bilibili_cookie',
            qlDouyinEnvName: serverSettings.qlDouyinEnvName || 'douyin_cookie',
            qlNeteaseEnvName: serverSettings.qlNeteaseEnvName || 'netease_cookie'
        };
    }

    return null;
}

async function mergeCookiesFromQinglong(cookies, qinglongConfig) {
    const qlConfig = buildQinglongConfigFromRequest(qinglongConfig);
    if (!qlConfig) {
        console.log('[青龙] 未启用（快捷指令未传 enabled 或服务器未配置青龙）');
        return;
    }

    console.log(`[青龙] 使用${qlConfig.source === 'client' ? '快捷指令' : '服务器'}青龙配置`);

    const qlCookies = await qinglongHelper.getCookiesFromQinglong(qlConfig);

    if (qlCookies.bilibiliCookie && !hasCookieValue(cookies.bilibiliCookie)) {
        cookies.bilibiliCookie = qlCookies.bilibiliCookie;
        console.log('[API] 使用青龙面板的 B站 Cookie');
    }
    if (qlCookies.douyinCookie && !hasCookieValue(cookies.douyinCookie)) {
        cookies.douyinCookie = qlCookies.douyinCookie;
        console.log('[API] 使用青龙面板的抖音 Cookie');
    }
    if (qlCookies.neteaseCookie && !hasCookieValue(cookies.neteaseCookie)) {
        cookies.neteaseCookie = qlCookies.neteaseCookie;
        console.log('[API] 使用青龙面板的网易云音乐 Cookie');
    } else if (!qlCookies.neteaseCookie) {
        console.warn('[青龙] 未获取到网易云 Cookie，请检查青龙环境变量 netease_cookie');
    }
}

// Helper to cleanup old tasks (optional, prevents memory leak)
setInterval(() => {
    const now = Date.now();
    for (const [id, task] of taskStore) {
        if (now - task.startTime > 3600000) { // 1 hour expiration
            taskStore.delete(id);
        }
    }
}, 600000); // Check every 10 mins

// 3. API Endpoint for Processing (Web & iOS)
app.post('/api/process', async (req, res) => {
    let { url, cookies, qinglongConfig } = req.body;

    console.log('[API] Received process request');
    console.log('[API] URL:', url ? (url.length > 50 ? url.substring(0, 50) + '...' : url) : 'missing');

    // Robust parsing for cookies
    if (typeof cookies === 'string') {
        try {
            cookies = JSON.parse(cookies);
        } catch (e) {
            console.warn('[API] Failed to parse cookies string:', e.message);
            cookies = {};
        }
    }
    cookies = cookies || {};
    // 快捷指令有时会把 qinglongConfig 嵌在 cookies 字典里
    if (!qinglongConfig && cookies.qinglongConfig) {
        qinglongConfig = cookies.qinglongConfig;
    }

    if (!url) {
        return res.status(400).json({ status: 'error', message: 'Missing URL' });
    }

    try {
        await mergeCookiesFromQinglong(cookies, qinglongConfig);
    } catch (error) {
        console.warn('[API] 从青龙获取 Cookie 失败:', error.message);
    }

    const serverSettings = settings.getSettings();
    if (!hasCookieValue(cookies.neteaseCookie) && hasCookieValue(serverSettings.neteaseCookie)) {
        cookies.neteaseCookie = serverSettings.neteaseCookie;
        console.log('[API] 使用服务器 data/settings.json 中的网易云 Cookie');
    }

    try {
        console.log('[API] 正在校验网易云 Cookie...');
        cookies.neteaseCookie = await neteaseHelper.validateCookie(cookies.neteaseCookie);
        console.log('[API] 网易云 Cookie 校验通过');
    } catch (error) {
        console.warn('[API] 网易云 Cookie 校验失败:', error.message);
        return res.status(400).json({ status: 'error', message: error.message });
    }

    // Generate Task ID
    const taskId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Initialize Task Status
    taskStore.set(taskId, {
        status: 'processing',
        startTime: Date.now(),
        message: 'Task started...',
        result: null
    });

    // Respond immediately with Task ID
    res.json({
        status: 'processing',
        taskId: taskId,
        message: 'Task started background processing'
    });

    // Start background processing
    coreHandler.processLink(url, (msg) => {
        // Update progress log in task store (optional, or just keep broadcasting)
        const task = taskStore.get(taskId);
        if (task) {
            task.message = msg;
        }
        broadcastLog(msg);
    }, cookies)
        .then(result => {
            const task = taskStore.get(taskId);
            if (task) {
                task.status = 'success';
                task.result = result;
                task.message = 'Process completed successfully';
            }
        })
        .catch(error => {
            console.error(`[API] Task ${taskId} failed:`, error.message);
            const task = taskStore.get(taskId);
            if (task) {
                task.status = 'error';
                task.message = error.message;
            }
        });
});

// 4. Task Status Endpoint
app.get('/api/status/:taskId', (req, res) => {
    const { taskId } = req.params;
    const task = taskStore.get(taskId);

    if (!task) {
        return res.status(404).json({ status: 'error', message: 'Task not found' });
    }

    res.json({
        status: task.status,
        message: task.message,
        result: task.result
    });
});

// Start Server
// Start Server
(async () => {
    try {
        const { ytDlpPath, ffmpegPath } = await envCheck.checkDependencies();

        // Update config with detected paths
        config.YTDLP_PATH = ytDlpPath;
        config.FFMPEG_PATH = ffmpegPath;

        app.listen(config.PORT, () => {
            console.log(`Server running at http://localhost:${config.PORT}`);
            console.log(`Using yt-dlp at: ${config.YTDLP_PATH}`);
            console.log(`Using ffmpeg at: ${config.FFMPEG_PATH}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
})();

