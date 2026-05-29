const { cloud, login_status } = require('NeteaseCloudMusicApi');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const settings = require('./settings');

function resolveNeteaseCookie(cookie) {
    const effectiveCookie = (cookie || settings.getSettings().neteaseCookie || config.NETEASE_COOKIE || '').trim();

    if (!effectiveCookie) {
        throw new Error('网易云 Cookie 未配置！');
    }

    if (!effectiveCookie.includes('MUSIC_U')) {
        throw new Error('网易云 Cookie 缺少 MUSIC_U 字段，请确保已登录并获取完整 Cookie');
    }

    return effectiveCookie;
}

/**
 * 调用网易云接口校验 Cookie 是否有效（登录状态）
 * @param {string} [cookie]
 * @returns {Promise<string>} 有效的 Cookie 字符串
 */
async function validateCookie(cookie) {
    const effectiveCookie = resolveNeteaseCookie(cookie);
    const result = await login_status({ cookie: effectiveCookie });

    if (result.status === 200 && result.body?.data?.account) {
        return effectiveCookie;
    }

    const code = result.body?.code ?? result.body?.data?.code;
    if (code === 301 || code === 302) {
        throw new Error('网易云 Cookie 无效或已过期，请重新获取 Cookie');
    }

    const msg = result.body?.msg || result.body?.message;
    throw new Error(msg || '网易云 Cookie 无效或已过期，请重新获取 Cookie');
}

/**
 * Upload file to Netease Cloud Music
 * @param {string} filePath Absolute path to the file
 * @returns {Promise<Object>} Result of the upload
 */
async function uploadToCloud(filePath, cookie) {
    const effectiveCookie = resolveNeteaseCookie(cookie);

    const fileName = path.basename(filePath);

    // Create a file object compatible with the library's expectation
    // The library usually expects 'files' in the query or body, 
    // but for 'cloud' it handles multipart upload.
    // We need to pass the file path or buffer.
    // Based on common usage of NeteaseCloudMusicApi as a library:

    try {
        const fileBuffer = fs.readFileSync(filePath);

        // NeteaseCloudMusicApi (cloud.js) incorrectly treats the name as latin1 and converts to utf-8.
        // We need to pre-encode it to latin1 so the library converts it back to correct utf-8.
        // Logic: Buffer.from(original, 'utf-8').toString('latin1') -> Library: Buffer.from(input, 'latin1').toString('utf-8') -> original
        const safeName = Buffer.from(fileName, 'utf-8').toString('latin1');

        const result = await cloud({
            songFile: {
                name: safeName,
                data: fileBuffer,
                type: 'audio/mpeg'
            },
            cookie: effectiveCookie
        });

        // 检查返回结果
        if (result.body && (result.body.code === 200 || result.body.code === 201)) {
            return result;
        } else {
            // 上传失败，根据错误码提供有意义的错误消息
            console.error('[ERR]', result);

            const code = result.body?.code;
            let errorMsg = '';

            switch (code) {
                case 400:
                    errorMsg = '网易云 Cookie 无效或已过期，请重新获取 Cookie';
                    break;
                case 409:
                    errorMsg = '音频解析失败，可能是文件格式不支持';
                    break;
                case 501:
                    errorMsg = '网易云服务暂时不可用';
                    break;
                default:
                    errorMsg = result.body?.msg || `上传失败 (code: ${code})`;
            }

            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error('Upload failed:', error);
        // 确保抛出的是 Error 对象
        if (error instanceof Error) {
            throw error;
        } else {
            throw new Error(`上传失败: ${JSON.stringify(error)}`);
        }
    }
}

module.exports = {
    uploadToCloud,
    validateCookie,
    resolveNeteaseCookie
};
