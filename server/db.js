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
`);

/* --------------------------------------------------------------------------
   PIN: lưu dạng scrypt(salt, pin). Không bao giờ lưu PIN gốc.
   -------------------------------------------------------------------------- */
const SCRYPT_KEYLEN = 32;

function generatePin() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashPin(pin) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(pin, salt, SCRYPT_KEYLEN);
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

// Hash giả để vẫn tốn thời gian tính toán khi mã nhân viên không tồn tại
// (tránh đoán mã tồn tại qua thời gian phản hồi).
const DUMMY_HASH = hashPin(generatePin());

function verifyPin(pin, stored) {
    return new Promise((resolve) => {
        const [saltHex, hashHex] = (stored || DUMMY_HASH).split(':');
        crypto.scrypt(String(pin), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN, (err, derived) => {
            if (err) return resolve(false);
            resolve(crypto.timingSafeEqual(derived, Buffer.from(hashHex, 'hex')) && Boolean(stored));
        });
    });
}

/* --------------------------------------------------------------------------
   Truy vấn
   -------------------------------------------------------------------------- */
const stmt = {
    get: db.prepare('SELECT * FROM employees WHERE employee_code = ?'),
    upsert: db.prepare(`
        INSERT INTO employees (employee_code, dob, record_json, pin_hash, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(employee_code) DO UPDATE SET
            dob = excluded.dob,
            record_json = excluded.record_json,
            updated_at = excluded.updated_at
    `),
    setPin: db.prepare('UPDATE employees SET pin_hash = ?, failed_attempts = 0, locked_until = 0 WHERE employee_code = ?'),
    fail: db.prepare('UPDATE employees SET failed_attempts = ?, locked_until = ? WHERE employee_code = ?'),
    resetFails: db.prepare('UPDATE employees SET failed_attempts = 0, locked_until = 0 WHERE employee_code = ?'),
    count: db.prepare('SELECT COUNT(*) AS total, SUM(pin_hash IS NULL) AS no_pin, SUM(locked_until > ?) AS locked FROM employees')
};

function getEmployee(code) {
    return stmt.get.get(code) || null;
}

/**
 * Import/cập nhật hồ sơ trong 1 transaction.
 * Nhân viên mới được sinh PIN; nhân viên cũ giữ nguyên PIN.
 * Trả về { inserted, updated, newPins: [{employee_code, full_name, pin}] }.
 */
function importRecords(records) {
    const now = new Date().toISOString();
    const newPins = [];
    let inserted = 0, updated = 0;
    db.exec('BEGIN');
    try {
        for (const rec of records) {
            const existing = getEmployee(rec.employee_code);
            let pinHash = null;
            if (!existing) {
                const pin = generatePin();
                pinHash = hashPin(pin);
                newPins.push({ employee_code: rec.employee_code, full_name: rec.full_name, pin });
                inserted++;
            } else {
                updated++;
            }
            stmt.upsert.run(rec.employee_code, rec.dob, JSON.stringify(rec), pinHash, now);
        }
        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }
    return { inserted, updated, newPins };
}

function resetPin(code) {
    if (!getEmployee(code)) return null;
    const pin = generatePin();
    stmt.setPin.run(hashPin(pin), code);
    return pin;
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

module.exports = {
    DATA_DIR, getEmployee, importRecords, resetPin, verifyPin,
    recordFailure, clearFailures, stats
};
