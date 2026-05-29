/**
 * 青龙面板帮助类
 * 用于从青龙面板的环境变量中获取 Cookie
 */
const axios = require('axios');

let tokenCache = null;
let tokenExpireTime = 0;

/**
 * 获取青龙面板的访问令牌
 * @param {Object} config - 青龙面板配置
 * @returns {Promise<string>} 访问令牌
 */
async function getToken(config) {
    const now = Date.now();

    // 如果缓存的 token 还没过期，直接使用
    if (tokenCache && now < tokenExpireTime) {
        return tokenCache;
    }

    const { qlUrl, qlClientId, qlClientSecret } = config;

    if (!qlUrl || !qlClientId || !qlClientSecret) {
        throw new Error('青龙面板配置不完整');
    }

    const url = `${qlUrl}/open/auth/token?client_id=${qlClientId}&client_secret=${qlClientSecret}`;

    try {
        const response = await axios.get(url, { timeout: 10000 });

        if (response.data && response.data.code === 200) {
            tokenCache = response.data.data.token;
            // Token 有效期为 30 天，但我们设置 29 天后过期以防万一
            tokenExpireTime = now + 29 * 24 * 60 * 60 * 1000;
            return tokenCache;
        } else {
            throw new Error(`获取青龙 Token 失败: ${JSON.stringify(response.data)}`);
        }
    } catch (error) {
        console.error('[青龙] 获取 Token 失败:', error.message);
        throw error;
    }
}

/**
 * 从青龙面板获取环境变量
 * @param {Object} config - 青龙面板配置
 * @param {string} envName - 环境变量名称
 * @returns {Promise<string|null>} 环境变量值，如果不存在返回 null
 */
async function getEnvValue(config, envName) {
    try {
        const token = await getToken(config);
        const url = `${config.qlUrl}/open/envs?searchValue=${encodeURIComponent(envName)}`;

        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            timeout: 10000
        });

        if (response.data && response.data.code === 200) {
            const envs = response.data.data;

            // 查找匹配的环境变量（精确匹配名称且未禁用）
            const env = envs.find(e => e.name === envName && e.status === 0);

            if (env) {
                console.log(`[青龙] 成功获取环境变量: ${envName}`);
                return env.value;
            } else {
                console.log(`[青龙] 未找到环境变量或已禁用: ${envName}`);
                return null;
            }
        } else {
            console.error(`[青龙] 获取环境变量失败: ${JSON.stringify(response.data)}`);
            return null;
        }
    } catch (error) {
        console.error(`[青龙] 获取环境变量 ${envName} 失败:`, error.message);
        return null;
    }
}

/**
 * 从青龙面板获取 Cookie
 * @param {Object} settings - 包含青龙配置的设置对象
 * @returns {Promise<Object>} 包含 bilibiliCookie 和 douyinCookie 的对象
 */
async function getCookiesFromQinglong(settings) {
    const result = {
        bilibiliCookie: null,
        douyinCookie: null,
        neteaseCookie: null
    };

    // 检查青龙面板配置是否完整
    if (!settings.qlUrl || !settings.qlClientId || !settings.qlClientSecret) {
        console.log('[青龙] 配置不完整，跳过从青龙获取 Cookie');
        return result;
    }

    if (!settings.qlEnabled) {
        console.log('[青龙] 青龙面板功能未启用');
        return result;
    }

    const config = {
        qlUrl: settings.qlUrl.replace(/\/$/, ''), // 移除末尾的斜杠
        qlClientId: settings.qlClientId,
        qlClientSecret: settings.qlClientSecret
    };

    console.log('[青龙] 正在从青龙面板获取 Cookie...');

    try {
        // 获取 B站 Cookie（环境变量名: bilibili_cookie）
        if (settings.qlBilibiliEnvName) {
            result.bilibiliCookie = await getEnvValue(config, settings.qlBilibiliEnvName);
        }

        // 获取抖音 Cookie（环境变量名: douyin_cookie）
        if (settings.qlDouyinEnvName) {
            result.douyinCookie = await getEnvValue(config, settings.qlDouyinEnvName);
        }

        // 获取网易云音乐 Cookie（环境变量名: netease_cookie）
        if (settings.qlNeteaseEnvName) {
            result.neteaseCookie = await getEnvValue(config, settings.qlNeteaseEnvName);
        }
    } catch (error) {
        console.error('[青龙] 获取 Cookie 出错:', error.message);
    }

    return result;
}

/**
 * 测试青龙面板连接
 * @param {Object} config - 青龙面板配置
 * @returns {Promise<Object>} 测试结果
 */
async function testConnection(config) {
    try {
        const qlConfig = {
            qlUrl: config.qlUrl.replace(/\/$/, ''),
            qlClientId: config.qlClientId,
            qlClientSecret: config.qlClientSecret
        };

        const token = await getToken(qlConfig);

        return {
            success: true,
            message: '青龙面板连接成功'
        };
    } catch (error) {
        return {
            success: false,
            message: `连接失败: ${error.message}`
        };
    }
}

module.exports = {
    getCookiesFromQinglong,
    getEnvValue,
    testConnection
};
