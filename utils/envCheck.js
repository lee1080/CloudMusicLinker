const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const https = require('https');
const os = require('os');
const config = require('../config');

const BIN_DIR = path.join(__dirname, '../bin');

// Ensure bin directory exists
if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, (response) => {
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                // Handle redirects, including relative paths
                const redirectUrl = response.headers.location.startsWith('http')
                    ? response.headers.location
                    : new URL(response.headers.location, url).href;
                downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(destPath);
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
            file.on('error', (err) => {
                fs.unlink(destPath, () => { });
                reject(err);
            });
        });
        request.on('error', (err) => {
            reject(err);
        });
    });
}

async function getYtDlp() {
    const platform = os.platform();
    const isWin = platform === 'win32';
    const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
    const binaryPath = path.join(BIN_DIR, binaryName);

    if (fs.existsSync(binaryPath)) {
        console.log('[EnvCheck] yt-dlp found at:', binaryPath);
        return binaryPath;
    }

    // Check if yt-dlp is in global PATH
    try {
        const checkCmd = isWin ? 'where yt-dlp' : 'which yt-dlp';
        execSync(checkCmd, { stdio: 'ignore' });
        console.log('[EnvCheck] yt-dlp found in global PATH.');
        return 'yt-dlp';
    } catch (e) {
        // Not found in PATH, proceed to download
    }



    console.log('[EnvCheck] yt-dlp not found. Downloading...');

    let url = '';
    if (isWin) {
        url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    } else if (platform === 'darwin') {
        url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
    } else {
        // Linux
        const arch = os.arch();
        if (arch === 'arm64') {
            url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64';
        } else if (arch === 'arm') {
            url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_armv7l';
        } else {
            url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
        }
    }

    try {
        await downloadFile(url, binaryPath);
        if (!isWin) {
            fs.chmodSync(binaryPath, 0o755);
        }
        console.log('[EnvCheck] yt-dlp downloaded successfully.');
        return binaryPath;
    } catch (error) {
        console.error('[EnvCheck] Failed to download yt-dlp:', error);
        throw error;
    }
}

