'use strict';
/**
 * Đọc sheet đầu tiên của file Excel .xlsx, không cần thư viện ngoài
 * (dùng zlib có sẵn của Node để giải nén).
 *
 * Trả về mảng { number, cells } (number = số dòng thật trong Excel);
 * mỗi ô là { text, numeric, dateFormatted }:
 *   - text:          giá trị dạng chuỗi như lưu trong file
 *   - numeric:       ô kiểu số (không phải chữ)
 *   - dateFormatted: ô số mang định dạng ngày/giờ, tức là Excel đã tự đổi
 *                    nội dung gõ vào (vd "10/10") thành ngày
 */
const zlib = require('node:zlib');

const MAX_UNCOMPRESSED = 100 * 1024 * 1024;

function isXlsx(buffer) {
    return buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

/** Giải nén các file cần thiết từ ZIP (đọc qua central directory). */
function unzip(buffer) {
    let eocd = -1;
    for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('File Excel bị hỏng (không đọc được cấu trúc ZIP).');

    const count = buffer.readUInt16LE(eocd + 10);
    let p = buffer.readUInt32LE(eocd + 16);
    const files = new Map();
    let total = 0;

    for (let n = 0; n < count; n++) {
        if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('File Excel bị hỏng.');
        const method = buffer.readUInt16LE(p + 10);
        const compSize = buffer.readUInt32LE(p + 20);
        const size = buffer.readUInt32LE(p + 24);
        const nameLen = buffer.readUInt16LE(p + 28);
        const extraLen = buffer.readUInt16LE(p + 30);
        const commentLen = buffer.readUInt16LE(p + 32);
        const localOffset = buffer.readUInt32LE(p + 42);
        const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
        p += 46 + nameLen + extraLen + commentLen;

        if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|styles\.xml|_rels\/workbook\.xml\.rels|worksheets\/[^/]+\.xml))$/.test(name)) continue;
        total += size;
        if (total > MAX_UNCOMPRESSED) throw new Error('File Excel quá lớn.');

        const lh = localOffset;
        const dataStart = lh + 30 + buffer.readUInt16LE(lh + 26) + buffer.readUInt16LE(lh + 28);
        const raw = buffer.subarray(dataStart, dataStart + compSize);
        let data;
        if (method === 0) data = raw;
        else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNCOMPRESSED });
        else throw new Error('File Excel dùng kiểu nén không hỗ trợ.');
        files.set(name, data.toString('utf8'));
    }
    return files;
}

function decodeXml(s) {
    return s
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Nối mọi <t>...</t> trong một khối (chuỗi thường hoặc rich text). */
function textOf(xml) {
    let out = '';
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? decodeXml(m[1]) : '';
    return out;
}

function attr(tag, name) {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? m[1] : null;
}

function colIndex(ref) {
    const letters = ref.match(/^[A-Z]+/)[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** Danh sách chỉ số style (s="...") có định dạng ngày/giờ. */
function dateStyleSet(stylesXml) {
    const builtinDate = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
    const custom = new Map();
    for (const m of stylesXml.matchAll(/<numFmt\s[^>]*>/g)) {
        const id = Number(attr(m[0], 'numFmtId'));
        const code = decodeXml(attr(m[0], 'formatCode') || '');
        // Bỏ phần trong ngoặc kép/vuông rồi xem có ký hiệu ngày/giờ không
        const bare = code.replace(/"[^"]*"|\[[^\]]*\]/g, '');
        custom.set(id, /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare));
    }
    const set = new Set();
    const cellXfs = stylesXml.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
    if (!cellXfs) return set;
    let i = 0;
    for (const m of cellXfs[0].matchAll(/<xf\s[^>]*?(?:\/>|>)/g)) {
        const id = Number(attr(m[0], 'numFmtId') || 0);
        if (builtinDate.has(id) || custom.get(id)) set.add(i);
        i++;
    }
    return set;
}

function firstSheetPath(files) {
    const wb = files.get('xl/workbook.xml') || '';
    const sheet = wb.match(/<sheet\s[^>]*>/);
    const rels = files.get('xl/_rels/workbook.xml.rels') || '';
    if (sheet) {
        const rid = attr(sheet[0], 'r:id');
        for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
            if (attr(m[0], 'Id') === rid) {
                const target = attr(m[0], 'Target').replace(/^\/?xl\//, '').replace(/^\//, '');
                return 'xl/' + target;
            }
        }
    }
    return 'xl/worksheets/sheet1.xml';
}

function readXlsxRows(buffer) {
    const files = unzip(buffer);
    const sheetXml = files.get(firstSheetPath(files));
    if (!sheetXml) throw new Error('Không tìm thấy sheet dữ liệu trong file Excel.');

    const shared = [];
    for (const m of (files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
    const dateStyles = dateStyleSet(files.get('xl/styles.xml') || '');

    const rows = [];
    for (const rm of sheetXml.matchAll(/(<row\b[^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const row = [];
        const rowNumber = Number(attr(rm[1] + '>', 'r')) || rows.length + 1;
        for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const tag = `<c${cm[1]}>`;
            const body = cm[2] || '';
            const ref = attr(tag, 'r');
            const type = attr(tag, 't') || 'n';
            const style = Number(attr(tag, 's') || 0);
            const v = body.match(/<v>([\s\S]*?)<\/v>/);
            let cell;
            if (type === 's') cell = { text: v ? shared[Number(v[1])] ?? '' : '', numeric: false };
            else if (type === 'inlineStr') cell = { text: textOf(body), numeric: false };
            else if (type === 'str' || type === 'e') cell = { text: v ? decodeXml(v[1]) : '', numeric: false };
            else if (type === 'b') cell = { text: v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : '', numeric: false };
            else cell = { text: v ? v[1] : '', numeric: Boolean(v), dateFormatted: Boolean(v) && dateStyles.has(style) };
            const idx = ref ? colIndex(ref) : row.length;
            while (row.length < idx) row.push({ text: '', numeric: false });
            row[idx] = cell;
        }
        rows.push({ number: rowNumber, cells: row });
    }
    return rows;
}

/** Số serial ngày của Excel (hệ 1900) -> DD/MM/YYYY. */
function excelSerialToDate(serial) {
    const n = Math.floor(Number(serial));
    if (!Number.isFinite(n) || n < 1) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86_400_000);
    const p = (x) => String(x).padStart(2, '0');
    return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

module.exports = { isXlsx, readXlsxRows, excelSerialToDate };
