'use strict';
/** Hàm HTTP dùng chung cho trang tra cứu và trang quản trị. */
const fs = require('node:fs');
const path = require('node:path');

const SECURITY_HEADERS = {
    'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
        "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/** Bỏ tiền tố IPv4-mapped (::ffff:192.168.1.5 -> 192.168.1.5). */
function normalizeIp(ip) {
    if (!ip) return 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function clientIp(req, trustProxy) {
    if (trustProxy) {
        const fwd = req.headers['x-forwarded-for'];
        if (fwd) return normalizeIp(String(fwd).split(',')[0].trim());
    }
    return normalizeIp(req.socket.remoteAddress);
}

function sendJson(res, status, body, extraHeaders = {}) {
    res.writeHead(status, {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders
    });
    res.end(JSON.stringify(body));
}

function sendText(res, status, text, extraHeaders = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders });
    res.end(text);
}

/** Đọc toàn bộ body thành Buffer (giới hạn maxBytes). */
function readBodyBuffer(req, maxBytes) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(Object.assign(new Error('too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function readBody(req, maxBytes) {
    return (await readBodyBuffer(req, maxBytes)).toString('utf8');
}

async function readJsonBody(req, maxBytes = 2048) {
    const text = await readBody(req, maxBytes);
    try {
        const v = JSON.parse(text);
        if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Error();
        return v;
    } catch {
        throw Object.assign(new Error('bad json'), { status: 400 });
    }
}

/** Trả file tĩnh trong thư mục rootDir; urlPath là đường dẫn tương đối bên trong. */
function serveStaticFrom(rootDir, urlPath, req, res, extraHeaders = {}) {
    if (urlPath === '' || urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.resolve(rootDir, '.' + (urlPath.startsWith('/') ? urlPath : '/' + urlPath));
    if (!filePath.startsWith(rootDir + path.sep)) return sendText(res, 404, 'Not found');

    fs.readFile(filePath, (err, data) => {
        if (err) return sendText(res, 404, 'Not found');
        res.writeHead(200, {
            ...SECURITY_HEADERS,
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
            ...extraHeaders
        });
        res.end(req.method === 'HEAD' ? undefined : data);
    });
}

function appendLog(file, entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFile(file, line + '\n', (err) => {
        if (err) console.error(`Không ghi được ${path.basename(file)}:`, err.message);
    });
}

module.exports = {
    SECURITY_HEADERS, normalizeIp, clientIp, sendJson, sendText,
    readBody, readBodyBuffer, readJsonBody, serveStaticFrom, appendLog
};
