/**
 * VNPOSTAL WORKER HEALTH LOOKUP SYSTEM & CMS - MAIN JAVASCRIPT
 */

// Initial Seed Dataset based on VNPost worker health examination Excel format
const DEFAULT_DATASET = [
    {
        stt: 353,
        full_name: "EO CHANG HY",
        hrm_code: "00269118",
        gender: "Nam",
        dob: "09/10/1992",
        job_title: "205 - Nhân viên kinh doanh",
        post_office: "An Dương Vương",
        unit_name: "Bưu điện phường ABC",
        height: "157",
        weight: "58",
        physical: "2",
        blood_pressure: "110/70",
        vision_right: "10/10",
        vision_left: "10/10",
        vision_disease: "BT",
        ent: "BT",
        dental: "BT",
        dermatology: "BT",
        surgery: "BT",
        xray: "BT",
        ultrasound: "Polype túi mật",
        gynecology: "",
        blood_tests: {
            ctm: "BT",
            urine: "BT",
            acid_uric: "385",
            creatinin: "87",
            glucose: "5.3",
            ure: "5.5",
            sgot: "18",
            sgpt: "19",
            triglycerides: "1.8",
            cholesterol: "5.6",
            ggt: "29",
            morphin: "ÂM TÍNH"
        },
        health_class: "Loại II",
        conclusion: "Hiện tại đủ sức khỏe để làm việc",
        medical_advice: "Polype túi mật -> ĐN khám và điều trị"
    },
    {
        stt: 354,
        full_name: "Nguyễn Văn An",
        hrm_code: "00109012",
        gender: "Nam",
        dob: "15/08/1990",
        job_title: "102 - Bưu tá giao nhận",
        post_office: "Thăng Long",
        unit_name: "Bưu điện Cầu Giấy",
        height: "168",
        weight: "62",
        physical: "1",
        blood_pressure: "120/80",
        vision_right: "10/10",
        vision_left: "10/10",
        vision_disease: "BT",
        ent: "BT",
        dental: "BT",
        dermatology: "BT",
        surgery: "BT",
        xray: "BT",
        ultrasound: "Bình thường",
        gynecology: "",
        blood_tests: {
            ctm: "BT", urine: "BT", acid_uric: "340", creatinin: "82",
            glucose: "5.1", ure: "5.0", sgot: "20", sgpt: "21",
            triglycerides: "1.5", cholesterol: "5.1", ggt: "22", morphin: "ÂM TÍNH"
        },
        health_class: "Loại I",
        conclusion: "Hiện tại đủ sức khỏe làm việc",
        medical_advice: "Theo dõi sức khỏe định kỳ"
    },
    {
        stt: 355,
        full_name: "Trần Thị Mai",
        hrm_code: "00361956",
        gender: "Nữ",
        dob: "20/03/1995",
        job_title: "301 - Giao dịch viên",
        post_office: "Nguyễn Huệ",
        unit_name: "Bưu điện Quận 1",
        height: "158",
        weight: "50",
        physical: "2",
        blood_pressure: "115/75",
        vision_right: "8/10",
        vision_left: "9/10",
        vision_disease: "Cận nhẹ",
        ent: "BT",
        dental: "BT",
        dermatology: "BT",
        surgery: "BT",
        xray: "BT",
        ultrasound: "Bình thường",
        gynecology: "BT",
        blood_tests: {
            ctm: "BT", urine: "BT", acid_uric: "290", creatinin: "75",
            glucose: "4.8", ure: "4.6", sgot: "16", sgpt: "15",
            triglycerides: "1.4", cholesterol: "4.9", ggt: "18", morphin: "ÂM TÍNH"
        },
        health_class: "Loại II",
        conclusion: "Hiện tại đủ sức khỏe làm việc",
        medical_advice: "Khám mắt định kỳ đo độ cận"
    },
    {
        stt: 356,
        full_name: "Lê Hoàng Nam",
        hrm_code: "00400889",
        gender: "Nam",
        dob: "10/11/1988",
        job_title: "202 - Chuyên viên CNTT",
        post_office: "Hải Châu",
        unit_name: "Bưu điện TP Đà Nẵng",
        height: "172",
        weight: "70",
        physical: "1",
        blood_pressure: "125/82",
        vision_right: "10/10",
        vision_left: "10/10",
        vision_disease: "BT",
        ent: "BT",
        dental: "BT",
        dermatology: "BT",
        surgery: "BT",
        xray: "BT",
        ultrasound: "Bình thường",
        gynecology: "",
        blood_tests: {
            ctm: "BT", urine: "BT", acid_uric: "410", creatinin: "90",
            glucose: "5.6", ure: "5.8", sgot: "24", sgpt: "28",
            triglycerides: "2.1", cholesterol: "5.8", ggt: "35", morphin: "ÂM TÍNH"
        },
        health_class: "Loại II",
        conclusion: "Đủ điều kiện làm việc",
        medical_advice: "Chế độ ăn giảm Axit Uric và mỡ máu"
    }
];

