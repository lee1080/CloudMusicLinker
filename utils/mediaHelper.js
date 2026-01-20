const { spawn, exec } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const settings = require('./settings');

// Ensure directories exist
if (!fs.existsSync(config.DOWNLOAD_DIR)) fs.mkdirSync(config.DOWNLOAD_DIR, { recursive: true });
if (!fs.existsSync(config.TEMP_DIR)) fs.mkdirSync(config.TEMP_DIR, { recursive: true });

// Set ffmpeg path if configured
// Moved to convertToMp3 to allow dynamic configuration


function getCookieForUrl(url, cookies = {}) {
    if (url.includes('douyin.com')) return cookies.douyinCookie;
    if (url.includes('bilibili.com')) return cookies.bilibiliCookie;
    if (url.includes('tiktok.com')) return cookies.tiktokCookie;
    if (url.includes('youtube.com') || url.includes('youtu.be')) return cookies.youtubeCookie;
    return null;
}

function applyCookieToArgs(args, cookie) {
    if (!cookie || !cookie.trim()) return;

    const trimmed = cookie.trim();

    // Check if it's Netscape format (contains tabs)
    // Or if it starts with # Netscape
    if (trimmed.includes('\t') || trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie')) {
        const cookiePath = path.join(config.TEMP_DIR, `cookie_${Date.now()}.txt`);

        // Sanitize: Ensure tabs are used as separators for Netscape format
        // Replace sequences of spaces with a single tab, but only if it looks like a Netscape line (7 fields)
        // Actually, a safer heuristic is: if it starts with # Netscape, ensure lines are tab-separated.
        let content = trimmed;
        if (content.startsWith('# Netscape') || content.startsWith('# HTTP Cookie')) {
            content = content.split('\n').map(line => {
                if (line.trim().startsWith('#') || !line.trim()) return line;
                // If line has no tabs but has spaces, try to fix it
                if (!line.includes('\t') && line.includes(' ')) {
                    // Netscape format usually has 7 fields. 
                    // Domain Flag Path Secure Expiration Name Value
                    // But Value can contain spaces. 
                    // Let's try to replace the first 6 spaces with tabs.
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 7) {
                        // Reconstruct the first 6 fields with tabs
                        const domain = parts[0];
                        const flag = parts[1];
                        const path = parts[2];
                        const secure = parts[3];
                        const expiration = parts[4];
                        const name = parts[5];
                        // The rest is the value, which might contain spaces
                        const value = parts.slice(6).join(' ');
                        return `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`;
                    }
                }
                return line;
            }).join('\n');
        }

        fs.writeFileSync(cookiePath, content, 'utf8');
        console.log('[MediaHelper] Created temp cookie file:', cookiePath); // Debug
        args.push('--cookies', path.relative(process.cwd(), cookiePath));
    } else {
        // Assume Header format (key=value;)
        // yt-dlp supports --add-header "Cookie: ..."
        // But for some sites (like Douyin), passing it as a header is safer/easier than converting to Netscape
        args.push('--add-header', `Cookie:${trimmed}`);
    }
}

/**
 * Download audio from URL using yt-dlp
 * @param {string} url 
 * @param {function} onProgress (percent) => void
 * @param {string} [customFilename] Optional custom filename (without extension)
 * @returns {Promise<string>} Path to downloaded file
 */
