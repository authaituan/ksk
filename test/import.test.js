'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { fileToRecords, normalizeDob, normalizeHeader } = require('../server/records');

const root = path.join(__dirname, '..');

test('ngày sinh: dd/mm/yyyy, ddmmyyyy, dmmyyyy (mất số 0 đầu), yyyy-mm-dd', () => {
    assert.strictEqual(normalizeDob('09/10/1992'), '09/10/1992');
    assert.strictEqual(normalizeDob('09101992'), '09/10/1992');
    assert.strictEqual(normalizeDob('9101992'), '09/10/1992');
    assert.strictEqual(normalizeDob('9.10.1992'), '09/10/1992');
    assert.strictEqual(normalizeDob('1992-10-09'), '09/10/1992');
    assert.strictEqual(normalizeDob('31021990'), null);
    assert.strictEqual(normalizeDob('091092'), null); // 6 số: không đoán thế kỷ
});

test('tiêu đề cột viết kiểu nào cũng nhận', () => {
    for (const h of ['Họ và tên', 'HỌ VÀ TÊN', 'họ_và_tên', ' Họ  và tên ']) assert.strictEqual(normalizeHeader(h), 'họ_và_tên');
    assert.strictEqual(normalizeHeader('X-quang'), 'x_quang');
    // Chữ tổ hợp (NFD) từ một số phần mềm -> NFC
    assert.strictEqual(normalizeHeader('Họ và tên'.normalize('NFD')), 'họ_và_tên');
});

test('file mẫu Excel đọc đúng: dấu tiếng Việt, số 0 đầu, 10/10, ddmmyyyy, dấu phẩy trong ô', () => {
    const { records, errors } = fileToRecords(fs.readFileSync(path.join(root, 'admin-ui', 'mau_import_ksk.xlsx')));
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(records.length, 3);
    const r = records[1];
    assert.strictEqual(r.full_name, 'TRẦN THỊ THỬ');
    assert.strictEqual(r.employee_code, '00000002');
    assert.strictEqual(r.dob, '15/06/1995');
    assert.strictEqual(r.vision_right, '8/10');
    assert.strictEqual(r.blood_pressure, '110/70');
    assert.strictEqual(r.medical_advice, 'Khám mắt, đo độ cận định kỳ');
});

test('Excel gõ ở định dạng General: báo lỗi đúng dòng, không import sai', () => {
    const { records, errors } = fileToRecords(fs.readFileSync(path.join(__dirname, 'fixtures', 'excel_general_format.xlsx')));
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /^Dòng 4:/);
    assert.match(errors[0], /mã nhân viên "12345" đang lưu dạng số/);
    assert.match(errors[0], /"mắt phải" bị Excel tự đổi thành ngày/);
    // Dòng 5 hợp lệ; ngày sinh là ô ngày của Excel -> đổi đúng
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].dob, '05/03/1988');
    assert.strictEqual(records[0].employee_code, '00077777');
});

test('chỉ nhận .xlsx: CSV, .xls cũ, file rác đều bị từ chối kèm hướng dẫn', () => {
    const xlsOld = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0]);
    for (const buf of [Buffer.from('stt,họ_và_tên\n1,A'), xlsOld, Buffer.alloc(0)]) {
        const { records, errors } = fileToRecords(buf);
        assert.strictEqual(records.length, 0);
        assert.match(errors[0], /Chỉ nhận file Excel \.xlsx/);
    }
    // File ZIP hỏng / không phải Excel
    const { errors } = fileToRecords(Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(40)]));
    assert.match(errors[0], /Không đọc được file Excel/);
});
