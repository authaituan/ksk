'use strict';
/**
 * Lưu trữ SQLite dùng module có sẵn của Node (node:sqlite, Node >= 22.13).
 * File CSDL nằm trong thư mục data/ (đã loại khỏi git).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.KSK_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'ksk.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS employees (
        employee_code   TEXT PRIMARY KEY,
        dob             TEXT NOT NULL,
        record_json     TEXT NOT NULL,
        pin_hash        TEXT,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until    INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_users (
        username             TEXT PRIMARY KEY,
        pass_hash            TEXT NOT NULL,
        role                 TEXT NOT NULL CHECK (role IN ('admin', 'yte', 'nhansu')),
        active               INTEGER NOT NULL DEFAULT 1,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        failed_attempts      INTEGER NOT NULL DEFAULT 0,
        locked_until         INTEGER NOT NULL DEFAULT 0,
        created_at           TEXT NOT NULL
    );
`);

// Nâng cấp CSDL từ Phase 1: thêm cột thời điểm cấp PIN.
if (!db.prepare('PRAGMA table_info(employees)').all().some((c) => c.name === 'pin_issued_at')) {
    db.exec('ALTER TABLE employees ADD COLUMN pin_issued_at TEXT');
}

/* --------------------------------------------------------------------------
   Băm bí mật (PIN, mật khẩu quản trị) bằng scrypt + salt. Không lưu bản gốc.
   -------------------------------------------------------------------------- */
const SCRYPT_KEYLEN = 32;

function hashSecret(secret) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(secret), salt, SCRYPT_KEYLEN);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

// Hash giả để vẫn tốn thời gian tính khi tài khoản/mã không tồn tại
// (tránh đoán sự tồn tại qua thời gian phản hồi).
const DUMMY_HASH = hashSecret(crypto.randomBytes(8).toString('hex'));

function verifySecret(secret, stored) {
    return new Promise((resolve) => {
        const [saltHex, hashHex] = (stored || DUMMY_HASH).split(':');
        crypto.scrypt(String(secret), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, (err, derived) => {
            if (err) return resolve(false);
            resolve(crypto.timingSafeEqual(derived, Buffer.from(hashHex, 'hex')) && Boolean(stored));
        });
    });
}

function generatePin() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Mật khẩu tạm 12 ký tự, bỏ các ký tự dễ nhầm (0/O, 1/l/I). */
function generatePassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 12; i++) out += alphabet[crypto.randomInt(0, alphabet.length)];
    return out;
}

/* --------------------------------------------------------------------------
   Nhân viên / hồ sơ khám
   -------------------------------------------------------------------------- */
const stmt = {
    get: db.prepare('SELECT * FROM employees WHERE employee_code = ?'),
    all: db.prepare('SELECT employee_code, record_json, pin_hash IS NOT NULL AS has_pin, pin_issued_at, failed_attempts, locked_until, updated_at FROM employees ORDER BY employee_code'),
    upsert: db.prepare(`
        INSERT INTO employees (employee_code, dob, record_json, pin_hash, updated_at)
        VALUES (?, ?, ?, NULL, ?)
        ON CONFLICT(employee_code) DO UPDATE SET
            dob = excluded.dob,
            record_json = excluded.record_json,
            updated_at = excluded.updated_at
    `),
    withoutPin: db.prepare('SELECT employee_code, record_json FROM employees WHERE pin_hash IS NULL ORDER BY employee_code'),
    setPin: db.prepare('UPDATE employees SET pin_hash = ?, pin_issued_at = ?, failed_attempts = 0, locked_until = 0 WHERE employee_code = ?'),
    fail: db.prepare('UPDATE employees SET failed_attempts = ?, locked_until = ? WHERE employee_code = ?'),
    resetFails: db.prepare('UPDATE employees SET failed_attempts = 0, locked_until = 0 WHERE employee_code = ?'),
    count: db.prepare('SELECT COUNT(*) AS total, SUM(pin_hash IS NULL) AS no_pin, SUM(locked_until > ?) AS locked FROM employees')
};

function getEmployee(code) {
    return stmt.get.get(code) || null;
}

/** Chỉ các trường định danh cần cho quản trị. KHÔNG chứa dữ liệu sức khỏe hay ngày sinh. */
function identityOf(code, recordJson) {
    const r = JSON.parse(recordJson);
    return {
        employee_code: code,
        full_name: r.full_name || '',
        department: r.department || '',
        unit_name: r.unit_name || '',
        job_title: r.job_title || ''
    };
}

function listEmployees(query = '', limit = 200) {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const out = [];
    let total = 0;
    for (const row of stmt.all.all()) {
        const item = identityOf(row.employee_code, row.record_json);
        if (q && !`${item.employee_code} ${item.full_name} ${item.department} ${item.unit_name}`.toLowerCase().includes(q)) continue;
        total++;
        if (out.length < limit) {
            out.push({
                ...item,
                has_pin: Boolean(row.has_pin),
                pin_issued_at: row.pin_issued_at,
                failed_attempts: row.failed_attempts,
                locked: row.locked_until > now,
                updated_at: row.updated_at
            });
        }
    }
    return { total, items: out };
}

/** Phân loại trước khi import: bao nhiêu mới, bao nhiêu cập nhật. */
function previewImport(records) {
    let inserted = 0, updated = 0;
    for (const rec of records) {
        if (getEmployee(rec.employee_code)) updated++; else inserted++;
    }
    return { inserted, updated };
}

