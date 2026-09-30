'use strict';
/**
 * Trang quản trị (CMS) - Phase 2.
 *
 *   /admin/            giao diện (thư mục admin-ui/)
 *   /admin/api/...     API quản trị
 *
 * Lớp bảo vệ, theo thứ tự:
 *   1. Chỉ IP trong ADMIN_ALLOWED_IPS mới thấy /admin (IP khác nhận 404).
 *   2. Đăng nhập tài khoản riêng; sai 5 lần -> khóa 15 phút.
 *   3. Phiên làm việc: cookie HttpOnly + SameSite=Strict, hết hạn khi không
 *      thao tác 30 phút hoặc sau 8 giờ; mọi thao tác ghi cần header CSRF.
 *   4. Phân quyền theo vai trò (PERMS). Lần đăng nhập đầu bắt buộc đổi mật khẩu.
 *   5. Mọi thao tác ghi vào data/admin.log.
 *
 * Trang quản trị KHÔNG trả dữ liệu sức khỏe hay ngày sinh: danh sách chỉ có
 * thông tin định danh và trạng thái PIN/khóa.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const db = require('./db');
const { fileToRecords, EMPLOYEE_CODE_RE } = require('./records');
const { clientIp, sendJson, sendText, readBodyBuffer, readJsonBody, serveStaticFrom, appendLog } = require('./http-util');

const ADMIN_UI_DIR = path.join(__dirname, '..', 'admin-ui');
const ADMIN_LOG = path.join(db.DATA_DIR, 'admin.log');
const ACCESS_LOG = path.join(db.DATA_DIR, 'access.log');

const COOKIE = 'ksk_admin';
const IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 8 * 60 * 60_000;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60_000;
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MIN_PASSWORD_LEN = 10;

const ROLE_LABELS = {
    admin: 'Quản trị hệ thống',
    yte: 'Y tế (import dữ liệu)',
    nhansu: 'Nhân sự (PIN & mở khóa)'
};

const PERMS = {
    admin: ['employees.view', 'import', 'pin', 'unlock', 'users', 'logs'],
    yte: ['employees.view', 'import'],
    nhansu: ['employees.view', 'pin', 'unlock']
};

/* --------------------------------------------------------------------------
   Danh sách IP được phép: IP đơn (IPv4/IPv6) hoặc dải IPv4 dạng CIDR.
   -------------------------------------------------------------------------- */
function ipv4ToInt(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
    return parts.reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0;
}

function parseAllowList(spec) {
    return String(spec || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((entry) => {
            const [base, bitsStr] = entry.split('/');
            if (bitsStr !== undefined) {
                const baseInt = ipv4ToInt(base);
                const bits = Number(bitsStr);
                if (baseInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
                    throw new Error(`ADMIN_ALLOWED_IPS: mục không hợp lệ "${entry}"`);
                }
                const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
                return (ip) => {
                    const n = ipv4ToInt(ip);
                    return n !== null && (n & mask) === (baseInt & mask);
                };
            }
            const exact = entry.toLowerCase();
            return (ip) => ip.toLowerCase() === exact;
        });
}

/* --------------------------------------------------------------------------
   Phiên đăng nhập (trong bộ nhớ; khởi động lại máy chủ = đăng nhập lại)
   -------------------------------------------------------------------------- */
const sessions = new Map();

function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
}

function dropSessionsOf(username) {
    for (const [token, s] of sessions) if (s.username === username) sessions.delete(token);
}

setInterval(() => {
    const now = Date.now();
    for (const [token, s] of sessions) {
        if (now - s.lastSeen > IDLE_MS || now - s.created > ABSOLUTE_MS) sessions.delete(token);
    }
}, 60_000).unref();

/* --------------------------------------------------------------------------
   Handler
   -------------------------------------------------------------------------- */
