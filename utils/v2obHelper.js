const axios = require('axios');
const v2obCrypto = require('./v2obCrypto');

const BASE_URL = 'https://www.v2ob.com';
const API_URL = `${BASE_URL}/api?url=`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

const v2obHttp = axios.create({
    proxy: false,
    timeout: 30000
});

function getBrowserHeaders(authorization) {
    return {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/douyin`,
        'Authorization': authorization,
        'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty'
    };
}

function extractDouyinUrl(inputText) {
    const text = String(inputText || '').trim();
    const match = text.match(/https?:\/\/(?:v\.douyin\.com\/[^\s]+|www\.douyin\.com\/[^\s]+|douyin\.com\/[^\s]+)/i);
    if (!match) return '';
    return match[0].replace(/[，。！？,.!?]+$/g, '');
}

function isRateLimitMessage(message) {
    const msg = String(message || '');
    return msg.includes('等待') && msg.includes('秒');
}

function isLikelyMediaUrl(candidate) {
    if (!candidate || typeof candidate !== 'string') return false;
    if (!/^https?:\/\//i.test(candidate)) return false;
    try {
        const host = new URL(candidate).hostname.toLowerCase();
        if (host.includes('v2ob.com')) return false;
    } catch (e) {
        return false;
    }
    const lower = candidate.toLowerCase();
    return (
        lower.includes('.mp4') ||
        lower.includes('.m3u8') ||
        lower.includes('365yg.com') ||
        lower.includes('aweme') ||
        lower.includes('snssdk') ||
        lower.includes('douyin') ||
        lower.includes('bytecdn') ||
        lower.includes('bytevcloudcdn')
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseV2ob(douyinUrl, log, retryOnRateLimit = true) {
    const { authorization } = v2obCrypto.buildAuthorizationHeader();
    const endpoint = `${API_URL}${encodeURIComponent(douyinUrl)}`;

    const response = await v2obHttp.post(endpoint, null, {
        headers: getBrowserHeaders(authorization),
        validateStatus: () => true
    });

    const result = response.data || {};
    if (result.code !== 200) {
        if (retryOnRateLimit && isRateLimitMessage(result.msg)) {
            log('V2OB 触发频率限制，6 秒后重试...');
            await sleep(6000);
            return parseV2ob(douyinUrl, log, false);
        }
        throw new Error(result.msg || `V2OB 解析失败（HTTP ${response.status}）`);
    }

    const data = result.data || {};
    const videoUrl = data.url;
    if (!videoUrl || !isLikelyMediaUrl(videoUrl)) {
        throw new Error('V2OB 未返回有效视频直链');
    }

    log('V2OB 解析成功，已获取无水印视频直链');
    return {
        url: videoUrl,
        title: (data.title || '').trim()
    };
}

/**
 * Parse Douyin via V2OB (douyin2.txt: POST /api?url= + Authorization HMAC).
 */
async function getDouyinVideoUrlByV2ob(inputText, log) {
    try {
        const douyinUrl = extractDouyinUrl(inputText);
        if (!douyinUrl || !/^https?:\/\//i.test(douyinUrl)) {
            throw new Error('未找到有效的抖音链接');
        }
        log(`V2OB 请求链接: ${douyinUrl}`);
        return await parseV2ob(douyinUrl, log);
    } catch (error) {
        log(`V2OB 解析失败: ${error.message}`);
        return null;
    }
}

module.exports = {
    getDouyinVideoUrlByV2ob,
    isLikelyMediaUrl,
    extractDouyinUrl
};
