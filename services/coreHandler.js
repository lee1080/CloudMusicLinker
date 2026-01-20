const axios = require('axios');
const fs = require('fs');
const config = require('../config');
const mediaHelper = require('../utils/mediaHelper');
const neteaseHelper = require('../utils/neteaseHelper');

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
async function processLink(inputUrl, logCallback, cookies = {}) {
    let downloadedFile = null;
    let convertedFile = null;

    const log = (msg) => {
        console.log(`[Core] ${msg}`);
        if (logCallback) logCallback(msg);
    };

    try {
        // Clean temp dir to prevent mixing up files
        log('正在清理旧的临时文件...');
        try {
            const files = fs.readdirSync(config.TEMP_DIR);
            for (const file of files) {
                if (file !== 'cookies.txt') { // Keep cookies
                    try {
                        fs.unlinkSync(path.join(config.TEMP_DIR, file));
                        // log(`已删除: ${file}`);
                    } catch (err) {
                        console.error(`删除文件失败 ${file}:`, err.message);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to clean temp dir:', e);
        }

        // Reset custom filename for each request
        customFilename = null;

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

            // Custom Douyin Parser
            if (realUrl.includes('douyin.com')) {
                log('尝试使用自定义解析器提取视频地址...');
                const result = await getDouyinVideoUrl(realUrl, cookies.douyinCookie);
                if (result && result.url) {
                    log('自定义解析成功，获取到直链');
                    realUrl = result.url;
                    // Sanitize title for filename
                    if (result.title) {
                        // Take first 30 chars, remove special chars
                        let safeTitle = result.title.replace(/[\\/:*?"<>|]/g, '').substring(0, 50).trim();
                        if (safeTitle) {
                            customFilename = safeTitle;
                            log(`获取到视频标题: ${customFilename}`);
                        }
                    }
                } else {
                    log('自定义解析失败，尝试使用 yt-dlp 默认解析');
                }
            }
        }

        log('开始下载音频...');
        // If it's a direct URL (custom parsed) and we have a name, use it. 
        // Otherwise fallback to timestamp if direct link but no name.
        if (!customFilename && (realUrl.includes('aweme.snssdk.com') || realUrl.includes('douyin.com'))) {
            customFilename = `douyin_${Date.now()}`;
        }

        downloadedFile = await mediaHelper.downloadAudio(realUrl, (percent) => {
            log(`正在下载: ${percent.toFixed(1)}%`);
        }, customFilename, cookies);
        log(`下载完成: ${downloadedFile}`);

        log('正在转码为 MP3...');
        convertedFile = await mediaHelper.convertToMp3(downloadedFile);
        log('转码完成');

        log('正在上传至网易云音乐...');
        const uploadResult = await neteaseHelper.uploadToCloud(convertedFile, cookies.neteaseCookie);

        // Check result
        if (uploadResult.body && (uploadResult.body.code === 200 || uploadResult.body.code === 201)) {
            log('上传成功!');
        } else {
            throw new Error(`上传失败: ${JSON.stringify(uploadResult.body)}`);
        }

        return {
            status: 'success',
            message: '上传完成',
            songName: mediaHelper.getFileName(convertedFile)
        };

    } catch (error) {
        log(`错误: ${error.message}`);
        throw error;
    } finally {
        log('正在清理临时文件...');
        if (downloadedFile && fs.existsSync(downloadedFile)) fs.unlinkSync(downloadedFile);
        if (convertedFile && fs.existsSync(convertedFile)) fs.unlinkSync(convertedFile);
        log('清理完成');
    }
}

module.exports = {
    processLink,
    unshortenUrl
};
