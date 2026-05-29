const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const mediaHelper = require('../utils/mediaHelper');
const neteaseHelper = require('../utils/neteaseHelper');
const v2obHelper = require('../utils/v2obHelper');
const debugCache = require('../utils/debugCache');

let customFilename = null;

/**
 * Unshorten URL by following redirects
 * @param {string} url 
 * @returns {Promise<string>} Real URL
 */
async function unshortenUrl(url) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    };

    try {
        const response = await axios.head(url, {
            maxRedirects: 5,
            validateStatus: (status) => status >= 200 && status < 400,
            headers: headers
        });
        return response.request.res.responseUrl || url;
    } catch (error) {
        // If HEAD fails (some sites block it), try GET with stream to abort early
        try {
            const response = await axios.get(url, {
                maxRedirects: 5,
                responseType: 'stream',
                validateStatus: (status) => status >= 200 && status < 400,
                headers: headers
            });
            response.data.destroy(); // Abort download
            return response.request.res.responseUrl || url;
        } catch (e) {
            return url; // Return original if all else fails
        }
    }
}

/**
 * Custom Douyin Parser
 * Fetches mobile page and extracts video URL from _ROUTER_DATA
 */
async function getDouyinVideoUrl(url, douyinCookie) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Cookie': douyinCookie || ''
    };

    try {
        const response = await axios.get(url, { headers });
        const html = response.data;

        // Match _ROUTER_DATA
        const match = html.match(/window\._ROUTER_DATA\s*=\s*(.+?);?<\/script>/);
        if (match) {
            const data = JSON.parse(match[1]);

            // Try to find videoInfoRes
            const videoInfo = findKey(data, 'videoInfoRes');
            if (videoInfo && videoInfo.item_list && videoInfo.item_list.length > 0) {
                const item = videoInfo.item_list[0];
                const video = item.video;
                if (video && video.play_addr && video.play_addr.url_list && video.play_addr.url_list.length > 0) {
                    // Prefer the last URL as it's often the best quality or most accessible
                    // But usually they are mirrors. Let's take the first one.
                    // Replace playwm with play to try getting no watermark (optional, but good practice)
                    let videoUrl = video.play_addr.url_list[0];
                    videoUrl = videoUrl.replace('playwm', 'play');

                    return {
                        url: videoUrl,
                        title: item.desc || ''
                    };
                }
            }
        }
    } catch (error) {
        console.error('Douyin Parser Error:', error.message);
    }
    return null;
}

function findKey(obj, keyToFind) {
    if (!obj || typeof obj !== 'object') return null;
    if (keyToFind in obj) return obj[keyToFind];

    for (const key in obj) {
        const result = findKey(obj[key], keyToFind);
        if (result) return result;
    }
    return null;
}

/**
 * Process a social media link
 * @param {string} inputUrl 
 * @param {function} logCallback (message) => void
 * @returns {Promise<Object>} Result
 */
function cleanTempDir(log) {
    log('正在清理旧的临时文件...');
    try {
        const files = fs.readdirSync(config.TEMP_DIR);
        for (const file of files) {
            if (file !== 'cookies.txt') {
                try {
                    fs.unlinkSync(path.join(config.TEMP_DIR, file));
                } catch (err) {
                    console.error(`删除文件失败 ${file}:`, err.message);
                }
            }
        }
    } catch (e) {
        console.error('Failed to clean temp dir:', e);
    }
}

