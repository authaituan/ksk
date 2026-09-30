/**
 * KSK - Trang tra cứu kết quả khám sức khỏe (phía trình duyệt).
 *
 * Trình duyệt KHÔNG giữ dữ liệu nào. Mọi xác thực diễn ra trên máy chủ qua
 * POST /api/lookup; máy chủ chỉ trả về đúng 1 hồ sơ khi xác thực đúng.
 * Mọi dữ liệu hiển thị đều gán qua textContent (không dùng innerHTML).
 */
'use strict';

const $ = (id) => document.getElementById(id);

const el = {
    form: $('lookupForm'),
    inputEmployeeCode: $('inputEmployeeCode'),
    inputDob: $('inputDob'),
    inputPin: $('inputPin'),
    btnSubmit: $('btnSubmitLookup'),
    formMessage: $('formMessage'),

    resultContainer: $('resultContainer'),
    btnToggleMask: $('btnToggleMask'),
    iconMask: $('iconMask'),
    textMask: $('textMask'),
    btnPdf: $('btnDownloadPdf'),
    textPdf: $('textPdf'),
    btnClose: $('btnCloseResult'),
    toastContainer: $('toastContainer')
};

const state = {
    record: null,
    masked: true
};

const EMPTY = '—';
const show = (v) => (v === undefined || v === null || String(v).trim() === '' ? EMPTY : String(v));

function setText(id, value) {
    $(id).textContent = value;
}

/* --------------------------------------------------------------------------
   Che thông tin định danh khi xem trên màn hình (mặc định bật)
   -------------------------------------------------------------------------- */
function maskCode(code) {
    if (!code || code.length < 4) return code || EMPTY;
    return code.slice(0, 4) + '*'.repeat(code.length - 4);
}

/** Giữ chữ cái đầu mỗi từ: "Bộ phận A" -> "B* p** A". keepFirstWord: giữ nguyên từ đầu (họ). */
function maskWords(text, keepFirstWord = false) {
    if (!text || !String(text).trim()) return EMPTY;
    return String(text).trim().split(/\s+/).map((w, i) => {
        if (keepFirstWord && i === 0) return w;
        const chars = Array.from(w);
        return chars[0] + '*'.repeat(chars.length - 1);
    }).join(' ');
}

// Ngày sinh: chỉ giữ năm sinh, vd 15/06/1995 thành dạng sao-sao/sao-sao/1995
function maskDob(dob) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dob || '');
    return m ? `**/**/${m[3]}` : show(dob);
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElement('i');
    icon.className = type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation';
    const span = document.createElement('span');
    span.textContent = message;
    toast.append(icon, ' ', span);
    el.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function showFormMessage(message) {
    el.formMessage.textContent = message;
    el.formMessage.hidden = !message;
}

/* --------------------------------------------------------------------------
   Kiểm tra định dạng phía trình duyệt (chỉ để báo lỗi sớm; máy chủ kiểm tra lại)
   -------------------------------------------------------------------------- */
function validateInput(code, dob, pin) {
    if (!/^[A-Za-z0-9]{1,20}$/.test(code)) return 'Mã nhân viên không hợp lệ.';
    if (!/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(dob) && !/^\d{8}$/.test(dob)) return 'Ngày sinh nhập dạng 01/01/1990 hoặc 01011990.';
    if (!/^\d{6}$/.test(pin)) return 'Mã PIN gồm đúng 6 chữ số.';
    return '';
}

async function handleSubmit(event) {
    event.preventDefault();
    showFormMessage('');

    const employee_code = el.inputEmployeeCode.value.trim();
    const dob = el.inputDob.value.trim();
    const pin = el.inputPin.value.trim();

    const invalid = validateInput(employee_code, dob, pin);
    if (invalid) {
        showFormMessage(invalid);
        return;
    }

    el.btnSubmit.disabled = true;
    try {
        const res = await fetch('/api/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify({ employee_code, dob, pin })
        });
        let data = {};
        try { data = await res.json(); } catch (_) { /* ignore */ }

        if (res.ok && data.record) {
            el.inputPin.value = '';
            renderRecord(data.record);
            showToast('Xác thực thành công.');
        } else {
            closeResult();
            el.inputPin.value = '';
            showFormMessage(data.message || 'Không tra cứu được. Vui lòng thử lại sau.');
        }
    } catch (_) {
        showFormMessage('Không kết nối được máy chủ. Vui lòng thử lại sau.');
    } finally {
        el.btnSubmit.disabled = false;
    }
}

