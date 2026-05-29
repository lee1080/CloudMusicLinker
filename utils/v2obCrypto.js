const crypto = require('crypto');

const HMAC_SECRET = 'd2f1e4c8a4b9e7f0d4c8b3a2f4e4d8c2b7a5f4e2d6c1b1a9f8e7d5c5b4a3d2e1';
const MESSAGE_PREFIX = 's4$vF!';
const MESSAGE_MIDDLE = 'www.v2ob.com';
const MESSAGE_SUFFIX = '#7dKq^';

function createAuthorizationToken(timestamp) {
    const hexTs = Number(timestamp).toString(16);
    const message = `${MESSAGE_PREFIX}${hexTs}${MESSAGE_MIDDLE}${MESSAGE_SUFFIX}`;
    return crypto.createHmac('sha256', HMAC_SECRET).update(message).digest('base64');
}

function buildAuthorizationHeader(timestamp = Math.floor(Date.now() / 1000)) {
    const token = createAuthorizationToken(timestamp);
    return {
        timestamp,
        authorization: `timestamp=${timestamp},token=${token}`
    };
}

module.exports = {
    buildAuthorizationHeader,
    createAuthorizationToken
};