async function processLink(inputUrl, logCallback, cookies = {}) {
    let downloadedFile = null;
    let convertedFile = null;
    let skipDownload = false;
    const debugMode = config.DEBUG_MODE === true;

    const log = (msg) => {
        console.log(`[Core] ${msg}`);
        if (logCallback) logCallback(msg);
    };

    try {
        let canonicalKey = null;
        let canonicalPreview = '';

        if (debugMode) {
            log('调试模式已开启');
            const resolved = await debugCache.resolveCanonicalKey(inputUrl, unshortenUrl);
            canonicalKey = resolved.key;
            canonicalPreview = resolved.preview;
            log(`链接标识: ${canonicalPreview}`);

            const cache = debugCache.loadCache();
            const cachedMp3 = debugCache.findCachedMp3ByKey(canonicalKey);

            if (cachedMp3) {
                log('检测到相同视频链接，跳过下载与转码，直接上传已有 MP3');
                log(`使用缓存文件: ${cachedMp3}`);
                convertedFile = cachedMp3;
                skipDownload = true;
            } else if (cache?.canonicalKey && cache.canonicalKey !== canonicalKey) {
                log(`链接已变更 (${cache.canonicalPreview || cache.canonicalKey} → ${canonicalPreview})`);
                log('清理旧 MP3 与 temp，准备重新下载...');
                debugCache.clearCachedMp3();
                cleanTempDir(log);
            } else {
                log('新链接或缓存 MP3 不存在，清理 temp 后开始下载...');
                cleanTempDir(log);
            }
        } else {
            cleanTempDir(log);
        }

        customFilename = null;

        if (skipDownload) {
            log('正在上传至网易云音乐...');
            await neteaseHelper.uploadToCloud(convertedFile, cookies.neteaseCookie);
            const verified = await neteaseHelper.verifyInCloudByMd5(
                convertedFile,
                cookies.neteaseCookie
            );
            if (!verified) {
                throw new Error('上传流程结束，但云盘列表中未找到该文件，请稍后刷新网易云 App 或重试上传');
            }
            log('上传成功! 云盘列表已确认');
            return {
                status: 'success',
                message: '上传完成（调试模式复用 MP3）',
                songName: mediaHelper.getFileName(convertedFile)
            };
        }

        log('正在解析链接...');
        // Simple regex to extract URL from text (e.g. "Check this out https://...")
        const urlMatch = inputUrl.match(/https?:\/\/[^\s]+/);
        const rawUrl = urlMatch ? urlMatch[0] : inputUrl;

        let realUrl = rawUrl;

        // Check if YouTube is disabled
        if ((rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be')) && !config.ENABLE_YOUTUBE) {
            const videoId = rawUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)?.[1];
            throw new Error(
                `YouTube 下载已禁用。\n\n` +
                `由于 YouTube 的反爬虫机制，直接下载可能会失败。\n\n` +
                `建议替代方案：\n` +
                `1. 使用专门的 YouTube 下载工具：\n` +
                `   - yt-dlp 命令行工具（最新版本）\n` +
                `   - 在线下载网站（如 y2mate.com）\n\n` +
                `2. 如果你想启用 YouTube 下载，请在 config.js 中设置：\n` +
                `   ENABLE_YOUTUBE: true\n\n` +
                `3. 确保已安装最新版本的 yt-dlp 和必要的依赖。`
            );
        }

        // Check if it's already a direct media file (mp4, m3u8, mp3)
        if (rawUrl.match(/\.(mp4|mp3|m3u8)(\?|$)/i)) {
            log('检测到直接媒体链接，跳过解析');
            realUrl = rawUrl;
        } else {
            realUrl = await unshortenUrl(rawUrl);
            log(`解析成功: ${realUrl}`);

            if (realUrl.includes('douyin.com')) {
                log('检测到抖音链接，尝试 V2OB 解析...');
                let result = await v2obHelper.getDouyinVideoUrlByV2ob(inputUrl, log);
                if (!result || !result.url) {
                    log('V2OB 解析失败，尝试本地解析器...');
                    result = await getDouyinVideoUrl(realUrl, cookies.douyinCookie);
                }
                if (result && result.url) {
                    log('已获取抖音视频直链');
                    realUrl = result.url;
                    if (result.title) {
                        const safeTitle = result.title.replace(/[\\/:*?"<>|]/g, '').substring(0, 50).trim();
                        if (safeTitle) {
                            customFilename = safeTitle;
                            log(`获取到视频标题: ${customFilename}`);
                        }
                    }
                } else {
                    log('解析失败，将尝试 yt-dlp');
                }
            }
        }

        log('开始下载视频...');
        // If it's a direct URL (custom parsed) and we have a name, use it. 
        // Otherwise fallback to timestamp if direct link but no name.
        if (!customFilename && (realUrl.includes('aweme.snssdk.com') || realUrl.includes('douyin.com'))) {
            customFilename = `douyin_${Date.now()}`;
        }

        if (v2obHelper.isLikelyMediaUrl(realUrl) && !realUrl.includes('douyin.com')) {
            log('检测到第三方媒体直链，直接下载视频文件...');
            downloadedFile = await mediaHelper.downloadDirectMedia(realUrl, (percent) => {
                log(`正在下载: ${percent.toFixed(1)}%`);
            }, customFilename);
        } else {
            downloadedFile = await mediaHelper.downloadAudio(realUrl, (percent) => {
                log(`正在下载: ${percent.toFixed(1)}%`);
            }, customFilename, cookies);
        }
        log(`下载完成: ${downloadedFile}`);

        log('正在转码为 MP3...');
        convertedFile = await mediaHelper.convertToMp3(downloadedFile);
        log('转码完成');

        if (debugMode && convertedFile && canonicalKey) {
            debugCache.saveCache(inputUrl, convertedFile, canonicalKey, canonicalPreview);
            log(`调试模式：已缓存 MP3（上传失败也可复用）→ [${canonicalPreview}]`);
        }

        log('正在上传至网易云音乐...');
        await neteaseHelper.uploadToCloud(convertedFile, cookies.neteaseCookie);

        const verified = await neteaseHelper.verifyInCloudByMd5(
            convertedFile,
            cookies.neteaseCookie
        );
        if (!verified) {
            throw new Error('上传流程结束，但云盘列表中未找到该文件，请稍后刷新网易云 App 或重试上传');
        }

        log('上传成功! 云盘列表已确认');

        return {
            status: 'success',
            message: '上传完成',
            songName: mediaHelper.getFileName(convertedFile)
        };

    } catch (error) {
        const msg = error?.message || String(error);
        log(`错误: ${msg}`);
        throw error instanceof Error ? error : new Error(msg);
    } finally {
        if (debugMode) {
            if (downloadedFile && fs.existsSync(downloadedFile)) {
                try {
                    fs.unlinkSync(downloadedFile);
                    log('调试模式：已清理本次下载的临时视频');
                } catch (err) {
                    console.error('清理下载文件失败:', err.message);
                }
            }
            try {
                const tempFiles = fs.readdirSync(config.TEMP_DIR);
                for (const file of tempFiles) {
                    if (file === 'cookies.txt') continue;
                    fs.unlinkSync(path.join(config.TEMP_DIR, file));
                }
            } catch (e) {
                // ignore
            }
            if (convertedFile && fs.existsSync(convertedFile)) {
                log(`调试模式：保留转码 MP3 → ${convertedFile}`);
            }
        } else {
            log('正在清理临时文件...');
            if (downloadedFile && fs.existsSync(downloadedFile)) fs.unlinkSync(downloadedFile);
            if (convertedFile && fs.existsSync(convertedFile)) fs.unlinkSync(convertedFile);
            log('清理完成');
        }
    }
}

module.exports = {
    processLink,
    unshortenUrl
};
