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
    btnPrint: $('btnPrintResult'),
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

function maskCode(code) {
    if (!code || code.length < 4) return code || EMPTY;
    return code.slice(0, 4) + '*'.repeat(code.length - 4);
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
    setText('resFullName', show(r.full_name));
    setText('resGender', show(r.gender));
    setText('resDob', show(r.dob));
    setText('resJobTitle', show(r.job_title));
    setText('resDepartment', show(r.department));
    setText('resUnitName', show(r.unit_name));
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
    if (!state.record) return;
    const code = state.record.employee_code;
    setText('resEmployeeCode', state.masked ? maskCode(code) : show(code));
    el.iconMask.className = state.masked ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    el.textMask.textContent = state.masked ? 'Hiện đầy đủ mã nhân viên' : 'Ẩn bớt mã nhân viên';
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
el.btnPrint.addEventListener('click', () => window.print());
el.btnClose.addEventListener('click', () => {
    closeResult();
    el.form.reset();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});
