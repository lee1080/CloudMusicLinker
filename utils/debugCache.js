const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const CACHE_FILE = path.join(__dirname, '../data/debug-cache.json');

function hashText(text) {
    return crypto.createHash('md5').update(text).digest('hex');
}

function extractUrlsFromText(text) {
    const raw = String(text || '').trim();
    const douyin = raw.match(/https?:\/\/(?:v\.douyin\.com\/[^\s，。！？,.!?]+|www\.douyin\.com\/[^\s，。！？,.!?]+|douyin\.com\/[^\s，。！？,.!?]+)/gi);
    if (douyin && douyin.length) {
        return douyin.map((u) => u.replace(/[，。！？,.!?]+$/g, ''));
    }
    const general = raw.match(/https?:\/\/[^\s，。！？,.!?]+/gi);
    return general ? general.map((u) => u.replace(/[，。！？,.!?]+$/g, '')) : [];
}

async function resolveCanonicalKey(inputText, unshortenFn) {
    const text = String(inputText || '').trim();
    const urls = extractUrlsFromText(text);

    if (!urls.length) {
        return { key: `text:${hashText(text)}`, preview: text.substring(0, 80) };
    }

    let url = urls[0];
    if (unshortenFn) {
        try {
            url = await unshortenFn(url);
        } catch (error) {
            console.warn('[DebugCache] 展开短链失败，使用原始 URL:', error.message);
        }
    }

    const douyinId = url.match(/douyin\.com\/video\/(\d+)/i)?.[1];
    if (douyinId) {
        return { key: `douyin:${douyinId}`, preview: `douyin/video/${douyinId}` };
    }

    const bvid = url.match(/bilibili\.com\/video\/(BV[\w]+)/i)?.[1];
    if (bvid) {
        return { key: `bilibili:${bvid}`, preview: bvid };
    }

    const youtubeId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s?]+)/i)?.[1];
    if (youtubeId) {
        return { key: `youtube:${youtubeId}`, preview: youtubeId };
    }

    return { key: `url:${hashText(url)}`, preview: url.substring(0, 80) };
}

function loadCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('[DebugCache] 读取失败:', error.message);
    }
    return null;
}

function saveCache(inputUrl, mp3Path, canonicalKey, canonicalPreview) {
    const payload = {
        canonicalKey,
        canonicalPreview: canonicalPreview || '',
        inputUrl: String(inputUrl || '').trim().substring(0, 500),
        mp3Path,
        updatedAt: new Date().toISOString()
    };
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function clearDirectory(dirPath, keepFiles = []) {
    if (!fs.existsSync(dirPath)) return;
    const keep = new Set(keepFiles);
    for (const file of fs.readdirSync(dirPath)) {
        if (keep.has(file)) continue;
        try {
            fs.unlinkSync(path.join(dirPath, file));
        } catch (error) {
            console.error(`[DebugCache] 删除失败 ${file}:`, error.message);
        }
    }
}

function clearTempDir() {
    clearDirectory(config.TEMP_DIR, ['cookies.txt']);
}

function clearCachedMp3() {
    const cache = loadCache();
    if (cache?.mp3Path && fs.existsSync(cache.mp3Path)) {
        try {
            fs.unlinkSync(cache.mp3Path);
        } catch (error) {
            console.error('[DebugCache] 删除缓存 MP3 失败:', error.message);
        }
    }
    if (fs.existsSync(CACHE_FILE)) {
        try {
            fs.unlinkSync(CACHE_FILE);
        } catch (error) {
            console.error('[DebugCache] 删除 cache 文件失败:', error.message);
        }
    }
}

/** 按已解析的 canonicalKey 查找缓存 MP3（上传失败也会保留记录） */
function findCachedMp3ByKey(canonicalKey) {
    if (!canonicalKey) return null;

    const cache = loadCache();
    if (cache?.canonicalKey === canonicalKey && cache.mp3Path && fs.existsSync(cache.mp3Path)) {
        return cache.mp3Path;
    }

    if (cache?.canonicalKey && cache.canonicalKey !== canonicalKey) {
        return null;
    }

    // 兼容旧版本：转码成功但上传失败时未写入 cache，且 downloads 中仅有一个 mp3
    if (fs.existsSync(config.DOWNLOAD_DIR)) {
        const mp3Files = fs.readdirSync(config.DOWNLOAD_DIR).filter((f) => f.toLowerCase().endsWith('.mp3'));
        if (mp3Files.length === 1) {
            const mp3Path = path.join(config.DOWNLOAD_DIR, mp3Files[0]);
            console.log('[DebugCache] 恢复缓存：复用 downloads 中已有 MP3');
            saveCache(cache?.inputUrl || '', mp3Path, canonicalKey, cache?.canonicalPreview || canonicalKey);
            return mp3Path;
        }
    }

    return null;
}

module.exports = {
    resolveCanonicalKey,
    loadCache,
    saveCache,
    clearTempDir,
    clearCachedMp3,
    findCachedMp3ByKey
};
