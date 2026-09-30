'use strict';
/**
 * Đọc CSV danh sách khám sức khỏe và chuyển thành hồ sơ.
 * - Ánh xạ theo TÊN CỘT (không theo vị trí) để tránh lệch cột.
 * - Hỗ trợ dấu phân cách "," hoặc ";" (Excel tiếng Việt thường xuất ";"),
 *   ô có dấu ngoặc kép, BOM UTF-8.
 * - KHÔNG tự điền giá trị mặc định cho chỉ số y tế: ô trống giữ trống.
 */

// Cột CSV -> đường dẫn trường trong hồ sơ. Thứ tự = thứ tự cột trong file mẫu.
const COLUMNS = [
    ['stt', 'stt'],
    ['họ_và_tên', 'full_name'],
    ['mã_nhân_viên', 'employee_code'],
    ['giới_tính', 'gender'],
    ['ngày_sinh', 'dob'],
    ['chức_danh', 'job_title'],
    ['bộ_phận', 'department'],
    ['đơn_vị', 'unit_name'],
    ['chiều_cao', 'height'],
    ['cân_nặng', 'weight'],
    ['thể_lực', 'physical'],
    ['huyết_áp', 'blood_pressure'],
    ['mắt_phải', 'vision_right'],
    ['mắt_trái', 'vision_left'],
    ['bệnh_mắt', 'vision_disease'],
    ['tmh', 'ent'],
    ['rhm', 'dental'],
    ['nội_da_liễu', 'dermatology'],
    ['ngoại', 'surgery'],
    ['x_quang', 'xray'],
    ['siêu_âm', 'ultrasound'],
    ['phụ_khoa', 'gynecology'],
    ['xn_ctm', 'blood_tests.ctm'],
    ['xn_nước_tiểu', 'blood_tests.urine'],
    ['acid_uric', 'blood_tests.acid_uric'],
    ['creatinin', 'blood_tests.creatinin'],
    ['glucose', 'blood_tests.glucose'],
    ['ure', 'blood_tests.ure'],
    ['sgot', 'blood_tests.sgot'],
    ['sgpt', 'blood_tests.sgpt'],
    ['triglycerides', 'blood_tests.triglycerides'],
    ['cholesterol', 'blood_tests.cholesterol'],
    ['ggt', 'blood_tests.ggt'],
    ['morphin', 'blood_tests.morphin'],
    ['phân_loại_sk', 'health_class'],
    ['kết_luận', 'conclusion'],
    ['tư_vấn', 'medical_advice']
];

const EMPLOYEE_CODE_RE = /^[A-Za-z0-9]{1,20}$/;

function normalizeHeader(h) {
    return h.normalize('NFC').trim().toLowerCase().replace(/\s+/g, '_');
}

/** Chuẩn hóa ngày sinh về DD/MM/YYYY; trả về null nếu không phải ngày hợp lệ. */
function normalizeDob(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim();
    let d, m, y;
    let match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) {
        [, d, m, y] = match;
    } else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
        [, y, m, d] = match;
    } else {
        return null;
    }
    const day = Number(d), month = Number(m), year = Number(y);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    if (year < 1900 || year > new Date().getFullYear()) return null;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function detectDelimiter(headerLine) {
    let commas = 0, semis = 0, inQuotes = false;
    for (const ch of headerLine) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes && ch === ',') commas++;
        else if (!inQuotes && ch === ';') semis++;
    }
    return semis > commas ? ';' : ',';
}

/** Parser CSV theo RFC 4180 (ô có ngoặc kép, "" bên trong, xuống dòng trong ô). */
function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLineEnd = text.search(/\r?\n/);
    const delimiter = detectDelimiter(firstLineEnd === -1 ? text : text.slice(0, firstLineEnd));
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else if (ch === '"') inQuotes = true;
        else if (ch === delimiter) { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ??= {};
    cur[parts[parts.length - 1]] = value;
}

/**
 * Chuyển nội dung CSV thành danh sách hồ sơ.
 * Trả về { records, errors }. Nếu có lỗi, KHÔNG nên import (tránh import dở dang).
 */
function csvToRecords(text) {
    const rows = parseCsv(text);
    const errors = [];
    if (rows.length < 2) return { records: [], errors: ['File không có dòng dữ liệu nào.'] };

    const headers = rows[0].map(normalizeHeader);
    const index = new Map(headers.map((h, i) => [h, i]));
    const missing = COLUMNS.filter(([col]) => !index.has(col)).map(([col]) => col);
    if (missing.length) {
        return { records: [], errors: [`Thiếu cột: ${missing.join(', ')}. Xem sample_database.csv để biết đúng tên cột.`] };
    }

    const records = [];
    const seen = new Map();
    for (let r = 1; r < rows.length; r++) {
        const line = r + 1; // số dòng trong file (tính cả dòng tiêu đề)
        const cells = rows[r];
        const rec = { blood_tests: {} };
        for (const [col, path] of COLUMNS) {
            setPath(rec, path, (cells[index.get(col)] ?? '').trim());
        }
        rec.employee_code = rec.employee_code.toUpperCase();

        const rowErrors = [];
        if (!rec.full_name) rowErrors.push('thiếu họ và tên');
        if (!EMPLOYEE_CODE_RE.test(rec.employee_code)) rowErrors.push(`mã nhân viên "${rec.employee_code}" không hợp lệ (chỉ chữ/số, tối đa 20 ký tự)`);
        const dob = normalizeDob(rec.dob);
        if (!dob) rowErrors.push(`ngày sinh "${rec.dob}" không hợp lệ (cần DD/MM/YYYY)`);
        else rec.dob = dob;
        if (rec.employee_code && seen.has(rec.employee_code)) {
            rowErrors.push(`trùng mã nhân viên với dòng ${seen.get(rec.employee_code)}`);
        }
        seen.set(rec.employee_code, line);

        if (rowErrors.length) errors.push(`Dòng ${line}: ${rowErrors.join('; ')}`);
        else records.push(rec);
    }
    return { records, errors };
}

module.exports = { COLUMNS, EMPLOYEE_CODE_RE, normalizeDob, parseCsv, csvToRecords };
