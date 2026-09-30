'use strict';
/**
 * Công cụ quản trị chạy trên máy chủ. Từ Phase 2, các việc hằng ngày làm trên
 * trang /admin; CLI dùng để tạo tài khoản quản trị đầu tiên và xử lý sự cố.
 *
 *   node server/cli.js add-admin <tên> [admin|yte|nhansu]   Tạo tài khoản quản trị
 *   node server/cli.js reset-admin-password <tên>          Cấp lại mật khẩu tạm
 *   node server/cli.js import <file.csv>                   Import/cập nhật danh sách khám
 *   node server/cli.js issue-pins                          Cấp PIN cho người chưa có PIN
 *   node server/cli.js reset-pin <mã NV>                   Cấp lại PIN (và mở khóa)
 *   node server/cli.js unlock <mã NV>                      Mở khóa tra cứu
 *   node server/cli.js stats                               Thống kê CSDL
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { csvToRecords } = require('./records');

function csvCell(v) {
    const s = String(v ?? '');
    return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fail(message) {
    console.error(message);
    process.exitCode = 1;
}

function writePinFile(issued) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(db.DATA_DIR, `pins-${stamp}.csv`);
    const header = ['mã_nhân_viên', 'họ_và_tên', 'bộ_phận', 'đơn_vị', 'pin'];
    const lines = [header.join(','), ...issued.map((p) => [p.employee_code, p.full_name, p.department, p.unit_name, p.pin].map(csvCell).join(','))];
    fs.writeFileSync(out, '﻿' + lines.join('\r\n') + '\r\n', { mode: 0o600 });
    return out;
}

function cmdAddAdmin(username, role = 'admin') {
    if (!username) return usage();
    try {
        const password = db.createAdminUser(username.trim().toLowerCase(), role);
        console.log(`Đã tạo tài khoản "${username.toLowerCase()}" (vai trò: ${role}).`);
        console.log(`Mật khẩu tạm: ${password}`);
        console.log('Người dùng phải đổi mật khẩu ở lần đăng nhập đầu tại /admin/.');
    } catch (err) {
        fail(err.message);
    }
}

function cmdResetAdminPassword(username) {
    if (!username) return usage();
    const password = db.resetAdminPassword(username.trim().toLowerCase());
    if (!password) return fail('Không tìm thấy tài khoản.');
    console.log(`Mật khẩu tạm mới cho "${username.toLowerCase()}": ${password}`);
}

function cmdImport(file) {
    if (!file) return usage();
    const { records, errors } = csvToRecords(fs.readFileSync(file, 'utf8'));
    if (errors.length) {
        console.error(`Không import: có ${errors.length} lỗi, cần sửa file rồi chạy lại.`);
        errors.slice(0, 50).forEach((e) => console.error('  - ' + e));
        if (errors.length > 50) console.error(`  ... và ${errors.length - 50} lỗi khác`);
        process.exitCode = 1;
        return;
    }
    const { inserted, updated } = db.importRecords(records);
    console.log(`Import xong: ${inserted} hồ sơ mới, ${updated} hồ sơ cập nhật.`);
    if (inserted) console.log(`Nhân viên mới chưa có PIN. Cấp PIN tại trang /admin/ (vai trò Nhân sự) hoặc: node server/cli.js issue-pins`);
}

function cmdIssuePins() {
    const issued = db.issueMissingPins();
    if (!issued.length) return console.log('Không có nhân viên nào đang chờ cấp PIN.');
    const out = writePinFile(issued);
    console.log(`Đã cấp PIN cho ${issued.length} nhân viên -> ${out}`);
    console.log('LƯU Ý: phát PIN riêng cho từng người, sau đó XÓA file này.');
}

function cmdResetPin(code) {
    if (!code) return usage();
    const issued = db.resetPin(code.trim().toUpperCase());
    if (!issued) return fail('Không tìm thấy mã nhân viên.');
    console.log(`PIN mới cho ${issued.employee_code} (${issued.full_name}): ${issued.pin}`);
}

function cmdUnlock(code) {
    if (!code) return usage();
    const c = code.trim().toUpperCase();
    if (!db.getEmployee(c)) return fail('Không tìm thấy mã nhân viên.');
    db.clearFailures(c);
    console.log(`Đã mở khóa ${c}.`);
}

function usage() {
    console.log(`Cách dùng:
  node server/cli.js add-admin <tên_đăng_nhập> [admin|yte|nhansu]
  node server/cli.js reset-admin-password <tên_đăng_nhập>
  node server/cli.js import <file.csv>
  node server/cli.js issue-pins
  node server/cli.js reset-pin <mã_nhân_viên>
  node server/cli.js unlock <mã_nhân_viên>
  node server/cli.js stats`);
    process.exitCode = 1;
}

const [cmd, arg1, arg2] = process.argv.slice(2);
switch (cmd) {
    case 'add-admin': cmdAddAdmin(arg1, arg2); break;
    case 'reset-admin-password': cmdResetAdminPassword(arg1); break;
    case 'import': cmdImport(arg1); break;
    case 'issue-pins': cmdIssuePins(); break;
    case 'reset-pin': cmdResetPin(arg1); break;
    case 'unlock': cmdUnlock(arg1); break;
    case 'stats': console.log(db.stats()); break;
    default: usage();
}