/* --------------------------------------------------------------------------
   Hiển thị hồ sơ. Trường trống hiển thị "—", KHÔNG tự điền giá trị mặc định.
   -------------------------------------------------------------------------- */
function renderRecord(r) {
    state.record = r;
    state.masked = true;
    const b = r.blood_tests || {};

    setText('resStt', r.stt ? `STT khám: #${r.stt}` : '');
    // Họ tên, ngày sinh, mã HRM, bộ phận, đơn vị: gán trong updateMask()
    setText('resGender', show(r.gender));
    setText('resJobTitle', show(r.job_title));
    setText('resHealthClassSeal', show(r.health_class).toUpperCase());

    setText('resBodyStat', `${show(r.height)} cm / ${show(r.weight)} kg`);
    setText('resPhysicalBp', `Thể lực: ${show(r.physical)} | HA: ${show(r.blood_pressure)} mmHg`);
    setText('resVision', `Phải: ${show(r.vision_right)} | Trái: ${show(r.vision_left)} | Bệnh mắt: ${show(r.vision_disease)}`);
    setText('resEntDental', `TMH: ${show(r.ent)} | RHM: ${show(r.dental)}`);
    setText('resClinicalOther', `Nội da liễu: ${show(r.dermatology)} | Ngoại: ${show(r.surgery)} | X-Quang: ${show(r.xray)} | Phụ khoa: ${show(r.gynecology)}`);
    setText('resUltrasound', show(r.ultrasound));

    setText('labCtm', show(b.ctm));
    setText('labUrine', show(b.urine));
    setText('labAcidUric', show(b.acid_uric));
    setText('labCreatinin', show(b.creatinin));
    setText('labGlucose', show(b.glucose));
    setText('labUre', show(b.ure));
    setText('labSgot', show(b.sgot));
    setText('labSgpt', show(b.sgpt));
    setText('labTriglycerides', show(b.triglycerides));
    setText('labCholesterol', show(b.cholesterol));
    setText('labGgt', show(b.ggt));
    setText('labMorphin', show(b.morphin));

    setText('resHealthClass', show(r.health_class));
    setText('resConclusion', show(r.conclusion));
    setText('resMedicalAdvice', show(r.medical_advice));

    updateMask();
    el.resultContainer.hidden = false;
    el.resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateMask() {
    const r = state.record;
    if (!r) return;
    const m = state.masked;
    setText('resEmployeeCode', m ? maskCode(r.employee_code) : show(r.employee_code));
    setText('resFullName', m ? maskWords(r.full_name, true) : show(r.full_name));
    setText('resDob', m ? maskDob(r.dob) : show(r.dob));
    setText('resDepartment', m ? maskWords(r.department) : show(r.department));
    setText('resUnitName', m ? maskWords(r.unit_name) : show(r.unit_name));
    el.iconMask.className = m ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    el.textMask.textContent = m ? 'Hiện đầy đủ thông tin' : 'Ẩn bớt thông tin';
}

/* --------------------------------------------------------------------------
   Tải PDF (A4 ngang). Thư viện nằm sẵn trong public/vendor, chỉ nạp khi bấm nút.
   Phiếu được dựng lại ở bề rộng cố định khổ ngang rồi chụp từng khối
   (đầu phiếu, mục 1, mục 2, mục 3): khối nào không vừa trang mới sang trang
   mới, nên không bao giờ có trang trắng và không cắt ngang bảng.
   -------------------------------------------------------------------------- */
const PDF_STAGE_WIDTH = 1400; // px, tỉ lệ khớp A4 ngang

function loadScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('Không tải được ' + src));
        document.head.appendChild(s);
    });
}