/**
 * Import/cập nhật hồ sơ trong 1 transaction. KHÔNG sinh PIN:
 * nhân viên mới ở trạng thái "chưa có PIN" cho đến khi Nhân sự cấp PIN.
 */
function importRecords(records) {
    const now = new Date().toISOString();
    const counts = previewImport(records);
    db.exec('BEGIN');
    try {
        for (const rec of records) stmt.upsert.run(rec.employee_code, rec.dob, JSON.stringify(rec), now);
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
    return counts;
}

/**
 * Cấp PIN cho mọi nhân viên chưa có PIN. PIN gốc chỉ được trả về 1 lần tại đây.
 * Trả về [{employee_code, full_name, department, unit_name, job_title, pin}].
 */
function issueMissingPins() {
    const now = new Date().toISOString();
    const issued = [];
    db.exec('BEGIN');
    try {
        for (const row of stmt.withoutPin.all()) {
            const pin = generatePin();
            stmt.setPin.run(hashSecret(pin), now, row.employee_code);
            issued.push({ ...identityOf(row.employee_code, row.record_json), pin });
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
    return issued;
}

/** Cấp lại PIN cho 1 người (đồng thời mở khóa). Trả về như issueMissingPins, hoặc null. */
function resetPin(code) {
    const emp = getEmployee(code);
    if (!emp) return null;
    const pin = generatePin();
    stmt.setPin.run(hashSecret(pin), new Date().toISOString(), code);
    return { ...identityOf(code, emp.record_json), pin };
}

function verifyPin(pin, stored) {
    return verifySecret(pin, stored);
}

function recordFailure(code, failedAttempts, lockedUntil) {
    stmt.fail.run(failedAttempts, lockedUntil, code);
}

function clearFailures(code) {
    stmt.resetFails.run(code);
}

function stats() {
    const r = stmt.count.get(Date.now());
    return { total: r.total, without_pin: r.no_pin || 0, locked: r.locked || 0 };
}

/* --------------------------------------------------------------------------
   Tài khoản quản trị
   -------------------------------------------------------------------------- */
const ROLES = ['admin', 'yte', 'nhansu'];
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

const ustmt = {
    get: db.prepare('SELECT * FROM admin_users WHERE username = ?'),
    list: db.prepare('SELECT username, role, active, must_change_password, locked_until, created_at FROM admin_users ORDER BY username'),
    insert: db.prepare('INSERT INTO admin_users (username, pass_hash, role, created_at) VALUES (?, ?, ?, ?)'),
    setPass: db.prepare('UPDATE admin_users SET pass_hash = ?, must_change_password = ?, failed_attempts = 0, locked_until = 0 WHERE username = ?'),
    setActive: db.prepare('UPDATE admin_users SET active = ? WHERE username = ?'),
    fail: db.prepare('UPDATE admin_users SET failed_attempts = ?, locked_until = ? WHERE username = ?'),
    ok: db.prepare('UPDATE admin_users SET failed_attempts = 0, locked_until = 0 WHERE username = ?'),
    activeAdmins: db.prepare("SELECT COUNT(*) AS n FROM admin_users WHERE role = 'admin' AND active = 1")
};

function getAdminUser(username) {
    return ustmt.get.get(username) || null;
}

function listAdminUsers() {
    const now = Date.now();
    return ustmt.list.all().map((u) => ({
        username: u.username,
        role: u.role,
        active: Boolean(u.active),
        must_change_password: Boolean(u.must_change_password),
        locked: u.locked_until > now,
        created_at: u.created_at
    }));
}

/** Tạo tài khoản với mật khẩu tạm (bắt buộc đổi ở lần đăng nhập đầu). Trả về mật khẩu tạm. */
function createAdminUser(username, role) {
    if (!USERNAME_RE.test(username)) throw new Error('Tên đăng nhập chỉ gồm a-z, 0-9, dấu . _ -, dài 3–32 ký tự.');
    if (!ROLES.includes(role)) throw new Error('Vai trò không hợp lệ.');
    if (getAdminUser(username)) throw new Error('Tên đăng nhập đã tồn tại.');
    const password = generatePassword();
    ustmt.insert.run(username, hashSecret(password), role, new Date().toISOString());
    return password;
}

function resetAdminPassword(username) {
    if (!getAdminUser(username)) return null;
    const password = generatePassword();
    ustmt.setPass.run(hashSecret(password), 1, username);
    return password;
}

function changeAdminPassword(username, newPassword) {
    ustmt.setPass.run(hashSecret(newPassword), 0, username);
}

function setAdminActive(username, active) {
    const u = getAdminUser(username);
    if (!u) return false;
    if (!active && u.role === 'admin' && u.active && ustmt.activeAdmins.get().n <= 1) {
        throw new Error('Không thể khóa tài khoản quản trị cuối cùng.');
    }
    ustmt.setActive.run(active ? 1 : 0, username);
    return true;
}

function recordAdminFailure(username, failedAttempts, lockedUntil) {
    ustmt.fail.run(failedAttempts, lockedUntil, username);
}

function clearAdminFailures(username) {
    ustmt.ok.run(username);
}

module.exports = {
    DATA_DIR, ROLES, USERNAME_RE,
    hashSecret, verifySecret,
    getEmployee, listEmployees, previewImport, importRecords, issueMissingPins, resetPin, verifyPin,
    recordFailure, clearFailures, stats,
    getAdminUser, listAdminUsers, createAdminUser, resetAdminPassword, changeAdminPassword,
    setAdminActive, recordAdminFailure, clearAdminFailures
};
