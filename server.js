const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const coreHandler = require('./services/coreHandler');
const settings = require('./utils/settings');
const envCheck = require('./utils/envCheck');

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

// In-memory Task Store
const taskStore = new Map();

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
app.post('/api/process', (req, res) => {
    let { url, cookies } = req.body;

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

    if (!url) {
        return res.status(400).json({ status: 'error', message: 'Missing URL' });
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

