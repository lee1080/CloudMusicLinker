const { default: axios } = require('axios');
const createOption = require('NeteaseCloudMusicApi/util/option.js');

const BUCKET = 'jd-musicrep-privatecloud-audio-public';
const UPLOAD_TIMEOUT_MS = 600000; // 单次上传最长 10 分钟

function getExt(filename) {
    if (filename.includes('.')) {
        return filename.split('.').pop();
    }
    return 'mp3';
}

function sanitizeFilename(filename) {
    const ext = getExt(filename);
    return filename
        .replace('.' + ext, '')
        .replace(/\s/g, '')
        .replace(/\./g, '_');
}

function formatNosError(error) {
    const status = error?.status || error?.statusCode || error?.response?.status;
    const statusText = error?.statusText || error?.response?.statusText;
    const data = error?.data ?? error?.response?.data;
    const parts = [];
    if (statusText) {
        parts.push(status ? `HTTP ${status} ${statusText}` : statusText);
    } else if (status) {
        parts.push(`HTTP ${status}`);
    }
    if (typeof data === 'string' && data.trim()) {
        parts.push(data.replace(/\s+/g, ' ').substring(0, 200));
    } else if (data && typeof data === 'object') {
        parts.push(JSON.stringify(data).substring(0, 200));
    }
    if (parts.length) return parts.join(' — ');
    if (error?.message) return error.message;
    return 'NOS 上传失败';
}

/**
 * 上传至网易 NOS（单次 POST，与 NeteaseCloudMusicApi songUpload 一致）
 */
async function uploadSongToNos(query, request, log) {
    const songFile = query.songFile;
    const ext = getExt(songFile.name);
    const filename = sanitizeFilename(songFile.name);

    const tokenRes = await request(
        '/api/nos/token/alloc',
        {
            bucket: BUCKET,
            ext,
            filename,
            local: false,
            nos_product: 3,
            type: 'audio',
            md5: songFile.md5
        },
        createOption(query, 'weapi')
    );

    const token = tokenRes.body?.result?.token;
    const objectKey = tokenRes.body?.result?.objectKey?.replace('/', '%2F');
    if (!token || !objectKey) {
        throw new Error('NOS token 分配失败');
    }

    const lbs = (
        await axios({
            method: 'get',
            url: `https://wanproxy.127.net/lbs?version=1.0&bucketname=${BUCKET}`,
            timeout: 30000
        })
    ).data;

    const uploadBase = lbs.upload[0].replace(/\/$/, '');
    const fileSize = songFile.size;
    const fileMd5 = songFile.md5;
    const logFn = log ? (msg) => log(msg) : null;

    if (logFn) {
        logFn(`NOS 单次上传 ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
    }

    try {
        await axios({
            method: 'post',
            url: `${uploadBase}/${BUCKET}/${objectKey}?offset=0&complete=true&version=1.0`,
            headers: {
                'x-nos-token': token,
                'Content-MD5': fileMd5,
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(fileSize)
            },
            data: songFile.data,
            timeout: UPLOAD_TIMEOUT_MS,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            validateStatus: (s) => s >= 200 && s < 300
        });
        if (logFn) logFn('NOS 上传完成');
    } catch (error) {
        throw new Error(formatNosError(error.response || error));
    }

    return tokenRes;
}

module.exports = { uploadSongToNos };
