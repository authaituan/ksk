'use strict';
/**
 * KSK - Máy chủ tra cứu kết quả khám sức khỏe (chạy nội bộ, không cần thư viện ngoài).
 *
 *   GET  /*            -> file tĩnh trong public/
 *   POST /api/lookup   -> { employee_code, dob, pin } => { record } hoặc lỗi chung
 *
 * Cấu hình qua biến môi trường (xem README):
 *   HOST, PORT, TLS_CERT, TLS_KEY, TRUST_PROXY,
 *   MAX_FAILS, LOCK_MINUTES, IP_MAX_REQUESTS, IP_WINDOW_MINUTES
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const db = require('./db');
const { EMPLOYEE_CODE_RE, normalizeDob } = require('./records');

const CONFIG = {
    host: process.env.HOST || '',  // trống = lắng nghe cả IPv4 và IPv6
    port: process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 8080,
    tlsCert: process.env.TLS_CERT || '',
    tlsKey: process.env.TLS_KEY || '',
    trustProxy: process.env.TRUST_PROXY === '1',
    maxFails: Number(process.env.MAX_FAILS) || 5,
    lockMinutes: Number(process.env.LOCK_MINUTES) || 30,
    ipMaxRequests: Number(process.env.IP_MAX_REQUESTS) || 20,
    ipWindowMinutes: Number(process.env.IP_WINDOW_MINUTES) || 15
};

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ACCESS_LOG = path.join(db.DATA_DIR, 'access.log');
const MAX_BODY_BYTES = 2048;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
};

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

/* --------------------------------------------------------------------------
   Tiện ích
   -------------------------------------------------------------------------- */