// App State Management
const STATE = {
    records: [],
    searchMode: "hrm", // "hrm" (Mã HRM + Ngày Sinh) or "name" (Họ Tên + Ngày Sinh)
    currentMatchedRecord: null,
    isMaskedResult: true,
    isCmsMasked: false,
    stagedImportData: [],
    captchaAnswer: ""
};

// DOM Elements
const el = {
    // Navigation
    navBtns: document.querySelectorAll('.nav-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    
    // Lookup Form
    lookupForm: document.getElementById('lookupForm'),
    modeLookupHrm: document.getElementById('modeLookupHrm'),
    modeLookupName: document.getElementById('modeLookupName'),
    labelField1: document.getElementById('labelField1'),
    inputField1: document.getElementById('inputField1'),
    helpField1: document.getElementById('helpField1'),
    inputDob: document.getElementById('inputDob'),
    captchaCode: document.getElementById('captchaCode'),
    inputCaptcha: document.getElementById('inputCaptcha'),
    btnRefreshCaptcha: document.getElementById('btnRefreshCaptcha'),

    // Result View
    resultContainer: document.getElementById('resultContainer'),
    resultSuccessCard: document.getElementById('resultSuccessCard'),
    resultErrorCard: document.getElementById('resultErrorCard'),
    errorMessageText: document.getElementById('errorMessageText'),
    btnToggleMask: document.getElementById('btnToggleMask'),
    textMask: document.getElementById('textMask'),
    iconMask: document.getElementById('iconMask'),
    btnPrintResult: document.getElementById('btnPrintResult'),
    btnRetrySearch: document.getElementById('btnRetrySearch'),

    // Result Fields
    resHrmCode: document.getElementById('resHrmCode'),
    resUpdatedDate: document.getElementById('resUpdatedDate'),
    resFullName: document.getElementById('resFullName'),
    resGender: document.getElementById('resGender'),
    resDob: document.getElementById('resDob'),
    resJobTitle: document.getElementById('resJobTitle'),
    resPostOffice: document.getElementById('resPostOffice'),
    resUnitName: document.getElementById('resUnitName'),
    resHealthClassSeal: document.getElementById('resHealthClassSeal'),
    resBodyStat: document.getElementById('resBodyStat'),
    resPhysicalBp: document.getElementById('resPhysicalBp'),
    resVision: document.getElementById('resVision'),
    resEntDental: document.getElementById('resEntDental'),
    resClinicalOther: document.getElementById('resClinicalOther'),
    resUltrasound: document.getElementById('resUltrasound'),

    // Lab Test Cells
    labCtm: document.getElementById('labCtm'),
    labUrine: document.getElementById('labUrine'),
    labAcidUric: document.getElementById('labAcidUric'),
    labCreatinin: document.getElementById('labCreatinin'),
    labGlucose: document.getElementById('labGlucose'),
    labUre: document.getElementById('labUre'),
    labSgot: document.getElementById('labSgot'),
    labSgpt: document.getElementById('labSgpt'),
    labTriglycerides: document.getElementById('labTriglycerides'),
    labCholesterol: document.getElementById('labCholesterol'),
    labGgt: document.getElementById('labGgt'),
    labMorphin: document.getElementById('labMorphin'),

    // Conclusion Fields
    resHealthClass: document.getElementById('resHealthClass'),
    resConclusion: document.getElementById('resConclusion'),
    resMedicalAdvice: document.getElementById('resMedicalAdvice'),

    // CMS View
    statTotalRecords: document.getElementById('statTotalRecords'),
    statCompletedRecords: document.getElementById('statCompletedRecords'),
    statLastImport: document.getElementById('statLastImport'),
    mainTableBody: document.getElementById('mainTableBody'),
    filterInput: document.getElementById('filterInput'),
    btnToggleCmsMask: document.getElementById('btnToggleCmsMask'),
    textCmsMask: document.getElementById('textCmsMask'),
    iconCmsMask: document.getElementById('iconCmsMask'),
    btnOpenAddModal: document.getElementById('btnOpenAddModal'),
    btnResetDefaultData: document.getElementById('btnResetDefaultData'),
    btnDownloadSampleCsv: document.getElementById('btnDownloadSampleCsv'),
    
    // Import
    csvDropzone: document.getElementById('csvDropzone'),
    fileCsvInput: document.getElementById('fileCsvInput'),
    btnSelectFile: document.getElementById('btnSelectFile'),
    importPreviewArea: document.getElementById('importPreviewArea'),
    importCount: document.getElementById('importCount'),
    tbodyPreview: document.getElementById('tbodyPreview'),
    btnConfirmImport: document.getElementById('btnConfirmImport'),
    btnCancelImport: document.getElementById('btnCancelImport'),

    // Modal
    modalRecord: document.getElementById('modalRecord'),
    modalTitle: document.getElementById('modalTitle'),
    btnCloseModal: document.getElementById('btnCloseModal'),
    btnCancelModal: document.getElementById('btnCancelModal'),
    recordForm: document.getElementById('recordForm'),
    editOriginalHrm: document.getElementById('editOriginalHrm'),
    mStt: document.getElementById('mStt'),
    mFullName: document.getElementById('mFullName'),
    mHrmCode: document.getElementById('mHrmCode'),
    mGender: document.getElementById('mGender'),
    mDob: document.getElementById('mDob'),
    mJobTitle: document.getElementById('mJobTitle'),
    mPostOffice: document.getElementById('mPostOffice'),
    mUnitName: document.getElementById('mUnitName'),
    mHeight: document.getElementById('mHeight'),
    mWeight: document.getElementById('mWeight'),
    mBp: document.getElementById('mBp'),
    mUltrasound: document.getElementById('mUltrasound'),
    mHealthClass: document.getElementById('mHealthClass'),
    mConclusion: document.getElementById('mConclusion'),
    mMedicalAdvice: document.getElementById('mMedicalAdvice'),

    // Downloads
    btnDownloadAdvCsv: document.getElementById('btnDownloadAdvCsv'),
    btnDownloadJsonSchema: document.getElementById('btnDownloadJsonSchema')
};

/* ==========================================================================
   INITIALIZATION & DATA PERSISTENCE
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    loadDatabase();
    generateCaptcha();
    setupEventListeners();
    renderCmsTable();
    updateCmsStats();
});

function loadDatabase() {
    const saved = localStorage.getItem('vnpost_health_records');
    if (saved) {
        try {
            STATE.records = JSON.parse(saved);
        } catch (e) {
            console.error("Error parsing saved DB:", e);
            STATE.records = [...DEFAULT_DATASET];
            saveDatabase();
        }
    } else {
        STATE.records = [...DEFAULT_DATASET];
        saveDatabase();
    }
}

function saveDatabase() {
    localStorage.setItem('vnpost_health_records', JSON.stringify(STATE.records));
    renderCmsTable();
    updateCmsStats();
}

/* ==========================================================================
   HELPERS & DATA MASKING
   ========================================================================== */
function maskHrm(hrm) {
    if (!hrm || hrm.length < 4) return hrm;
    const clean = hrm.trim();
    return clean.substring(0, 4) + '****';
}

function generateCaptcha() {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    STATE.captchaAnswer = code;
    if (el.captchaCode) {
        el.captchaCode.textContent = code.split('').join(' ');
    }
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconClass = 'fa-circle-check';
    if (type === 'danger') iconClass = 'fa-circle-exclamation';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

/* ==========================================================================
   EVENT LISTENERS & TAB NAVIGATION
   ========================================================================== */
function setupEventListeners() {
    // Navigation Tabs
    el.navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            el.navBtns.forEach(b => b.classList.remove('active'));
            el.tabPanes.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // Search Mode Switching
    el.modeLookupHrm.addEventListener('click', () => {
        STATE.searchMode = "hrm";
        el.modeLookupHrm.classList.add('active');
        el.modeLookupName.classList.remove('active');
        el.labelField1.innerHTML = 'Mã HRM Nhân Viên <span class="req">*</span>';
        el.inputField1.placeholder = 'Ví dụ: 00269118';
        el.helpField1.textContent = 'Mã nhân viên HRM gồm 8 chữ số trên phần mềm Bưu điện';
    });

    el.modeLookupName.addEventListener('click', () => {
        STATE.searchMode = "name";
        el.modeLookupName.classList.add('active');
        el.modeLookupHrm.classList.remove('active');
        el.labelField1.innerHTML = 'Họ Và Tên Lao Động <span class="req">*</span>';
        el.inputField1.placeholder = 'Ví dụ: EO CHANG HY hoặc Nguyễn Văn An';
        el.helpField1.textContent = 'Nhập chính xác họ tên có dấu hoặc không dấu';
    });

    // Captcha Refresh
    el.btnRefreshCaptcha.addEventListener('click', generateCaptcha);

    // Lookup Form Submission
    el.lookupForm.addEventListener('submit', handleLookupSubmit);

    // Toggle Masking in Result View
    el.btnToggleMask.addEventListener('click', () => {
        STATE.isMaskedResult = !STATE.isMaskedResult;
        updateMaskedDisplay();
    });

    // Print Result
    el.btnPrintResult.addEventListener('click', () => {
        window.print();
    });

    // Retry Search Button
    el.btnRetrySearch.addEventListener('click', () => {
        el.resultContainer.style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // CMS Data Table Masking Toggle
    el.btnToggleCmsMask.addEventListener('click', () => {
        STATE.isCmsMasked = !STATE.isCmsMasked;
        if (STATE.isCmsMasked) {
            el.iconCmsMask.className = 'fa-solid fa-eye-slash';
            el.textCmsMask.textContent = 'Hiện đầy đủ mã HRM';
        } else {
            el.iconCmsMask.className = 'fa-solid fa-eye';
            el.textCmsMask.textContent = 'Ẩn mờ mã HRM';
        }
        renderCmsTable();
    });

    // CMS Filter Input
    el.filterInput.addEventListener('input', () => {
        renderCmsTable(el.filterInput.value.trim());
    });

    // Modal Trigger
    el.btnOpenAddModal.addEventListener('click', () => {
        openModal();
    });
    el.btnCloseModal.addEventListener('click', closeModal);
    el.btnCancelModal.addEventListener('click', closeModal);
    el.recordForm.addEventListener('submit', handleRecordFormSubmit);

    // Reset Default Data
    el.btnResetDefaultData.addEventListener('click', () => {
        if (confirm("Khôi phục danh sách khám sức khỏe Bưu điện mẫu ban đầu? Mọi dữ liệu sửa đổi sẽ được đưa về chuẩn.")) {
            STATE.records = [...DEFAULT_DATASET];
            saveDatabase();
            showToast("Đã khôi phục danh sách mẫu thành công!");
        }
    });

    // CSV File Select & Dropzone
    el.btnSelectFile.addEventListener('click', () => el.fileCsvInput.click());
    el.csvDropzone.addEventListener('click', (e) => {
        if (e.target !== el.btnSelectFile && !el.btnSelectFile.contains(e.target)) {
            el.fileCsvInput.click();
        }
    });

    el.fileCsvInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            processCsvFile(e.target.files[0]);
        }
    });

    // Drag and Drop CSV
    el.csvDropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        el.csvDropzone.style.borderColor = 'var(--vnpost-yellow)';
        el.csvDropzone.style.backgroundColor = '#FFF8EE';
    });

    el.csvDropzone.addEventListener('dragleave', () => {
        el.csvDropzone.style.borderColor = 'var(--vnpost-blue)';
        el.csvDropzone.style.backgroundColor = 'var(--vnpost-blue-light)';
    });

    el.csvDropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        el.csvDropzone.style.borderColor = 'var(--vnpost-blue)';
        el.csvDropzone.style.backgroundColor = 'var(--vnpost-blue-light)';
        if (e.dataTransfer.files.length > 0) {
            processCsvFile(e.dataTransfer.files[0]);
        }
    });

    // Import Actions
    el.btnConfirmImport.addEventListener('click', commitImport);
    el.btnCancelImport.addEventListener('click', () => {
        STATE.stagedImportData = [];
        el.importPreviewArea.style.display = 'none';
        el.fileCsvInput.value = '';
    });

    // Download Sample CSV & Schema
    el.btnDownloadSampleCsv.addEventListener('click', downloadSampleCsv);
    el.btnDownloadAdvCsv.addEventListener('click', downloadSampleCsv);
    el.btnDownloadJsonSchema.addEventListener('click', downloadJsonSchema);
}