async function ensurePdfLibs() {
    if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
    if (!window.html2canvas) await loadScript('vendor/html2canvas.min.js');
}

/** Chia phiếu thành các khối: [đầu phiếu + thông tin người], [tiêu đề mục + nội dung]... */
function buildPdfStage() {
    const stage = document.createElement('div');
    stage.className = 'pdf-stage';
    const receipt = $('printableReceipt').cloneNode(true);
    receipt.removeAttribute('id');
    receipt.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    receipt.classList.add('pdf-mode');
    stage.appendChild(receipt);

    const children = Array.from(receipt.children);
    receipt.replaceChildren();
    let group = null;
    const newGroup = () => { group = document.createElement('div'); group.className = 'pdf-block'; receipt.appendChild(group); };
    children.forEach((child, i) => {
        const startsGroup = i === 0 || child.classList.contains('section-title');
        if (startsGroup || !group) newGroup();
        group.appendChild(child);
    });
    // Chân phiếu đi cùng mục cuối
    document.body.appendChild(stage);
    return stage;
}

async function downloadPdf() {
    if (!state.record) return;
    el.btnPdf.disabled = true;
    el.textPdf.textContent = 'Đang tạo PDF...';
    let stage;
    try {
        await ensurePdfLibs();
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        stage = buildPdfStage();

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
        const pageW = pdf.internal.pageSize.getWidth();   // 297
        const pageH = pdf.internal.pageSize.getHeight();  // 210
        const margin = 10;
        const usableW = pageW - margin * 2;
        const usableH = pageH - margin * 2;
        const mmPerPx = usableW / PDF_STAGE_WIDTH;

        let y = margin;
        let pageHasContent = false;
        for (const block of stage.querySelectorAll('.pdf-block')) {
            const canvas = await window.html2canvas(block, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: false });
            let wMm = usableW;
            let hMm = (canvas.height / 2) * mmPerPx;
            if (hMm > usableH) { // khối cao hơn cả trang: thu nhỏ cho vừa 1 trang
                wMm = wMm * (usableH / hMm);
                hMm = usableH;
            }
            if (pageHasContent && y + hMm > pageH - margin) {
                pdf.addPage();
                y = margin;
            }
            pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, y, wMm, hMm);
            y += hMm + 3;
            pageHasContent = true;
        }

        const code = state.masked ? '' : `-${state.record.employee_code}`;
        pdf.save(`Ket-qua-kham-suc-khoe${code}.pdf`);
        showToast('Đã tải file PDF.');
    } catch (err) {
        console.error(err);
        showToast('Không tạo được file PDF. Vui lòng thử lại.', 'danger');
    } finally {
        if (stage) stage.remove();
        el.btnPdf.disabled = false;
        el.textPdf.textContent = 'Tải PDF';
    }
}

/** Xóa hồ sơ khỏi màn hình và bộ nhớ trang (dùng cho máy tính dùng chung). */
function closeResult() {
    state.record = null;
    el.resultContainer.hidden = true;
    // Chỉ xóa các ô dữ liệu (phần tử lá), không xóa khung chứa.
    el.resultContainer.querySelectorAll('[id^="res"], [id^="lab"]').forEach((node) => {
        if (node.children.length === 0) node.textContent = '';
    });
}

/** 01011990 -> 01/01/1990 khi rời ô nhập (máy chủ cũng chấp nhận cả hai dạng). */
el.inputDob.addEventListener('blur', () => {
    const v = el.inputDob.value.trim();
    if (/^\d{8}$/.test(v)) el.inputDob.value = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
});

el.form.addEventListener('submit', handleSubmit);
el.form.addEventListener('reset', () => { showFormMessage(''); closeResult(); });
el.btnToggleMask.addEventListener('click', () => { state.masked = !state.masked; updateMask(); });
el.btnPdf.addEventListener('click', downloadPdf);
el.btnClose.addEventListener('click', () => {
    closeResult();
    el.form.reset();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