function downloadAudio(url, onProgress, customFilename, cookies = {}) {
    return new Promise((resolve, reject) => {
        const absoluteOutputTemplate = path.join(config.TEMP_DIR, customFilename ? `${customFilename}.%(ext)s` : '%(title)s.%(ext)s');
        // Use relative path to avoid encoding issues
        const outputTemplate = path.relative(process.cwd(), absoluteOutputTemplate);

        // Construct args for exec
        // We need to quote paths
        const args = [
            '-f', 'bestaudio/best',
            '-o', `"${outputTemplate}"`,
            '--no-playlist',
            '--force-overwrites',
            '--ignore-errors',  // Continue on download errors
            '--verbose',
            '--user-agent', '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"'
        ];

        // Add proxy if configured
        if (config.PROXY) {
            args.push('--proxy', `"${config.PROXY}"`);
        }

        // Add specific headers for Bilibili to avoid 412
        if (url.includes('bilibili.com')) {
            args.push('--add-header', '"Referer: https://www.bilibili.com/"');
        }

        // Special handling for YouTube - use default behavior with format fallback
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            // For YouTube, use default extractor without forcing specific client
            // This allows yt-dlp to choose the best available method
            console.log('[MediaHelper] Using YouTube default extractor (auto-select best client)');
        } else {
            // For non-YouTube sites, use cookie files or headers as before
            const cookie = getCookieForUrl(url, cookies);
            console.log('[MediaHelper] Cookie found for URL:', !!cookie); // Debug

            if (cookie && cookie.trim()) {
                const trimmed = cookie.trim();
                // Check if it's Netscape format (contains tabs)
                // Or if it starts with # Netscape
                if (trimmed.includes('\t') || trimmed.startsWith('# Netscape') || trimmed.startsWith('# HTTP Cookie')) {
                    const cookiePath = path.join(config.TEMP_DIR, `cookie_${Date.now()}.txt`);

                    // Sanitize: Ensure tabs are used as separators for Netscape format
                    // ... (keep sanitization logic) ...
                    let content = trimmed;
                    if (content.startsWith('# Netscape') || content.startsWith('# HTTP Cookie')) {
                        content = content.split('\n').map(line => {
                            if (line.trim().startsWith('#') || !line.trim()) return line;
                            if (!line.includes('\t') && line.includes(' ')) {
                                const parts = line.trim().split(/\s+/);
                                if (parts.length >= 7) {
                                    const domain = parts[0];
                                    const flag = parts[1];
                                    const path = parts[2];
                                    const secure = parts[3];
                                    const expiration = parts[4];
                                    const name = parts[5];
                                    const value = parts.slice(6).join(' ');
                                    return `${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`;
                                }
                            }
                            return line;
                        }).join('\n');
                    }

                    fs.writeFileSync(cookiePath, content, 'utf8');
                    console.log('[MediaHelper] Created temp cookie file:', cookiePath); // Debug
                    args.push('--cookies', `"${path.relative(process.cwd(), cookiePath)}"`);
                } else {
                    // Header format
                    args.push('--add-header', `"Cookie:${trimmed}"`);
                }
            }
        }

        args.push(`"${url}"`);

        const command = `"${config.YTDLP_PATH}" ${args.join(' ')}`;
        console.log('[MediaHelper] Executing command:', command); // Debug

        // Use exec instead of spawn to avoid environment issues on Windows
        // Increase maxBuffer to 10MB to avoid truncation
        // Rename process to childProcess to avoid shadowing global process
        const childProcess = exec(command, { maxBuffer: 1024 * 1024 * 10 });

        let downloadedFile = null;
        let stderrOutput = '';
        let stdoutOutput = '';

        childProcess.stdout.on('data', (data) => {
            const str = data.toString();
            stdoutOutput += str;
            console.log('[yt-dlp]', str.trim());

            // Try to parse progress
            const match = str.match(/(\d+\.\d+)%/);
            if (match && onProgress) {
                onProgress(parseFloat(match[1]));
            }

            // Try to capture filename
            // [download] Destination: ...
            const destMatch = str.match(/Destination:\s+(.+)$/);
            if (destMatch) {
                const file = destMatch[1];
                if (!file.match(/\.(jpg|jpeg|png|webp|json)$/i)) {
                    downloadedFile = file;
                }
            }
            // [download] ... has already been downloaded
            // Fix: handle [download] prefix
            const alreadyMatch = str.match(/\[download\]\s+(.+)\s+has already been downloaded/);
            if (alreadyMatch) {
                const file = alreadyMatch[1];
                if (!file.match(/\.(jpg|jpeg|png|webp|json)$/i)) {
                    downloadedFile = file;
                }
            } else {
                // Try without [download] prefix just in case
                const alreadyMatch2 = str.match(/(.+) has already been downloaded/);
                if (alreadyMatch2 && !alreadyMatch2[1].startsWith('[download]')) {
                    const file = alreadyMatch2[1];
                    if (!file.match(/\.(jpg|jpeg|png|webp|json)$/i)) {
                        downloadedFile = file;
                    }
                }
            }

            // [Merger] Merging formats into "..."
            const mergeMatch = str.match(/Merging formats into "(.+)"/);
            if (mergeMatch) {
                downloadedFile = mergeMatch[1];
            }
        });

        childProcess.stderr.on('data', (data) => {
            const str = data.toString();
            stderrOutput += str;
            console.error('[yt-dlp error]', str);
        });

        childProcess.on('close', (code) => {
            // Always write logs for debugging
            fs.writeFileSync(path.join(config.TEMP_DIR, 'last_yt_dlp_stdout.log'), stdoutOutput);
            fs.writeFileSync(path.join(config.TEMP_DIR, 'last_yt_dlp_stderr.log'), stderrOutput);
            console.log('[yt-dlp] Exited with code', code);

            if (code === 0) {
                if (downloadedFile) {
                    resolve(downloadedFile);
                } else {
                    // Fallback: Find the most recently created file in TEMP_DIR
                    try {
                        const files = fs.readdirSync(config.TEMP_DIR)
                            .filter(file => !file.match(/\.(jpg|jpeg|png|webp|txt|log|json)$/i)) // Exclude images and logs
                            .map(file => ({ file, mtime: fs.statSync(path.join(config.TEMP_DIR, file)).mtime }))
                            .sort((a, b) => b.mtime - a.mtime);

                        if (files.length > 0) {
                            const latestFile = path.join(config.TEMP_DIR, files[0].file);
                            console.log('[yt-dlp] Warning: Could not parse filename from stdout, using latest file:', latestFile);
                            resolve(latestFile);
                        } else {
                            reject(new Error('Download finished successfully but no file was found.'));
                        }
                    } catch (e) {
                        reject(new Error('Download finished successfully but failed to find downloaded file: ' + e.message));
                    }
                }
            } else {
                reject(new Error(`yt-dlp exited with code ${code}. Error: ${stderrOutput}`));
            }
        });
    });
}