async function getFfmpeg() {
    const platform = os.platform();
    const isWin = platform === 'win32';
    const binaryName = isWin ? 'ffmpeg.exe' : 'ffmpeg';
    const binaryPath = path.join(BIN_DIR, binaryName);

    // Check if ffmpeg is already in BIN_DIR
    if (fs.existsSync(binaryPath)) {
        console.log('[EnvCheck] ffmpeg found at:', binaryPath);
        return binaryPath;
    }

    // Check if ffmpeg is in global PATH
    try {
        execSync(isWin ? 'where ffmpeg' : 'which ffmpeg', { stdio: 'ignore' });
        console.log('[EnvCheck] ffmpeg found in global PATH.');
        return 'ffmpeg'; // Return 'ffmpeg' to let system resolve it
    } catch (e) {
        // Not found in PATH, proceed to download
    }

    console.log('[EnvCheck] ffmpeg not found. Downloading...');

    try {
        if (isWin) {
            const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
            const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';

            console.log(`[EnvCheck] Downloading ffmpeg from ${url}...`);
            await downloadFile(url, zipPath);

            console.log('[EnvCheck] Extracting ffmpeg...');
            // Use PowerShell to extract
            execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${BIN_DIR}' -Force"`);

            // Find the bin folder inside the extracted directory
            // Structure is usually ffmpeg-ver-essentials_build/bin/ffmpeg.exe
            const dirs = fs.readdirSync(BIN_DIR).filter(f => fs.statSync(path.join(BIN_DIR, f)).isDirectory() && f.startsWith('ffmpeg-'));
            if (dirs.length > 0) {
                const extractedBin = path.join(BIN_DIR, dirs[0], 'bin', 'ffmpeg.exe');
                if (fs.existsSync(extractedBin)) {
                    fs.renameSync(extractedBin, binaryPath);
                    // Also try to get ffprobe if possible, but not strictly required for now
                    const extractedProbe = path.join(BIN_DIR, dirs[0], 'bin', 'ffprobe.exe');
                    if (fs.existsSync(extractedProbe)) {
                        fs.renameSync(extractedProbe, path.join(BIN_DIR, 'ffprobe.exe'));
                    }
                }
                // Cleanup
                try {
                    fs.rmSync(path.join(BIN_DIR, dirs[0]), { recursive: true, force: true });
                    fs.unlinkSync(zipPath);
                } catch (cleanupErr) {
                    console.warn('[EnvCheck] Cleanup warning:', cleanupErr.message);
                }
            }
        } else if (platform === 'linux') {
            const arch = os.arch();
            let url = '';
            if (arch === 'x64') {
                url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
            } else if (arch === 'arm64') {
                url = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz';
            } else {
                throw new Error(`Unsupported architecture for auto-download: ${arch}. Please install ffmpeg manually.`);
            }

            const tarPath = path.join(BIN_DIR, 'ffmpeg.tar.xz');
            console.log(`[EnvCheck] Downloading ffmpeg from ${url}...`);
            await downloadFile(url, tarPath);

            console.log('[EnvCheck] Extracting ffmpeg...');
            execSync(`tar -xf '${tarPath}' -C '${BIN_DIR}'`);

            // Find extracted folder
            const dirs = fs.readdirSync(BIN_DIR).filter(f => fs.statSync(path.join(BIN_DIR, f)).isDirectory() && f.startsWith('ffmpeg-'));
            if (dirs.length > 0) {
                const extractedBin = path.join(BIN_DIR, dirs[0], 'ffmpeg');
                if (fs.existsSync(extractedBin)) {
                    fs.renameSync(extractedBin, binaryPath);
                    fs.chmodSync(binaryPath, 0o755);

                    const extractedProbe = path.join(BIN_DIR, dirs[0], 'ffprobe');
                    if (fs.existsSync(extractedProbe)) {
                        fs.renameSync(extractedProbe, path.join(BIN_DIR, 'ffprobe'));
                        fs.chmodSync(path.join(BIN_DIR, 'ffprobe'), 0o755);
                    }
                }
                // Cleanup
                try {
                    fs.rmSync(path.join(BIN_DIR, dirs[0]), { recursive: true, force: true });
                    fs.unlinkSync(tarPath);
                } catch (cleanupErr) {
                    console.warn('[EnvCheck] Cleanup warning:', cleanupErr.message);
                }
            }
        } else if (platform === 'darwin') {
            // macOS
            const arch = os.arch();
            let url = '';
            if (arch === 'x64') {
                // Intel Mac
                url = 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip';
            } else if (arch === 'arm64') {
                // Apple Silicon (M1/M2/M3)
                url = 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip';
            } else {
                throw new Error(`Unsupported architecture for macOS auto-download: ${arch}. Please install ffmpeg manually.`);
            }

            const zipPath = path.join(BIN_DIR, 'ffmpeg.zip');
            console.log(`[EnvCheck] Downloading ffmpeg from ${url}...`);
            await downloadFile(url, zipPath);

            console.log('[EnvCheck] Extracting ffmpeg...');
            // Use 'unzip' command on macOS
            execSync(`unzip -q '${zipPath}' -d '${BIN_DIR}'`);

            // The extracted file should be ffmpeg directly
            if (fs.existsSync(binaryPath)) {
                fs.chmodSync(binaryPath, 0o755);
            }

            // Download ffprobe as well
            try {
                const ffprobeUrl = 'https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip';
                const ffprobeZipPath = path.join(BIN_DIR, 'ffprobe.zip');
                const ffprobePath = path.join(BIN_DIR, 'ffprobe');

                await downloadFile(ffprobeUrl, ffprobeZipPath);
                execSync(`unzip -q '${ffprobeZipPath}' -d '${BIN_DIR}'`);

                if (fs.existsSync(ffprobePath)) {
                    fs.chmodSync(ffprobePath, 0o755);
                }

                // Cleanup ffprobe zip
                try {
                    fs.unlinkSync(ffprobeZipPath);
                } catch (cleanupErr) {
                    console.warn('[EnvCheck] Cleanup warning:', cleanupErr.message);
                }
            } catch (ffprobeErr) {
                console.warn('[EnvCheck] Failed to download ffprobe (optional):', ffprobeErr.message);
            }

            // Cleanup ffmpeg zip
            try {
                fs.unlinkSync(zipPath);
            } catch (cleanupErr) {
                console.warn('[EnvCheck] Cleanup warning:', cleanupErr.message);
            }
        } else {
            throw new Error(`Unsupported platform for auto-download: ${platform}. Please install ffmpeg manually.`);
        }

        console.log('[EnvCheck] ffmpeg setup complete.');
        return binaryPath;
    } catch (error) {
        console.error('[EnvCheck] Failed to setup ffmpeg:', error);
        throw error;
    }
}

async function checkDependencies() {
    console.log('[EnvCheck] Checking dependencies...');
    try {
        const ytDlpPath = await getYtDlp();
        const ffmpegPath = await getFfmpeg();

        // Update config paths dynamically if needed
        // Since config.js is loaded once, we might need to export a setter or just rely on relative paths if they match
        // But better to return these values and let server.js update config or use them.
        return { ytDlpPath, ffmpegPath };
    } catch (error) {
        console.error('[EnvCheck] Dependency check failed:', error);
        process.exit(1);
    }
}

module.exports = {
    checkDependencies
};
