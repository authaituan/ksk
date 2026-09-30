'use strict';
/**
 * Đọc danh sách khám sức khỏe từ file Excel (.xlsx) và chuyển thành hồ sơ.
 * - Ánh xạ theo TÊN CỘT (không theo vị trí); dòng tiêu đề có thể nằm dưới
 *   vài dòng tiêu đề/ghi chú (tìm trong 15 dòng đầu).
 * - Mọi giá trị được đọc dạng chữ và chuẩn hóa Unicode NFC (chữ có dấu).
 * - Phát hiện ô bị Excel tự đổi thành ngày (vd thị lực "10/10") hoặc mã NV
 *   bị lưu dạng số (mất số 0 đầu) và báo lỗi thay vì import sai.
 * - KHÔNG tự điền giá trị mặc định cho chỉ số y tế: ô trống giữ trống.
 */
const { isXlsx, readXlsxRows, excelSerialToDate } = require('./xlsx-reader');

// Cột (tiêu đề đã chuẩn hóa) -> đường dẫn trường trong hồ sơ. Thứ tự = thứ tự cột trong file mẫu.
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

/** "Họ và tên", "HỌ VÀ TÊN", "họ_và_tên", "X-quang" ... -> khóa chuẩn "họ_và_tên", "x_quang". */
function normalizeHeader(h) {
    return String(h).normalize('NFC').trim().toLowerCase().replace(/[\s\-./]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Chuẩn hóa ngày sinh về DD/MM/YYYY; trả về null nếu không phải ngày hợp lệ. */
function normalizeDob(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim();
    let d, m, y;
    // ddmmyyyy (8 số) hoặc dmmyyyy (7 số: Excel làm mất số 0 đầu của ngày)
    if (/^\d{7,8}$/.test(s)) {
        const full = s.padStart(8, '0');
        return normalizeDob(`${full.slice(0, 2)}/${full.slice(2, 4)}/${full.slice(4)}`);
    }
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

function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] ??= {};
    cur[parts[parts.length - 1]] = value;
}

const COLUMN_LABEL = new Map(COLUMNS.map(([col]) => [col, col.replace(/_/g, ' ')]));
const REQUIRED = ['họ_và_tên', 'mã_nhân_viên', 'ngày_sinh'];

/**
 * Chuyển các dòng đã đọc từ Excel thành hồ sơ.
 * rows: [{ number, cells: [{ text, numeric?, dateFormatted? }] }]
 * Trả về { records, errors }. Có lỗi thì KHÔNG nên import (tránh import dở dang).
 */
function rowsToRecords(rows) {
    const errors = [];
    const isBlank = (r) => r.cells.every((c) => !c || String(c.text).trim() === '');

    // Tìm dòng tiêu đề trong 15 dòng đầu
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const names = new Set(rows[i].cells.map((c) => normalizeHeader(c ? c.text : '')));
        if (REQUIRED.every((r) => names.has(r))) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
        return { records: [], errors: ['Không tìm thấy dòng tiêu đề có đủ cột "Họ và tên", "Mã nhân viên", "Ngày sinh". Hãy dùng file mẫu mau_import_ksk.xlsx.'] };
    }

    const headers = rows[headerIdx].cells.map((c) => normalizeHeader(c ? c.text : ''));
    const index = new Map();
    headers.forEach((h, i) => { if (h && !index.has(h)) index.set(h, i); });
    const missing = COLUMNS.filter(([col]) => !index.has(col)).map(([col]) => COLUMN_LABEL.get(col));
    if (missing.length) {
        return { records: [], errors: [`Thiếu cột: ${missing.join(', ')}. Hãy dùng đúng tiêu đề cột như file mẫu mau_import_ksk.xlsx.`] };
    }

    const records = [];
    const seen = new Map();
    for (const row of rows.slice(headerIdx + 1)) {
        if (isBlank(row)) continue;
        const line = row.number;
        const rec = { blood_tests: {} };
        const rowErrors = [];

        for (const [col, path] of COLUMNS) {
            const cell = row.cells[index.get(col)] || { text: '' };
            let value = String(cell.text ?? '').normalize('NFC').trim();

            if (col === 'ngày_sinh') {
                // Ô ngày của Excel lưu dạng số serial -> đổi lại thành ngày
                if (cell.numeric && (cell.dateFormatted || /^\d{1,5}(\.\d+)?$/.test(value))) value = excelSerialToDate(value) || value;
            } else if (col === 'mã_nhân_viên') {
                if (cell.numeric) rowErrors.push(`mã nhân viên "${value}" đang lưu dạng số trong Excel (có thể đã mất số 0 ở đầu). Định dạng cột là Text rồi nhập lại`);
            } else if (cell.dateFormatted) {
                const shown = excelSerialToDate(value) || value;
                rowErrors.push(`cột "${COLUMN_LABEL.get(col)}" bị Excel tự đổi thành ngày (${shown}). Định dạng cột là Text rồi nhập lại giá trị gốc (vd 10/10)`);
                value = '';
            }
            setPath(rec, path, value);
        }
        rec.employee_code = rec.employee_code.toUpperCase();

        if (!rec.full_name) rowErrors.push('thiếu họ và tên');
        if (!EMPLOYEE_CODE_RE.test(rec.employee_code)) rowErrors.push(`mã nhân viên "${rec.employee_code}" không hợp lệ (chỉ chữ/số, tối đa 20 ký tự)`);
        const dob = normalizeDob(rec.dob);
        if (!dob) rowErrors.push(`ngày sinh "${rec.dob}" không hợp lệ (nhập dd/mm/yyyy hoặc ddmmyyyy)`);
        else rec.dob = dob;
        if (rec.employee_code && seen.has(rec.employee_code)) rowErrors.push(`trùng mã nhân viên với dòng ${seen.get(rec.employee_code)}`);
        seen.set(rec.employee_code, line);

        if (rowErrors.length) errors.push(`Dòng ${line}: ${rowErrors.join('; ')}`);
        else records.push(rec);
    }
    if (!records.length && !errors.length) errors.push('File không có dòng dữ liệu nào.');
    return { records, errors };
}

function xlsxToRecords(buffer) {
    try {
        return rowsToRecords(readXlsxRows(buffer));
    } catch (err) {
        return { records: [], errors: [`Không đọc được file Excel: ${err.message}`] };
    }
}

/** Nhận file tải lên (Buffer). Chỉ chấp nhận Excel .xlsx. */
function fileToRecords(buffer) {
    if (!isXlsx(buffer)) {
        return { records: [], errors: ['Chỉ nhận file Excel .xlsx (dùng file mẫu mau_import_ksk.xlsx). Nếu đang có file .xls hoặc .csv, hãy mở bằng Excel rồi chọn Lưu thành > Excel Workbook (*.xlsx).'] };
    }
    return xlsxToRecords(buffer);
}

module.exports = { COLUMNS, EMPLOYEE_CODE_RE, normalizeHeader, normalizeDob, rowsToRecords, xlsxToRecords, fileToRecords };