/* ==========================================================================
   LOOKUP SEARCH LOGIC
   ========================================================================== */
function handleLookupSubmit(e) {
    e.preventDefault();

    const val1 = el.inputField1.value.trim();
    const dob = el.inputDob.value.trim();
    const captchaInput = el.inputCaptcha.value.trim();

    // Verify Captcha
    if (captchaInput !== STATE.captchaAnswer) {
        showToast("Mã xác thực anti-bot không đúng! Vui lòng thử lại.", "danger");
        generateCaptcha();
        el.inputCaptcha.value = '';
        return;
    }

    // Double factor security lookup match against HRM / Name + DOB
    let matched = null;
    if (STATE.searchMode === "hrm") {
        matched = STATE.records.find(r => 
            r.hrm_code.trim() === val1 && 
            normalizeDate(r.dob) === normalizeDate(dob)
        );
    } else {
        matched = STATE.records.find(r => 
            r.full_name.toLowerCase().trim() === val1.toLowerCase() && 
            normalizeDate(r.dob) === normalizeDate(dob)
        );
    }

    generateCaptcha();
    el.inputCaptcha.value = '';

    el.resultContainer.style.display = 'block';

    if (matched) {
        STATE.currentMatchedRecord = matched;
        STATE.isMaskedResult = true;
        renderMatchedResult(matched);
        el.resultSuccessCard.style.display = 'block';
        el.resultErrorCard.style.display = 'none';
        showToast("Xác thực khớp hồ sơ khám sức khỏe thành công!");
    } else {
        STATE.currentMatchedRecord = null;
        el.resultSuccessCard.style.display = 'none';
        el.resultErrorCard.style.display = 'block';
        showToast("Không tìm thấy dữ liệu khám phù hợp!", "warning");
    }

    el.resultContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function normalizeDate(str) {
    if (!str) return '';
    return str.trim().replace(/-/g, '/');
}

function renderMatchedResult(rec) {
    el.resUpdatedDate.textContent = `STT Khám: #${rec.stt || 'N/A'}`;
    el.resFullName.textContent = rec.full_name;
    el.resGender.textContent = rec.gender || 'Nam';
    el.resDob.textContent = rec.dob;
    el.resJobTitle.textContent = rec.job_title || 'Cán bộ Bưu điện';
    el.resPostOffice.textContent = rec.post_office || 'N/A';
    el.resUnitName.textContent = rec.unit_name || 'N/A';
    el.resHealthClassSeal.textContent = (rec.health_class || 'LOẠI I').toUpperCase();

    // Clinical stats
    el.resBodyStat.textContent = `${rec.height || '157'} cm / ${rec.weight || '58'} kg`;
    el.resPhysicalBp.textContent = `Loại ${rec.physical || '1'} / ${rec.blood_pressure || '120/80'} mmHg`;
    el.resVision.textContent = `Phải: ${rec.vision_right || '10/10'} | Trái: ${rec.vision_left || '10/10'} (${rec.vision_disease || 'BT'})`;
    el.resEntDental.textContent = `TMH: ${rec.ent || 'BT'} | RHM: ${rec.dental || 'BT'}`;
    el.resClinicalOther.textContent = `Nội da liễu: ${rec.dermatology || 'BT'} | Ngoại: ${rec.surgery || 'BT'} | X-Quang: ${rec.xray || 'BT'}`;
    el.resUltrasound.textContent = rec.ultrasound || 'Bình thường';

    // Lab test values
    const b = rec.blood_tests || {};
    el.labCtm.textContent = b.ctm || 'BT';
    el.labUrine.textContent = b.urine || 'BT';
    el.labAcidUric.textContent = b.acid_uric || '-';
    el.labCreatinin.textContent = b.creatinin || '-';
    el.labGlucose.textContent = b.glucose || '-';
    el.labUre.textContent = b.ure || '-';
    el.labSgot.textContent = b.sgot || '-';
    el.labSgpt.textContent = b.sgpt || '-';
    el.labTriglycerides.textContent = b.triglycerides || '-';
    el.labCholesterol.textContent = b.cholesterol || '-';
    el.labGgt.textContent = b.ggt || '-';
    el.labMorphin.textContent = b.morphin || 'ÂM TÍNH';

    // Conclusion
    el.resHealthClass.textContent = rec.health_class || 'Loại I';
    el.resConclusion.textContent = rec.conclusion || 'Hiện tại đủ sức khỏe để làm việc';
    el.resMedicalAdvice.textContent = rec.medical_advice || 'Theo dõi sức khỏe định kỳ';

    updateMaskedDisplay();
}

function updateMaskedDisplay() {
    if (!STATE.currentMatchedRecord) return;
    const rec = STATE.currentMatchedRecord;

    if (STATE.isMaskedResult) {
        el.resHrmCode.textContent = maskHrm(rec.hrm_code);
        el.iconMask.className = 'fa-solid fa-eye';
        el.textMask.textContent = 'Hiện đầy đủ Mã HRM';
    } else {
        el.resHrmCode.textContent = rec.hrm_code;
        el.iconMask.className = 'fa-solid fa-eye-slash';
        el.textMask.textContent = 'Ẩn mờ Mã HRM (Bảo mật)';
    }
}

/* ==========================================================================
   CMS TABLE & STATS RENDER
   ========================================================================== */
function renderCmsTable(query = '') {
    let list = STATE.records;
    if (query) {
        const q = query.toLowerCase();
        list = list.filter(r => 
            r.full_name.toLowerCase().includes(q) ||
            r.hrm_code.toLowerCase().includes(q) ||
            (r.post_office && r.post_office.toLowerCase().includes(q)) ||
            (r.unit_name && r.unit_name.toLowerCase().includes(q))
        );
    }

    if (list.length === 0) {
        el.mainTableBody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align: center; color: var(--text-muted); padding: 30px;">
                    <i class="fa-solid fa-inbox" style="font-size: 2rem; margin-bottom: 8px;"></i>
                    <p>Không tìm thấy dữ liệu khám nào phù hợp.</p>
                </td>
            </tr>`;
        return;
    }

    el.mainTableBody.innerHTML = list.map((rec, index) => {
        const hrmShow = STATE.isCmsMasked ? maskHrm(rec.hrm_code) : rec.hrm_code;
        return `
            <tr>
                <td>${rec.stt || (index + 1)}</td>
                <td><code>${hrmShow}</code></td>
                <td><strong>${rec.full_name}</strong></td>
                <td>${rec.gender || 'Nam'}</td>
                <td>${rec.dob}</td>
                <td style="font-size: 0.85rem;">${rec.job_title || '-'}</td>
                <td style="font-size: 0.85rem;">${rec.post_office || '-'}<br><small class="help-text">${rec.unit_name || ''}</small></td>
                <td>${rec.blood_pressure || '-'}</td>
                <td style="font-size: 0.85rem;">${rec.ultrasound || 'BT'}</td>
                <td><span class="status-tag tag-success">${rec.health_class || 'Loại I'}</span></td>
                <td style="max-width: 220px; font-size: 0.82rem;">
                    <strong>${rec.conclusion}</strong><br>
                    <span style="color: var(--vnpost-yellow-hover);">${rec.medical_advice || ''}</span>
                </td>
                <td>
                    <div class="action-btns">
                        <button class="btn btn-sm btn-outline" onclick="editRecord('${rec.hrm_code}')" title="Sửa">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteRecord('${rec.hrm_code}')" title="Xóa">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function updateCmsStats() {
    el.statTotalRecords.textContent = STATE.records.length;
    el.statCompletedRecords.textContent = STATE.records.length;
}

/* ==========================================================================
   CMS RECORD ADD / EDIT MODAL
   ========================================================================== */
function openModal(editHrm = null) {
    if (editHrm) {
        const rec = STATE.records.find(r => r.hrm_code === editHrm);
        if (!rec) return;
        el.modalTitle.innerHTML = '<i class="fa-solid fa-user-pen text-yellow"></i> Chỉnh Sửa Hồ Sơ Khám Sức Khỏe';
        el.editOriginalHrm.value = rec.hrm_code;
        el.mStt.value = rec.stt || '';
        el.mFullName.value = rec.full_name;
        el.mHrmCode.value = rec.hrm_code;
        el.mGender.value = rec.gender || 'Nam';
        el.mDob.value = rec.dob;
        el.mJobTitle.value = rec.job_title || '';
        el.mPostOffice.value = rec.post_office || '';
        el.mUnitName.value = rec.unit_name || '';
        el.mHeight.value = rec.height || '157';
        el.mWeight.value = rec.weight || '58';
        el.mBp.value = rec.blood_pressure || '110/70';
        el.mUltrasound.value = rec.ultrasound || 'Bình thường';
        el.mHealthClass.value = rec.health_class || 'Loại I';
        el.mConclusion.value = rec.conclusion || 'Hiện tại đủ sức khỏe để làm việc';
        el.mMedicalAdvice.value = rec.medical_advice || '';
    } else {
        el.modalTitle.innerHTML = '<i class="fa-solid fa-user-plus text-yellow"></i> Thêm Hồ Sơ Khám Sức Khỏe Mới';
        el.recordForm.reset();
        el.editOriginalHrm.value = '';
        el.mStt.value = 353 + STATE.records.length;
    }
    el.modalRecord.classList.add('active');
}

function closeModal() {
    el.modalRecord.classList.remove('active');
}

function handleRecordFormSubmit(e) {
    e.preventDefault();
    const originalHrm = el.editOriginalHrm.value;
    const newRecord = {
        stt: parseInt(el.mStt.value) || (STATE.records.length + 1),
        full_name: el.mFullName.value.trim(),
        hrm_code: el.mHrmCode.value.trim(),
        gender: el.mGender.value,
        dob: el.mDob.value.trim(),
        job_title: el.mJobTitle.value.trim(),
        post_office: el.mPostOffice.value.trim(),
        unit_name: el.mUnitName.value.trim(),
        height: el.mHeight.value.trim(),
        weight: el.mWeight.value.trim(),
        physical: "1",
        blood_pressure: el.mBp.value.trim(),
        vision_right: "10/10",
        vision_left: "10/10",
        vision_disease: "BT",
        ent: "BT", dental: "BT", dermatology: "BT", surgery: "BT", xray: "BT",
        ultrasound: el.mUltrasound.value.trim() || 'Bình thường',
        blood_tests: { ctm: "BT", urine: "BT", acid_uric: "350", creatinin: "85", glucose: "5.2", ure: "5.2", sgot: "18", sgpt: "19", triglycerides: "1.6", cholesterol: "5.2", ggt: "25", morphin: "ÂM TÍNH" },
        health_class: el.mHealthClass.value,
        conclusion: el.mConclusion.value.trim(),
        medical_advice: el.mMedicalAdvice.value.trim()
    };

    if (originalHrm) {
        const index = STATE.records.findIndex(r => r.hrm_code === originalHrm);
        if (index !== -1) {
            STATE.records[index] = newRecord;
            showToast("Đã cập nhật thông tin hồ sơ thành công!");
        }
    } else {
        if (STATE.records.some(r => r.hrm_code === newRecord.hrm_code)) {
            showToast("Mã HRM này đã tồn tại trong danh sách!", "danger");
            return;
        }
        STATE.records.unshift(newRecord);
        showToast("Đã thêm lao động mới thành công!");
    }

    saveDatabase();
    closeModal();
}

window.editRecord = function(hrmCode) {
    openModal(hrmCode);
};

window.deleteRecord = function(hrmCode) {
    if (confirm(`Bạn có chắc muốn xóa hồ sơ lao động có Mã HRM ${hrmCode}?`)) {
        STATE.records = STATE.records.filter(r => r.hrm_code !== hrmCode);
        saveDatabase();
        showToast(`Đã xóa hồ sơ Mã HRM ${hrmCode}`, "warning");
    }
};

/* ==========================================================================
   CSV FILE IMPORT LOGIC (37 VNPOST COLUMNS FORMAT)
   ========================================================================== */
function processCsvFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const parsed = parseCsvText(text);
        if (parsed.length === 0) {
            showToast("File CSV rỗng hoặc không đúng định dạng Bưu điện!", "danger");
            return;
        }
        STATE.stagedImportData = parsed;
        renderImportPreview(parsed);
    };
    reader.readAsText(file, 'UTF-8');
}

