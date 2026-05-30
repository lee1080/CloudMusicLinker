const { login_status, user_cloud } = require('NeteaseCloudMusicApi');
const md5 = require('md5');
const mm = require('music-metadata');
const { uploadSongToNos } = require('./nosCloudUpload');
const createOption = require('NeteaseCloudMusicApi/util/option.js');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const settings = require('./settings');

let requestFn = null;
function getRequest() {
    if (!requestFn) {
        requestFn = require('NeteaseCloudMusicApi/util/request');
    }
    return requestFn;
}

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

function sanitizeCloudFileName(fileName) {
    let name = path.basename(fileName);
    name = name
        .replace(/[#?&=%<>:"|\\]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    if (!/\.mp3$/i.test(name)) {
        name += '.mp3';
    }
    const base = name.replace(/\.mp3$/i, '');
    if (base.length > 80) {
        return `${base.substring(0, 80)}.mp3`;
    }
    return name;
}

function logStep(step, body) {
    const code = body?.code;
    const msg = body?.msg || body?.message || '';
    console.log(`[Netease] ${step}: code=${code ?? '-'} msg=${msg || '-'}`);
    return { step, code, msg };
}

function getCloudBitrate() {
    return '192000';
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPublishSuccess(pubBody) {
    if (!pubBody) return false;
    if (pubBody.code === 200 || pubBody.code === 201) return true;
    if (pubBody.privateCloud) return true;
    return false;
}

function normalizeUploadError(error) {
    if (error instanceof Error && error.message) {
        return error;
    }
    const msg = error?.body?.msg || error?.body?.message;
    if (msg) {
        return new Error(msg);
    }
    if (error?.body?.code) {
        return new Error(`上传失败 (code: ${error.body.code})`);
    }
    return new Error('上传失败，请检查网络后重试');
}

async function publishToCloud(request, query, publishSongId) {
    const payload = { songid: String(publishSongId) };
    const attempts = [
        { label: 'eapi', option: createOption(query) },
        { label: 'weapi', option: createOption({ ...query, crypto: 'weapi' }, 'weapi') }
    ];

    let lastBody = null;
    for (let round = 0; round < 3; round++) {
        if (round > 0) {
            console.log(`[Netease] cloud/pub 第 ${round + 1} 次重试（等待 NOS 处理）...`);
            await sleep(3000);
        }
        for (const attempt of attempts) {
            const pubRes = await request('/api/cloud/pub/v2', payload, attempt.option);
            logStep(`cloud/pub (${attempt.label})`, pubRes.body);
            lastBody = pubRes.body;
            if (isPublishSuccess(pubRes.body)) {
                return pubRes;
            }
        }
    }
    return { body: lastBody || { code: 400 } };
}

/** 在云盘列表中确认文件（MD5 或 songId） */
async function verifySongInUserCloud(cookie, fileMd5, songId) {
    const targetId = songId != null ? String(songId) : null;
    for (let offset = 0; offset < 3000; offset += 200) {
        const res = await user_cloud({ cookie, limit: 200, offset });
        const songs = res.body?.data || [];
        for (const song of songs) {
            if (fileMd5 && song.md5 && String(song.md5).toLowerCase() === fileMd5.toLowerCase()) {
                return true;
            }
            if (targetId) {
                const ids = [song.songId, song.id, song.simpleSong?.id, song.pcId]
                    .filter((v) => v != null)
                    .map(String);
                if (ids.includes(targetId)) return true;
            }
        }
        if (songs.length < 200) break;
    }
    return false;
}

/**
 * 云盘上传（修正 NeteaseCloudMusicApi/cloud.js 中 resourceId 与 NOS 上传不一致的问题）
 */
async function uploadToCloud(filePath, cookie) {
    try {
    const effectiveCookie = resolveNeteaseCookie(cookie);
    const uploadName = sanitizeCloudFileName(path.basename(filePath));
    const fileBuffer = fs.readFileSync(filePath);
    const fileSizeMB = parseFloat((fileBuffer.length / 1024 / 1024).toFixed(1));
    const request = getRequest();

    let ext = 'mp3';
    const latinName = Buffer.from(uploadName, 'utf-8').toString('latin1');
    const query = {
        cookie: effectiveCookie,
        songFile: {
            name: latinName,
            data: fileBuffer,
            type: 'audio/mpeg',
            md5: md5(fileBuffer),
            size: fileBuffer.byteLength
        }
    };

    query.songFile.name = Buffer.from(query.songFile.name, 'latin1').toString('utf-8');
    if (query.songFile.name.includes('.')) {
        ext = query.songFile.name.split('.').pop();
    }

    const filename = query.songFile.name
        .replace('.' + ext, '')
        .replace(/\s/g, '')
        .replace(/\./g, '_');
    const bitrate = getCloudBitrate();

    let artist = '';
    let album = '';
    let songName = '';
    try {
        const metadata = await mm.parseBuffer(query.songFile.data, query.songFile.mimetype);
        const info = metadata.common;
        if (info.title) songName = info.title;
        if (info.album) album = info.album;
        if (info.artist) artist = info.artist;
    } catch (error) {
        console.log('[Netease] metadata parse skipped:', error.message);
    }

    const checkRes = await request(
        '/api/cloud/upload/check',
        {
            bitrate: String(bitrate),
            ext: 'mp3',
            length: query.songFile.size,
            md5: query.songFile.md5,
            songId: '0',
            version: '1'
        },
        createOption(query)
    );
    logStep('upload/check', checkRes.body);
    console.log(`[Netease] upload/check needUpload=${checkRes.body?.needUpload} songId=${checkRes.body?.songId || '-'}`);

    let resourceId;

    if (checkRes.body.needUpload) {
        try {
            const uploadInfo = await uploadSongToNos(query, request, (msg) => console.log(`[Netease] ${msg}`));
            resourceId = uploadInfo.body?.result?.resourceId;
            logStep('nos/upload', { code: resourceId ? 200 : 500, msg: resourceId ? 'NOS 上传完成' : '未获取 resourceId' });
        } catch (error) {
            const errMsg = error?.message || String(error);
            console.error('[Netease] nos/upload failed:', errMsg);
            throw new Error(
                `云盘文件上传失败（约 ${fileSizeMB} MB）。` +
                `若超时(504)请检查到 nosup-*.127.net 的连接。` +
                ` 详情: ${errMsg}`
            );
        }
    } else {
        console.log('[Netease] upload/check: 云盘已有相同文件，跳过 NOS 上传');
        const tokenRes = await request(
            '/api/nos/token/alloc',
            {
                bucket: '',
                ext,
                filename,
                local: false,
                nos_product: 3,
                type: 'audio',
                md5: query.songFile.md5
            },
            createOption(query)
        );
        resourceId = tokenRes.body?.result?.resourceId;
        logStep('nos/token', tokenRes.body);
    }

    if (!resourceId) {
        throw new Error(`云盘上传失败：无法获取 resourceId（文件约 ${fileSizeMB} MB）`);
    }

    const infoRes = await request(
        '/api/upload/cloud/info/v2',
        {
            md5: query.songFile.md5,
            songid: checkRes.body.songId,
            filename: query.songFile.name,
            song: songName || filename,
            album: album || '未知专辑',
            artist: artist || '未知艺术家',
            bitrate: String(bitrate),
            resourceId
        },
        createOption(query)
    );
    logStep('cloud/info', infoRes.body);
    console.log(`[Netease] cloud/info songId=${infoRes.body?.songId || infoRes.body?.songid || '-'}`);

    if (infoRes.body?.code && infoRes.body.code !== 200 && infoRes.body.code !== 201) {
        throw new Error(
            `云盘登记失败 (cloud/info code=${infoRes.body.code})。` +
            `${infoRes.body.msg || infoRes.body.message || ''}`.trim()
        );
    }

    // cloud/info 的 privateCloud 只表示登记成功，必须再调 pub 才会出现在云盘列表
    const publishSongId = infoRes.body?.songId ?? infoRes.body?.songid;
    if (!publishSongId) {
        throw new Error('云盘发布失败：cloud/info 未返回 songId');
    }

    console.log(`[Netease] cloud/pub 发布 songId=${publishSongId}`);
    const pubRes = await publishToCloud(request, query, publishSongId);

    if (isPublishSuccess(pubRes.body)) {
        // pub 响应含 privateCloud 即表示发布成功（网易官方语义）
        if (pubRes.body.privateCloud) {
            console.log('[Netease] cloud/pub 成功 (privateCloud 已返回)');
            return { status: 200, body: pubRes.body };
        }
        const verified = await verifySongInUserCloud(effectiveCookie, query.songFile.md5, publishSongId);
        if (verified) {
            console.log('[Netease] 云盘列表已确认存在该文件');
            return { status: 200, body: pubRes.body };
        }
        // 列表可能有延迟，短轮询后再试
        for (let i = 0; i < 3; i++) {
            console.log(`[Netease] pub 已成功，等待云盘列表同步 (${i + 1}/3)...`);
            await sleep(2000);
            if (await verifySongInUserCloud(effectiveCookie, query.songFile.md5, publishSongId)) {
                console.log('[Netease] 云盘列表已确认存在该文件');
                return { status: 200, body: pubRes.body };
            }
        }
        console.warn('[Netease] pub 已成功但云盘列表暂未同步，视为上传成功');
        return { status: 200, body: pubRes.body };
    }

    const inCloud = await verifySongInUserCloud(effectiveCookie, query.songFile.md5, publishSongId);
    if (inCloud) {
        console.log('[Netease] cloud/pub 未返回成功码，但云盘列表中已存在相同 MD5');
        return { status: 200, body: { code: 200, msg: 'verified in cloud by md5' } };
    }

    console.error('[Netease] cloud/pub 完整响应:', JSON.stringify(pubRes.body));
    const pubMsg = pubRes.body?.msg || pubRes.body?.message;
    let hint = '文件已上传至 NOS 但未能发布到云盘。';
    if (fileSizeMB > 95) {
        hint += ` 当前约 ${fileSizeMB}MB，超长音频可能导致 pub 失败，可尝试更短的视频。`;
    }
    throw new Error(
        `云盘发布失败 (cloud/pub code=${pubRes.body?.code ?? 'unknown'})。${pubMsg ? ` ${pubMsg}` : ''} ${hint}`
    );
    } catch (error) {
        console.error('Upload failed:', error);
        throw normalizeUploadError(error);
    }
}

async function verifyInCloudByMd5(filePath, cookie) {
    const effectiveCookie = resolveNeteaseCookie(cookie);
    const fileBuffer = fs.readFileSync(filePath);
    const fileMd5 = md5(fileBuffer);
    return verifySongInUserCloud(effectiveCookie, fileMd5);
}

module.exports = {
    uploadToCloud,
    validateCookie,
    resolveNeteaseCookie,
    verifyInCloudByMd5
};
