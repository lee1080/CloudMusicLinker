const { cloud } = require('NeteaseCloudMusicApi');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const settings = require('./settings');

/**
 * Upload file to Netease Cloud Music
 * @param {string} filePath Absolute path to the file
 * @returns {Promise<Object>} Result of the upload
 */
async function uploadToCloud(filePath, cookie) {
    // Fallback to config.NETEASE_COOKIE if not in settings (migration path)
    const effectiveCookie = cookie || config.NETEASE_COOKIE;

    if (!effectiveCookie) {
        throw new Error('Netease Cookie is not configured!');
    }

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

        return result;
    } catch (error) {
        console.error('Upload failed:', error);
        throw error;
    }
}

module.exports = {
    uploadToCloud
};
