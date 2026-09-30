'use strict';
/**
 * KSK - Máy chủ tra cứu kết quả khám sức khỏe (chạy nội bộ, không cần thư viện ngoài).
 *
 *   GET  /*            -> file tĩnh trong public/
 *   POST /api/lookup   -> { employee_code, dob, pin } => { record } hoặc lỗi chung
 *   /admin/...         -> trang quản trị (server/admin.js), chỉ IP được phép
 *
 * Cấu hình qua biến môi trường (xem README):
 *   HOST, PORT, TLS_CERT, TLS_KEY, TRUST_PROXY,
 *   MAX_FAILS, LOCK_MINUTES, IP_MAX_REQUESTS, IP_WINDOW_MINUTES, ADMIN_ALLOWED_IPS, PUBLIC_URL
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const db = require('./db');
const { EMPLOYEE_CODE_RE, normalizeDob } = require('./records');
const { clientIp, sendJson, sendText, readJsonBody, serveStaticFrom, appendLog } = require('./http-util');
const { createAdminHandler } = require('./admin');

const CONFIG = {
    host: process.env.HOST || '',  // trống = lắng nghe cả IPv4 và IPv6
    port: process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 8080,
    tlsCert: process.env.TLS_CERT || '',
    tlsKey: process.env.TLS_KEY || '',
    trustProxy: process.env.TRUST_PROXY === '1',
    maxFails: Number(process.env.MAX_FAILS) || 5,
    lockMinutes: Number(process.env.LOCK_MINUTES) || 30,
    ipMaxRequests: Number(process.env.IP_MAX_REQUESTS) || 20,
    ipWindowMinutes: Number(process.env.IP_WINDOW_MINUTES) || 15,
    adminAllowedIps: process.env.ADMIN_ALLOWED_IPS || '127.0.0.1,::1',
    publicUrl: process.env.PUBLIC_URL || ''  // địa chỉ in trên phiếu PIN, vd http://192.168.1.10:8080/
};

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ACCESS_LOG = path.join(db.DATA_DIR, 'access.log');

const adminHandler = createAdminHandler({
    trustProxy: CONFIG.trustProxy,
    allowedIps: CONFIG.adminAllowedIps,
    secureCookie: Boolean(CONFIG.tlsCert && CONFIG.tlsKey),
    publicUrl: CONFIG.publicUrl
});

/** Ghi log truy cập (không ghi PIN, ngày sinh hay dữ liệu sức khỏe). */
function logAccess(ip, employeeCode, outcome) {
    appendLog(ACCESS_LOG, { ip, employee_code: employeeCode, outcome });
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
    const ip = clientIp(req, CONFIG.trustProxy);

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
   Router
   -------------------------------------------------------------------------- */
async function handler(req, res) {
    try {
        let url;
        try {
            url = new URL(req.url, 'http://localhost');
            decodeURIComponent(url.pathname);
        } catch {
            return sendText(res, 400, 'Bad request');
        }
        const pathname = url.pathname;

        if (await adminHandler(req, res, url)) return;

        if (pathname === '/api/lookup') {
            if (req.method !== 'POST') return sendJson(res, 405, { message: 'Method not allowed' }, { Allow: 'POST' });
            return await handleLookup(req, res);
        }
        if (pathname.startsWith('/api/')) return sendJson(res, 404, { message: 'Not found' });
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
        return serveStaticFrom(PUBLIC_DIR, decodeURIComponent(pathname), req, res);
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
    server.requestTimeout = 60_000; // đủ cho import file CSV lớn

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
        console.log(`Hồ sơ trong CSDL: ${s.total} (chưa có PIN: ${s.without_pin}, đang khóa: ${s.locked})`);
        console.log(`Trang quản trị: /admin/ (chỉ mở cho: ${CONFIG.adminAllowedIps})`);
        if (!useTls) {
            console.warn('CẢNH BÁO: đang chạy HTTP không mã hóa. Khi dùng thật, đặt TLS_CERT và TLS_KEY để bật HTTPS.');
        }
    });
    return server;
}

if (require.main === module) start();

module.exports = { handler, start, CONFIG };