/**
 * Convert media file to MP3 using fluent-ffmpeg
 * @param {string} inputPath 
 * @returns {Promise<string>} Path to converted MP3 file
 */
function convertToMp3(inputPath) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(config.DOWNLOAD_DIR, path.basename(inputPath, path.extname(inputPath)) + '.mp3');

        if (config.FFMPEG_PATH !== 'ffmpeg') {
            ffmpeg.setFfmpegPath(config.FFMPEG_PATH);
        }

        console.log('[MediaHelper] Converting to MP3:', inputPath, '->', outputPath);

        // 获取文件名作为标题
        const title = path.basename(inputPath, path.extname(inputPath));

        ffmpeg(inputPath)
            .toFormat('mp3')
            .audioCodec('libmp3lame')          // 明确使用 libmp3lame 编码器
            .audioBitrate('192k')              // 设置比特率为 192k
            .audioChannels(2)                  // 双声道
            .audioFrequency(44100)             // 标准采样率 44.1kHz
            // 添加 ID3 元数据标签
            .outputOptions([
                '-id3v2_version', '3',         // 使用 ID3v2.3
                '-metadata', `title=${title}`,
                '-metadata', 'artist=UnknownArtist',
                '-metadata', 'album=UnknownAlbum'
            ])
            .on('start', (commandLine) => {
                console.log('[MediaHelper] ffmpeg command:', commandLine);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log('[MediaHelper] Conversion progress:', progress.percent.toFixed(1) + '%');
                }
            })
            .on('end', () => {
                // 验证文件是否生成且不为空
                if (fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    console.log('[MediaHelper] Conversion complete. File size:', (stats.size / 1024 / 1024).toFixed(2), 'MB');
                    if (stats.size > 0) {
                        resolve(outputPath);
                    } else {
                        reject(new Error('Converted file is empty'));
                    }
                } else {
                    reject(new Error('Converted file does not exist'));
                }
            })
            .on('error', (err) => {
                console.error('[MediaHelper] Conversion error:', err);
                reject(err);
            })
            .save(outputPath);
    });
}

/**
 * Get file metadata (title)
 * Simple implementation: extract from filename
 */
function getFileName(filePath) {
    return path.basename(filePath, path.extname(filePath));
}

module.exports = {
    downloadAudio,
    convertToMp3,
    getFileName
};