function clientIp(req) {
    if (CONFIG.trustProxy) {
        const fwd = req.headers['x-forwarded-for'];
        if (fwd) return String(fwd).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
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

/** Ghi log truy cập (không ghi PIN, ngày sinh hay dữ liệu sức khỏe). */
function logAccess(ip, employeeCode, outcome) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ip, employee_code: employeeCode, outcome });
    fs.appendFile(ACCESS_LOG, line + '\n', (err) => {
        if (err) console.error('Không ghi được access.log:', err.message);
    });
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('too large'), { status: 413 }));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { reject(Object.assign(new Error('bad json'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

/* --------------------------------------------------------------------------
   Giới hạn tần suất theo IP (trong bộ nhớ, cửa sổ trượt)
   -------------------------------------------------------------------------- */
const ipHits = new Map();

function ipRateLimited(ip) {
    const now = Date.now();
    const windowMs = CONFIG.ipWindowMinutes * 60_000;
    const hits = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
    hits.push(now);
    ipHits.set(ip, hits);
    return hits.length > CONFIG.ipMaxRequests;
}

setInterval(() => {
    const cutoff = Date.now() - CONFIG.ipWindowMinutes * 60_000;
    for (const [ip, hits] of ipHits) {
        const kept = hits.filter((t) => t > cutoff);
        if (kept.length) ipHits.set(ip, kept); else ipHits.delete(ip);
    }
}, 60_000).unref();

/* --------------------------------------------------------------------------
   API tra cứu
   -------------------------------------------------------------------------- */
const MSG_FAIL = 'Thông tin tra cứu không khớp. Vui lòng kiểm tra lại mã nhân viên, ngày sinh và mã PIN.';

async function handleLookup(req, res) {
    const ip = clientIp(req);

    if (ipRateLimited(ip)) {
        logAccess(ip, null, 'ip_rate_limited');
        return sendJson(res, 429, { message: `Bạn đã tra cứu quá nhiều lần. Vui lòng thử lại sau ${CONFIG.ipWindowMinutes} phút.` });
    }

    let body;
    try {
        body = await readJsonBody(req);
    } catch (err) {
        return sendJson(res, err.status || 400, { message: 'Yêu cầu không hợp lệ.' });
    }

    const code = typeof body.employee_code === 'string' ? body.employee_code.trim().toUpperCase() : '';
    const dob = normalizeDob(typeof body.dob === 'string' ? body.dob : '');
    const pin = typeof body.pin === 'string' ? body.pin.trim() : '';

    if (!EMPLOYEE_CODE_RE.test(code) || !dob || !/^\d{6}$/.test(pin)) {
        logAccess(ip, EMPLOYEE_CODE_RE.test(code) ? code : null, 'invalid_input');
        return sendJson(res, 400, { message: 'Vui lòng nhập đúng định dạng: mã nhân viên, ngày sinh DD/MM/YYYY và PIN 6 số.' });
    }

    const emp = db.getEmployee(code);
    const now = Date.now();

    if (emp && emp.locked_until > now) {
        const minutes = Math.ceil((emp.locked_until - now) / 60_000);
        logAccess(ip, code, 'locked');
        return sendJson(res, 423, { message: `Mã nhân viên này đang bị tạm khóa tra cứu do nhập sai nhiều lần. Vui lòng thử lại sau ${minutes} phút hoặc liên hệ bộ phận Nhân sự.` });
    }

    // Luôn tính scrypt (kể cả khi không có mã) để thời gian phản hồi như nhau.
    const pinOk = await db.verifyPin(pin, emp ? emp.pin_hash : null);
    const ok = Boolean(emp) && pinOk && emp.dob === dob;

    if (!ok) {
        if (emp) {
            const fails = emp.failed_attempts + 1;
            if (fails >= CONFIG.maxFails) {
                db.recordFailure(code, 0, now + CONFIG.lockMinutes * 60_000);
                logAccess(ip, code, 'fail_locked');
            } else {
                db.recordFailure(code, fails, 0);
                logAccess(ip, code, 'fail');
            }
        } else {
            logAccess(ip, code, 'fail_unknown_code');
        }
        return sendJson(res, 401, { message: MSG_FAIL });
    }

    db.clearFailures(code);
    logAccess(ip, code, 'success');
    return sendJson(res, 200, { record: JSON.parse(emp.record_json) });
}

/* --------------------------------------------------------------------------
   File tĩnh (chỉ trong public/)
   -------------------------------------------------------------------------- */
function serveStatic(req, res) {
    let urlPath;
    try {
        urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
        res.writeHead(400, SECURITY_HEADERS);
        return res.end('Bad request');
    }
    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.resolve(PUBLIC_DIR, '.' + urlPath);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(404, SECURITY_HEADERS);
        return res.end('Not found');
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
            return res.end('Not found');
        }
        res.writeHead(200, {
            ...SECURITY_HEADERS,
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        res.end(req.method === 'HEAD' ? undefined : data);
    });
}

/* --------------------------------------------------------------------------
   Router
   -------------------------------------------------------------------------- */
async function handler(req, res) {
    try {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname === '/api/lookup') {
            if (req.method !== 'POST') return sendJson(res, 405, { message: 'Method not allowed' }, { Allow: 'POST' });
            return await handleLookup(req, res);
        }
        if (pathname.startsWith('/api/')) return sendJson(res, 404, { message: 'Not found' });
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' });
            return res.end();
        }
        return serveStatic(req, res);
    } catch (err) {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { message: 'Lỗi máy chủ.' });
    }
}

function start() {
    const useTls = CONFIG.tlsCert && CONFIG.tlsKey;
    const server = useTls
        ? https.createServer({ cert: fs.readFileSync(CONFIG.tlsCert), key: fs.readFileSync(CONFIG.tlsKey) }, handler)
        : http.createServer(handler);

    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`LỖI: cổng ${CONFIG.port} đang bị chương trình khác chiếm. Tắt chương trình đó hoặc đặt PORT khác.`);
        } else {
            console.error('LỖI khởi động máy chủ:', err.message);
        }
        process.exit(1);
    });

    // Không truyền host => Node lắng nghe "::" (cả IPv6 và IPv4). Nhờ vậy nếu
    // có chương trình khác chiếm cổng ở IPv4 hoặc IPv6, máy chủ báo lỗi ngay
    // thay vì âm thầm chạy song song.
    const listenArgs = CONFIG.host ? [CONFIG.port, CONFIG.host] : [CONFIG.port];
    server.listen(...listenArgs, () => {
        const s = db.stats();
        const shownHost = CONFIG.host || 'localhost';
        console.log(`KSK đang chạy tại ${useTls ? 'https' : 'http'}://${shownHost}:${server.address().port}`);
        console.log(`Hồ sơ trong CSDL: ${s.total} (đang khóa: ${s.locked})`);
        if (!useTls) {
            console.warn('CẢNH BÁO: đang chạy HTTP không mã hóa. Khi dùng thật, đặt TLS_CERT và TLS_KEY để bật HTTPS.');
        }
    });
    return server;
}

if (require.main === module) start();

module.exports = { handler, start, CONFIG };