function parseCsvText(csvText) {
    const lines = csvText.split(/\r\n|\n/).filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        if (values.length < 5) continue;

        const item = {
            stt: parseInt(values[0]) || i,
            full_name: values[1] || 'CHƯA TÊN',
            hrm_code: values[2] || `HRM-${Date.now()}-${i}`,
            gender: values[3] || 'Nam',
            dob: values[4] || '01/01/1990',
            job_title: values[5] || '',
            post_office: values[6] || '',
            unit_name: values[7] || '',
            height: values[8] || '160',
            weight: values[9] || '60',
            physical: values[10] || '1',
            blood_pressure: values[11] || '120/80',
            vision_right: values[12] || '10/10',
            vision_left: values[13] || '10/10',
            vision_disease: values[14] || 'BT',
            ent: values[15] || 'BT',
            dental: values[16] || 'BT',
            dermatology: values[17] || 'BT',
            surgery: values[18] || 'BT',
            xray: values[19] || 'BT',
            ultrasound: values[20] || 'BT',
            gynecology: values[21] || '',
            blood_tests: {
                ctm: values[22] || 'BT', urine: values[23] || 'BT', acid_uric: values[24] || '350',
                creatinin: values[25] || '85', glucose: values[26] || '5.2', ure: values[27] || '5.2',
                sgot: values[28] || '18', sgpt: values[29] || '19', triglycerides: values[30] || '1.6',
                cholesterol: values[31] || '5.2', ggt: values[32] || '25', morphin: values[33] || 'ÂM TÍNH'
            },
            health_class: values[34] || 'Loại I',
            conclusion: values[35] || 'Hiện tại đủ sức khỏe làm việc',
            medical_advice: values[36] || 'Theo dõi định kỳ'
        };
        rows.push(item);
    }
    return rows;
}