function createAdminHandler({ trustProxy = false, allowedIps = '127.0.0.1,::1', secureCookie = false, publicUrl = '' } = {}) {
    const allow = parseAllowList(allowedIps);
    const isAllowed = (ip) => allow.some((match) => match(ip));

    function cookieHeader(value, maxAgeSec) {
        return `${COOKIE}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secureCookie ? '; Secure' : ''}`;
    }

    /** Trả về phiên hợp lệ (đã đối chiếu lại với CSDL) hoặc null. */
    function getSession(req) {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        if (!token) return null;
        const s = sessions.get(token);
        if (!s) return null;
        const now = Date.now();
        if (now - s.lastSeen > IDLE_MS || now - s.created > ABSOLUTE_MS) {
            sessions.delete(token);
            return null;
        }
        const user = db.getAdminUser(s.username);
        if (!user || !user.active) {
            sessions.delete(token);
            return null;
        }
        s.lastSeen = now;
        s.role = user.role;
        s.mustChange = Boolean(user.must_change_password);
        s.token = token;
        return s;
    }

    function publicSession(s) {
        return {
            username: s.username,
            role: s.role,
            role_label: ROLE_LABELS[s.role],
            permissions: PERMS[s.role],
            must_change_password: s.mustChange,
            public_url: publicUrl,
            csrf: s.csrf
        };
    }

    const log = (ip, user, action, extra = {}) => appendLog(ADMIN_LOG, { ip, user, action, ...extra });

    async function handleLogin(req, res, ip) {
        const body = await readJsonBody(req);
        const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const user = db.USERNAME_RE.test(username) ? db.getAdminUser(username) : null;
        const now = Date.now();

        if (user && user.locked_until > now) {
            log(ip, username, 'login_locked');
            return sendJson(res, 423, { message: `Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau ${Math.ceil((user.locked_until - now) / 60_000)} phút.` });
        }

        const ok = (await db.verifySecret(password, user ? user.pass_hash : null)) && Boolean(user) && Boolean(user.active);
        if (!ok) {
            if (user) {
                const fails = user.failed_attempts + 1;
                if (fails >= LOGIN_MAX_FAILS) db.recordAdminFailure(username, 0, now + LOGIN_LOCK_MS);
                else db.recordAdminFailure(username, fails, 0);
            }
            log(ip, username || null, 'login_fail');
            return sendJson(res, 401, { message: 'Sai tên đăng nhập hoặc mật khẩu.' });
        }

        db.clearAdminFailures(username);
        const token = crypto.randomBytes(32).toString('hex');
        const s = { username, role: user.role, csrf: crypto.randomBytes(24).toString('hex'), created: now, lastSeen: now, mustChange: Boolean(user.must_change_password) };
        sessions.set(token, s);
        log(ip, username, 'login');
        return sendJson(res, 200, publicSession(s), { 'Set-Cookie': cookieHeader(token, ABSOLUTE_MS / 1000) });
    }

    async function handleChangePassword(req, res, ip, s) {
        const body = await readJsonBody(req);
        const current = typeof body.current_password === 'string' ? body.current_password : '';
        const next = typeof body.new_password === 'string' ? body.new_password : '';
        const user = db.getAdminUser(s.username);
        if (!(await db.verifySecret(current, user.pass_hash))) {
            return sendJson(res, 400, { message: 'Mật khẩu hiện tại không đúng.' });
        }
        if (next.length < MIN_PASSWORD_LEN) return sendJson(res, 400, { message: `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LEN} ký tự.` });
        if (next === current) return sendJson(res, 400, { message: 'Mật khẩu mới phải khác mật khẩu hiện tại.' });
        if (next.toLowerCase().includes(s.username)) return sendJson(res, 400, { message: 'Mật khẩu không được chứa tên đăng nhập.' });
        db.changeAdminPassword(s.username, next);
        s.mustChange = false;
        log(ip, s.username, 'change_password');
        return sendJson(res, 200, publicSession(s));
    }

    function readLogTail(file, lines = 200) {
        try {
            const text = fs.readFileSync(file, 'utf8');
            return text.trim().split('\n').slice(-lines).reverse().map((l) => {
                try { return JSON.parse(l); } catch { return { raw: l }; }
            });
        } catch {
            return [];
        }
    }

    const readCode = (body) => (typeof body.employee_code === 'string' ? body.employee_code.trim().toUpperCase() : '');

    async function handleApi(req, res, ip, route, url) {
        const method = req.method;

        if (route === 'login' && method === 'POST') return handleLogin(req, res, ip);

        const s = getSession(req);
        if (!s) return sendJson(res, 401, { message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });

        if (method !== 'GET' && method !== 'HEAD' && req.headers['x-csrf-token'] !== s.csrf) {
            log(ip, s.username, 'csrf_reject', { route });
            return sendJson(res, 403, { message: 'Yêu cầu không hợp lệ (CSRF).' });
        }

        if (route === 'me' && method === 'GET') return sendJson(res, 200, publicSession(s));
        if (route === 'logout' && method === 'POST') {
            sessions.delete(s.token);
            log(ip, s.username, 'logout');
            return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', 0) });
        }
        if (route === 'password' && method === 'POST') return handleChangePassword(req, res, ip, s);

        if (s.mustChange) {
            return sendJson(res, 403, { code: 'must_change_password', message: 'Bạn cần đổi mật khẩu trước khi tiếp tục.' });
        }

        const can = (perm) => PERMS[s.role].includes(perm);
        const deny = () => sendJson(res, 403, { message: 'Tài khoản của bạn không có quyền thực hiện thao tác này.' });

        switch (`${method} ${route}`) {
            case 'GET stats':
                return sendJson(res, 200, db.stats());

            case 'GET employees': {
                if (!can('employees.view')) return deny();
                return sendJson(res, 200, db.listEmployees(url.searchParams.get('q') || ''));
            }

            case 'POST import': {
                if (!can('import')) return deny();
                // Chỉ nhận file Excel .xlsx
                const { records, errors } = fileToRecords(await readBodyBuffer(req, MAX_IMPORT_BYTES));
                const counts = db.previewImport(records);
                if (url.searchParams.get('mode') !== 'commit') {
                    return sendJson(res, 200, { valid_count: records.length, ...counts, errors });
                }
                if (errors.length || records.length === 0) {
                    return sendJson(res, 400, { message: 'File còn lỗi, chưa import.', errors });
                }
                const result = db.importRecords(records);
                log(ip, s.username, 'import', result);
                return sendJson(res, 200, result);
            }

            case 'POST pins/issue-missing': {
                if (!can('pin')) return deny();
                const issued = db.issueMissingPins();
                log(ip, s.username, 'issue_pins', { count: issued.length });
                return sendJson(res, 200, { issued });
            }

            case 'POST employees/reset-pin': {
                if (!can('pin')) return deny();
                const code = readCode(await readJsonBody(req));
                if (!EMPLOYEE_CODE_RE.test(code)) return sendJson(res, 400, { message: 'Mã nhân viên không hợp lệ.' });
                const issued = db.resetPin(code);
                if (!issued) return sendJson(res, 404, { message: 'Không tìm thấy mã nhân viên.' });
                log(ip, s.username, 'reset_pin', { target: code });
                return sendJson(res, 200, { issued: [issued] });
            }

            case 'POST employees/unlock': {
                if (!can('unlock')) return deny();
                const code = readCode(await readJsonBody(req));
                if (!EMPLOYEE_CODE_RE.test(code) || !db.getEmployee(code)) return sendJson(res, 404, { message: 'Không tìm thấy mã nhân viên.' });
                db.clearFailures(code);
                log(ip, s.username, 'unlock', { target: code });
                return sendJson(res, 200, { ok: true });
            }

            case 'GET users':
                if (!can('users')) return deny();
                return sendJson(res, 200, { items: db.listAdminUsers(), roles: ROLE_LABELS });

            case 'POST users': {
                if (!can('users')) return deny();
                const body = await readJsonBody(req);
                const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
                const role = typeof body.role === 'string' ? body.role : '';
                try {
                    const password = db.createAdminUser(username, role);
                    log(ip, s.username, 'create_user', { target: username, role });
                    return sendJson(res, 200, { username, password });
                } catch (err) {
                    return sendJson(res, 400, { message: err.message });
                }
            }

            case 'POST users/reset-password': {
                if (!can('users')) return deny();
                const username = String((await readJsonBody(req)).username || '').toLowerCase();
                if (username === s.username) return sendJson(res, 400, { message: 'Hãy dùng chức năng "Đổi mật khẩu" cho tài khoản của chính bạn.' });
                const password = db.resetAdminPassword(username);
                if (!password) return sendJson(res, 404, { message: 'Không tìm thấy tài khoản.' });
                dropSessionsOf(username);
                log(ip, s.username, 'reset_user_password', { target: username });
                return sendJson(res, 200, { username, password });
            }

            case 'POST users/set-active': {
                if (!can('users')) return deny();
                const body = await readJsonBody(req);
                const username = String(body.username || '').toLowerCase();
                const active = body.active === true;
                if (username === s.username && !active) return sendJson(res, 400, { message: 'Không thể tự khóa tài khoản đang đăng nhập.' });
                try {
                    if (!db.setAdminActive(username, active)) return sendJson(res, 404, { message: 'Không tìm thấy tài khoản.' });
                } catch (err) {
                    return sendJson(res, 400, { message: err.message });
                }
                if (!active) dropSessionsOf(username);
                log(ip, s.username, active ? 'enable_user' : 'disable_user', { target: username });
                return sendJson(res, 200, { ok: true });
            }

            case 'GET logs': {
                if (!can('logs')) return deny();
                const type = url.searchParams.get('type') === 'access' ? ACCESS_LOG : ADMIN_LOG;
                return sendJson(res, 200, { items: readLogTail(type) });
            }

            default:
                return sendJson(res, 404, { message: 'Not found' });
        }
    }

    /** Trả về true nếu request thuộc /admin (đã được xử lý). */
    return async function adminHandler(req, res, url) {
        const pathname = url.pathname;
        if (pathname !== '/admin' && !pathname.startsWith('/admin/')) return false;

        const ip = clientIp(req, trustProxy);
        if (!isAllowed(ip)) {
            appendLog(ADMIN_LOG, { ip, user: null, action: 'ip_denied', path: pathname });
            sendText(res, 404, 'Not found');
            return true;
        }

        if (pathname === '/admin') {
            res.writeHead(302, { Location: '/admin/' });
            res.end();
            return true;
        }

        if (pathname.startsWith('/admin/api/')) {
            try {
                await handleApi(req, res, ip, pathname.slice('/admin/api/'.length), url);
            } catch (err) {
                if (err.status) sendJson(res, err.status, { message: 'Yêu cầu không hợp lệ.' });
                else throw err;
            }
            return true;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendText(res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
            return true;
        }
        serveStaticFrom(ADMIN_UI_DIR, pathname.slice('/admin'.length), req, res, { 'Cache-Control': 'no-store' });
        return true;
    };
}

module.exports = { createAdminHandler, parseAllowList, PERMS, ROLE_LABELS };
