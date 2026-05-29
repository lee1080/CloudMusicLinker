const { default: axios } = require('axios');
const createOption = require('NeteaseCloudMusicApi/util/option.js');

const BUCKET = 'jd-musicrep-privatecloud-audio-public';
const CHUNK_THRESHOLD = 20 * 1024 * 1024; // 超过 20MB 走分片
const CHUNK_SIZE = 8 * 1024 * 1024; // 每片 8MB
const UPLOAD_TIMEOUT_MS = 180000; // 单片最长 3 分钟

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
    if (statusText) {
        return status ? `HTTP ${status} ${statusText}` : statusText;
    }
    if (typeof data === 'string') {
        if (data.includes('504')) return 'Gateway Timeout (504)，上传超时';
        return data.replace(/\s+/g, ' ').substring(0, 120);
    }
    if (error?.message) return error.message;
    return status ? `HTTP ${status}` : 'NOS 上传失败';
}

async function postChunk(uploadBase, bucket, objectKey, token, chunk, offset, isLast, fileMd5, log) {
    const complete = isLast ? 'true' : 'false';
    const url = `${uploadBase}/${bucket}/${objectKey}?offset=${offset}&complete=${complete}&version=1.0`;
    const headers = {
        'x-nos-token': token,
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(chunk.length)
    };
    if (isLast) {
        headers['Content-MD5'] = fileMd5;
    }

    await axios({
        method: 'post',
        url,
        headers,
        data: chunk,
        timeout: UPLOAD_TIMEOUT_MS,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: (s) => s >= 200 && s < 300
    });

    if (log) {
        log(`NOS 分片 ${offset}–${offset + chunk.length} / 完成=${isLast}`);
    }
}

/**
 * 上传至网易 NOS（大文件自动分片，避免 504）
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

    try {
        if (fileSize <= CHUNK_THRESHOLD) {
            const logFn = log ? (msg) => log(msg) : null;
            if (logFn) logFn('NOS 单文件上传');
            await postChunk(uploadBase, BUCKET, objectKey, token, songFile.data, 0, true, fileMd5, null);
        } else {
            const logFn = log
                ? (msg) => log(msg)
                : (msg) => console.log(`[Netease] ${msg}`);
            logFn(`NOS 分片上传开始，共 ${fileSize} 字节，每片 ${CHUNK_SIZE / 1024 / 1024}MB`);
            let offset = 0;
            while (offset < fileSize) {
                const end = Math.min(offset + CHUNK_SIZE, fileSize);
                const chunk = songFile.data.slice(offset, end);
                const isLast = end >= fileSize;
                await postChunk(uploadBase, BUCKET, objectKey, token, chunk, offset, isLast, fileMd5, logFn);
                offset = end;
            }
            logFn('NOS 分片上传完成');
        }
    } catch (error) {
        throw new Error(formatNosError(error.response || error));
    }

    return tokenRes;
}

module.exports = {
    uploadSongToNos,
    CHUNK_THRESHOLD,
    CHUNK_SIZE
};