function renderImportPreview(data) {
    el.importCount.textContent = data.length;
    el.tbodyPreview.innerHTML = data.slice(0, 5).map(r => `
        <tr>
            <td>${r.stt}</td>
            <td><strong>${r.full_name}</strong></td>
            <td><code>${maskHrm(r.hrm_code)}</code></td>
            <td>${r.dob}</td>
            <td>${r.gender}</td>
            <td>${r.job_title}</td>
            <td>${r.post_office}</td>
            <td><span class="status-tag tag-success">${r.health_class}</span></td>
        </tr>
    `).join('');

    el.importPreviewArea.style.display = 'block';
}

function commitImport() {
    if (STATE.stagedImportData.length === 0) return;

    STATE.stagedImportData.forEach(item => {
        const index = STATE.records.findIndex(r => r.hrm_code === item.hrm_code);
        if (index !== -1) {
            STATE.records[index] = item;
        } else {
            STATE.records.unshift(item);
        }
    });

    saveDatabase();
    showToast(`Đã import ${STATE.stagedImportData.length} hồ sơ khám sức khỏe vào DB thành công!`);
    STATE.stagedImportData = [];
    el.importPreviewArea.style.display = 'none';
    el.fileCsvInput.value = '';
}

/* ==========================================================================
   DOWNLOAD HELPERS
   ========================================================================== */
