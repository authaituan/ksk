'use strict';
/**
 * Công cụ quản trị chạy trên máy chủ (thay cho tab CMS cũ, trong Phase 1).
 *
 *   node server/cli.js import <file.csv>   Import/cập nhật danh sách khám
 *   node server/cli.js reset-pin <mã NV>   Cấp lại PIN (và mở khóa)
 *   node server/cli.js unlock <mã NV>      Mở khóa tra cứu
 *   node server/cli.js stats               Thống kê CSDL
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { csvToRecords } = require('./records');

function csvCell(v) {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function cmdImport(file) {
    if (!file) return usage();
    const text = fs.readFileSync(file, 'utf8');
    const { records, errors } = csvToRecords(text);

    if (errors.length) {
        console.error(`Không import: có ${errors.length} lỗi, cần sửa file rồi chạy lại.`);
        errors.slice(0, 50).forEach((e) => console.error('  - ' + e));
        if (errors.length > 50) console.error(`  ... và ${errors.length - 50} lỗi khác`);
        process.exitCode = 1;
        return;
    }

    const { inserted, updated, newPins } = db.importRecords(records);
    console.log(`Import xong: ${inserted} hồ sơ mới, ${updated} hồ sơ cập nhật.`);

    if (newPins.length) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const out = path.join(db.DATA_DIR, `pins-${stamp}.csv`);
        const lines = ['mã_nhân_viên,họ_và_tên,pin', ...newPins.map((p) => [p.employee_code, p.full_name, p.pin].map(csvCell).join(','))];
        fs.writeFileSync(out, '﻿' + lines.join('\r\n') + '\r\n', { mode: 0o600 });
        console.log(`Đã cấp PIN cho ${newPins.length} nhân viên mới -> ${out}`);
        console.log('LƯU Ý: chuyển file PIN cho bộ phận Nhân sự phát riêng từng người, sau đó XÓA file này.');
    }
}

function cmdResetPin(code) {
    if (!code) return usage();
    const pin = db.resetPin(code.trim().toUpperCase());
    if (!pin) {
        console.error('Không tìm thấy mã nhân viên.');
        process.exitCode = 1;
        return;
    }
    console.log(`PIN mới cho ${code.toUpperCase()}: ${pin}`);
}

function cmdUnlock(code) {
    if (!code) return usage();
    const c = code.trim().toUpperCase();
    if (!db.getEmployee(c)) {
        console.error('Không tìm thấy mã nhân viên.');
        process.exitCode = 1;
        return;
    }
    db.clearFailures(c);
    console.log(`Đã mở khóa ${c}.`);
}

function usage() {
    console.log(`Cách dùng:
  node server/cli.js import <file.csv>
  node server/cli.js reset-pin <mã_nhân_viên>
  node server/cli.js unlock <mã_nhân_viên>
  node server/cli.js stats`);
    process.exitCode = 1;
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
    case 'import': cmdImport(arg); break;
    case 'reset-pin': cmdResetPin(arg); break;
    case 'unlock': cmdUnlock(arg); break;
    case 'stats': console.log(db.stats()); break;
    default: usage();
}