function downloadSampleCsv() {
    const csvContent = "\uFEFFstt,họ_và_tên,mã_hrm,giới_tính,ngày_sinh,chức_danh,bưu_cục_vhx,đơn_vị,chiều_cao,cân_nặng,thể_lực,huyết_áp,mắt_phải,mắt_trái,bệnh_mắt,tmh,rhm,nội_da_liễu,ngoại,x_quang,siêu_âm,phụ_khoa,xn_ctm,xn_nước_tiểu,acid_uric,creatinin,glucose,ure,sgot,sgpt,triglycerides,cholesterol,ggt,morphin,phân_loại_sk,kết_luận,tư_vấn\n" +
        "353,EO CHANG HY,00269118,Nam,09/10/1992,205 - Nhân viên kinh doanh,An Dương Vương,Bưu điện phường ABC,157,58,2,110/70,10/10,10/10,BT,BT,BT,BT,BT,BT,Polype túi mật,,BT,BT,385,87,5.3,5.5,18,19,1.8,5.6,29,ÂM TÍNH,Loại II,Hiện tại đủ sức khỏe để làm việc,Polype túi mật -> ĐN khám và điều trị\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sample_worker_health_database.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadJsonSchema() {
    const schemaObj = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "VNPostWorkerHealthRecordSchema",
        "description": "Cấu trúc dữ liệu mẫu hồ sơ khám sức khỏe lao động Bưu điện (VNPost)",
        "type": "object",
        "properties": {
            "stt": { "type": "integer", "example": 353 },
            "full_name": { "type": "string", "example": "EO CHANG HY" },
            "hrm_code": { "type": "string", "example": "00269118" },
            "gender": { "type": "string", "example": "Nam" },
            "dob": { "type": "string", "example": "09/10/1992" },
            "job_title": { "type": "string", "example": "205 - Nhân viên kinh doanh" },
            "post_office": { "type": "string", "example": "An Dương Vương" },
            "unit_name": { "type": "string", "example": "Bưu điện phường ABC" },
            "health_class": { "type": "string", "example": "Loại II" },
            "conclusion": { "type": "string", "example": "Hiện tại đủ sức khỏe để làm việc" },
            "medical_advice": { "type": "string", "example": "Polype túi mật -> ĐN khám và điều trị" }
        },
        "required": ["full_name", "hrm_code", "dob"]
    };

    const blob = new Blob([JSON.stringify(schemaObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'database_schema.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
