/**
 * KSK - Trang quản trị (phía trình duyệt).
 * Mọi dữ liệu hiển thị được tạo bằng DOM API/textContent (không dùng innerHTML với dữ liệu).
 */
'use strict';

const $ = (id) => document.getElementById(id);

let session = null;     // { username, role, role_label, permissions, must_change_password, csrf }
let pinBatch = [];      // PIN vừa cấp, chỉ giữ trong bộ nhớ trang
let importText = '';    // nội dung file CSV đang kiểm tra
let roleLabels = {};

/* --------------------------------------------------------------------------
   Tiện ích
   -------------------------------------------------------------------------- */
function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
        if (c === null || c === undefined || c === false) continue;
        node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
}

function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function toast(message, type = 'success') {
    const t = h('div', { class: `toast ${type}` }, h('i', { class: type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-triangle-exclamation' }), ' ', h('span', {}, message));
    $('toastContainer').append(t);
    setTimeout(() => t.remove(), 4000);
}

function showMsg(id, message) {
    const node = $(id);
    node.textContent = message || '';
    node.hidden = !message;
}

function show(viewId) {
    for (const id of ['viewLogin', 'viewPassword', 'viewApp']) $(id).hidden = id !== viewId;
}

const can = (perm) => Boolean(session && session.permissions.includes(perm));

/* --------------------------------------------------------------------------
   Gọi API
   -------------------------------------------------------------------------- */
async function api(method, route, body, { raw = false } = {}) {
    const headers = {};
    if (method !== 'GET' && session) headers['X-CSRF-Token'] = session.csrf;
    let payload;
    if (body !== undefined) {
        headers['Content-Type'] = raw ? 'text/csv; charset=utf-8' : 'application/json';
        payload = raw ? body : JSON.stringify(body);
    }
    const res = await fetch(`/admin/api/${route}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
    let data = {};
    try { data = await res.json(); } catch (_) { /* ignore */ }

    if (res.status === 401 && route !== 'login') {
        session = null;
        showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
        throw new Error('unauthorized');
    }
    if (res.status === 403 && data.code === 'must_change_password') {
        session.must_change_password = true;
        showPassword();
        throw new Error('must_change_password');
    }
    return { ok: res.ok, status: res.status, data };
}

/* --------------------------------------------------------------------------
   Đăng nhập / đổi mật khẩu
   -------------------------------------------------------------------------- */
function showLogin(message) {
    $('mainNav').hidden = true;
    $('userBox').hidden = true;
    clearPins();
    show('viewLogin');
    showMsg('loginMsg', message || '');
    $('loginUser').focus();
}

function showPassword() {
    $('formPassword').reset();
    showMsg('pwMsg', '');
    $('mustChangeNotice').hidden = !session.must_change_password;
    $('btnCancelPassword').hidden = session.must_change_password;
    $('mainNav').hidden = true;
    show('viewPassword');
    $('pwCurrent').focus();
}

function applySession(s) {
    session = s;
    $('userName').textContent = s.username;
    $('userRole').textContent = s.role_label;
    $('userBox').hidden = false;
    if (s.must_change_password) return showPassword();

    const buttons = [...document.querySelectorAll('#mainNav .nav-btn')];
    buttons.forEach((b) => { b.hidden = !can(b.dataset.perm); });
    $('mainNav').hidden = false;
    show('viewApp');
    const first = buttons.find((b) => !b.hidden);
    if (first) openTab(first.dataset.tab);
}

$('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('loginMsg', '');
    const r = await api('POST', 'login', { username: $('loginUser').value.trim(), password: $('loginPass').value });
    $('loginPass').value = '';
    if (!r.ok) return showMsg('loginMsg', r.data.message || 'Đăng nhập thất bại.');
    applySession(r.data);
});

$('formPassword').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('pwNew').value !== $('pwNew2').value) return showMsg('pwMsg', 'Hai lần nhập mật khẩu mới không khớp.');
    const r = await api('POST', 'password', { current_password: $('pwCurrent').value, new_password: $('pwNew').value });
    if (!r.ok) return showMsg('pwMsg', r.data.message || 'Không đổi được mật khẩu.');
    toast('Đã đổi mật khẩu.');
    applySession(r.data);
});

$('btnCancelPassword').addEventListener('click', () => applySession(session));
$('btnShowPassword').addEventListener('click', () => showPassword());
$('btnLogout').addEventListener('click', async () => {
    try { await api('POST', 'logout', {}); } catch (_) { /* ignore */ }
    session = null;
    showLogin('Đã đăng xuất.');
});

/* --------------------------------------------------------------------------
   Tab
   -------------------------------------------------------------------------- */
const TAB_LOADERS = {
    'tab-employees': loadEmployees,
    'tab-import': () => {},
    'tab-pins': () => {},
    'tab-users': loadUsers,
    'tab-logs': loadLogs
};

function openTab(tabId) {
    document.querySelectorAll('#mainNav .nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.admin-tab').forEach((t) => { t.hidden = t.id !== tabId; });
    refreshStats();
    TAB_LOADERS[tabId]();
}

document.querySelectorAll('#mainNav .nav-btn').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.tab)));

async function refreshStats() {
    const r = await api('GET', 'stats');
    if (!r.ok) return;
    $('statTotal').textContent = r.data.total;
    $('statNoPin').textContent = r.data.without_pin;
    $('statLocked').textContent = r.data.locked;
    $('pinPending').textContent = r.data.without_pin;
    $('btnIssuePins').disabled = r.data.without_pin === 0;
}

/* --------------------------------------------------------------------------
   Nhân viên
   -------------------------------------------------------------------------- */
let searchTimer;
$('empSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadEmployees, 250);
});

async function loadEmployees() {
    const r = await api('GET', `employees?q=${encodeURIComponent($('empSearch').value.trim())}`);
    if (!r.ok) return;
    const body = $('empBody');
    body.replaceChildren(...r.data.items.map((e) => {
        const pinCell = e.has_pin
            ? h('span', { class: 'status-tag tag-success' }, `Đã cấp ${fmtTime(e.pin_issued_at).slice(0, 10)}`)
            : h('span', { class: 'status-tag tag-warn' }, 'Chưa có PIN');
        const lockCell = e.locked
            ? h('span', { class: 'status-tag tag-danger' }, 'Đang khóa')
            : (e.failed_attempts ? h('span', { class: 'status-tag tag-warn' }, `Sai ${e.failed_attempts} lần`) : h('span', { class: 'muted' }, 'Bình thường'));
        const actions = h('div', { class: 'action-btns' },
            can('pin') && e.has_pin ? h('button', { class: 'btn btn-sm btn-outline', type: 'button', onclick: () => resetPin(e) }, 'Cấp lại PIN') : null,
            can('unlock') && (e.locked || e.failed_attempts) ? h('button', { class: 'btn btn-sm btn-outline', type: 'button', onclick: () => unlock(e) }, 'Mở khóa') : null
        );
        return h('tr', {}, h('td', {}, h('code', {}, e.employee_code)), h('td', {}, e.full_name), h('td', {}, e.department), h('td', {}, e.unit_name), h('td', {}, pinCell), h('td', {}, lockCell), h('td', {}, actions));
    }));
    if (!r.data.items.length) body.append(h('tr', {}, h('td', { colspan: '7', class: 'muted center' }, 'Không có nhân viên phù hợp.')));
    $('empCount').textContent = r.data.total > r.data.items.length
        ? `Hiển thị ${r.data.items.length}/${r.data.total} nhân viên. Gõ thêm từ khóa để thu hẹp.`
        : `${r.data.total} nhân viên.`;
}

async function resetPin(e) {
    if (!confirm(`Cấp lại PIN cho ${e.full_name} (${e.employee_code})?\nPIN cũ sẽ hết hiệu lực ngay.`)) return;
    const r = await api('POST', 'employees/reset-pin', { employee_code: e.employee_code });
    if (!r.ok) return toast(r.data.message || 'Không cấp lại được PIN.', 'danger');
    showPinResult(r.data.issued);
    loadEmployees();
}

async function unlock(e) {
    const r = await api('POST', 'employees/unlock', { employee_code: e.employee_code });
    if (!r.ok) return toast(r.data.message || 'Không mở khóa được.', 'danger');
    toast(`Đã mở khóa ${e.employee_code}.`);
    loadEmployees();
    refreshStats();
}

/* --------------------------------------------------------------------------
   Import
   -------------------------------------------------------------------------- */
$('importFile').addEventListener('change', () => {
    importText = '';
    $('importResult').hidden = true;
    $('btnPreview').disabled = !$('importFile').files.length;
});

function readFileText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'utf-8');
    });
}

$('btnPreview').addEventListener('click', async () => {
    const file = $('importFile').files[0];
    if (!file) return;
    importText = await readFileText(file);
    const r = await api('POST', 'import?mode=preview', importText, { raw: true });
    if (!r.ok) return toast(r.data.message || 'Không kiểm tra được file.', 'danger');
    const d = r.data;
    $('importSummary').replaceChildren(
        h('span', {}, 'Dòng hợp lệ: ', h('strong', {}, d.valid_count)),
        h('span', {}, 'Nhân viên mới: ', h('strong', {}, d.inserted)),
        h('span', {}, 'Cập nhật: ', h('strong', {}, d.updated)),
        h('span', { class: d.errors.length ? 'text-danger' : '' }, 'Lỗi: ', h('strong', {}, d.errors.length))
    );
    $('importErrors').replaceChildren(...d.errors.slice(0, 100).map((e) => h('li', {}, e)));
    if (d.errors.length > 100) $('importErrors').append(h('li', {}, `... và ${d.errors.length - 100} lỗi khác`));
    $('btnCommit').disabled = d.errors.length > 0 || d.valid_count === 0;
    $('btnCommit').textContent = d.errors.length ? 'Sửa lỗi trong file rồi kiểm tra lại' : 'Xác nhận import';
    $('importResult').hidden = false;
});

$('btnCommit').addEventListener('click', async () => {
    if (!importText) return;
    $('btnCommit').disabled = true;
    const r = await api('POST', 'import?mode=commit', importText, { raw: true });
    if (!r.ok) {
        $('btnCommit').disabled = false;
        return toast(r.data.message || 'Import thất bại.', 'danger');
    }
    toast(`Import xong: ${r.data.inserted} mới, ${r.data.updated} cập nhật.`);
    importText = '';
    $('importFile').value = '';
    $('btnPreview').disabled = true;
    $('importResult').hidden = true;
    refreshStats();
});

/* --------------------------------------------------------------------------
   PIN: cấp, xuất Excel, in phiếu
   -------------------------------------------------------------------------- */
$('btnIssuePins').addEventListener('click', async () => {
    const n = $('pinPending').textContent;
    if (!confirm(`Cấp PIN cho ${n} nhân viên chưa có PIN?`)) return;
    const r = await api('POST', 'pins/issue-missing', {});
    if (!r.ok) return toast(r.data.message || 'Không cấp được PIN.', 'danger');
    if (!r.data.issued.length) return toast('Không có nhân viên nào đang chờ cấp PIN.', 'warning');
    showPinResult(r.data.issued);
    refreshStats();
});

function showPinResult(list) {
    pinBatch = list;
    $('pinResultCount').textContent = list.length;
    $('pinBody').replaceChildren(...list.map((p) => h('tr', {},
        h('td', {}, h('code', {}, p.employee_code)), h('td', {}, p.full_name), h('td', {}, p.department), h('td', {}, p.unit_name),
        h('td', {}, h('strong', { class: 'pin-code' }, p.pin)))));
    $('pinResult').hidden = false;
    $('pinResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearPins() {
    pinBatch = [];
    $('pinBody').replaceChildren();
    $('printArea').replaceChildren();
    $('pinResult').hidden = true;
}

$('btnPinClear').addEventListener('click', () => {
    if (confirm('Xóa danh sách PIN khỏi màn hình? Bạn sẽ không xem lại được các PIN này.')) clearPins();
});

function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

$('btnPinExcel').addEventListener('click', () => {
    if (!pinBatch.length) return;
    const rows = [['Mã nhân viên', 'Họ và tên', 'Bộ phận', 'Đơn vị', 'Chức danh', 'PIN'],
        ...pinBatch.map((p) => [p.employee_code, p.full_name, p.department, p.unit_name, p.job_title, p.pin])];
    window.KskXlsx.download(`PIN-KSK-${stamp()}.xlsx`, 'PIN', rows, [14, 28, 18, 22, 22, 10]);
});

$('btnPinPrint').addEventListener('click', () => {
    if (!pinBatch.length) return;
    const site = session.public_url || (window.location.origin + '/');
    $('printArea').replaceChildren(...pinBatch.map((p) => h('div', { class: 'pin-slip' },
        h('div', { class: 'slip-title' }, 'PHIẾU MÃ PIN TRA CỨU KẾT QUẢ KHÁM SỨC KHỎE'),
        h('div', { class: 'slip-row' }, 'Họ và tên: ', h('strong', {}, p.full_name)),
        h('div', { class: 'slip-row' }, 'Mã nhân viên: ', h('strong', {}, p.employee_code)),
        h('div', { class: 'slip-row' }, 'Bộ phận / Đơn vị: ', `${p.department || '—'} / ${p.unit_name || '—'}`),
        h('div', { class: 'slip-pin' }, 'Mã PIN: ', h('span', {}, p.pin)),
        h('div', { class: 'slip-note' }, `Tra cứu tại: ${site} — nhập Mã nhân viên, Ngày sinh và Mã PIN.`),
        h('div', { class: 'slip-note' }, 'PIN là thông tin cá nhân. Không cho người khác biết. Nếu quên PIN, liên hệ bộ phận Nhân sự để cấp lại.')
    )));
    window.print();
});

window.addEventListener('afterprint', () => $('printArea').replaceChildren());

/* --------------------------------------------------------------------------
   Tài khoản
   -------------------------------------------------------------------------- */
async function loadUsers() {
    const r = await api('GET', 'users');
    if (!r.ok) return;
    roleLabels = r.data.roles;
    if (!$('newRole').options.length) {
        $('newRole').replaceChildren(...Object.entries(roleLabels).map(([v, label]) => h('option', { value: v }, label)));
    }
    $('userBody').replaceChildren(...r.data.items.map((u) => {
        const status = !u.active ? h('span', { class: 'status-tag tag-danger' }, 'Đã khóa')
            : u.locked ? h('span', { class: 'status-tag tag-warn' }, 'Tạm khóa (sai mật khẩu)')
            : u.must_change_password ? h('span', { class: 'status-tag tag-warn' }, 'Chờ đổi mật khẩu')
            : h('span', { class: 'status-tag tag-success' }, 'Hoạt động');
        const self = u.username === session.username;
        return h('tr', {},
            h('td', {}, h('strong', {}, u.username), self ? ' (bạn)' : ''),
            h('td', {}, roleLabels[u.role] || u.role),
            h('td', {}, status),
            h('td', {}, fmtTime(u.created_at)),
            h('td', {}, self ? '' : h('div', { class: 'action-btns' },
                h('button', { class: 'btn btn-sm btn-outline', type: 'button', onclick: () => resetUserPassword(u.username) }, 'Cấp lại mật khẩu'),
                h('button', { class: `btn btn-sm ${u.active ? 'btn-outline-danger' : 'btn-outline'}`, type: 'button', onclick: () => setActive(u.username, !u.active) }, u.active ? 'Khóa tài khoản' : 'Mở tài khoản')
            )));
    }));
}

function showTempPassword(username, password) {
    $('tempPassword').replaceChildren(
        'Mật khẩu tạm của ', h('strong', {}, username), ': ', h('code', { class: 'pin-code' }, password),
        h('br'), 'Chỉ hiển thị một lần. Người dùng phải đổi mật khẩu khi đăng nhập lần đầu.');
    $('tempPassword').hidden = false;
}

$('formCreateUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('POST', 'users', { username: $('newUsername').value.trim().toLowerCase(), role: $('newRole').value });
    if (!r.ok) return toast(r.data.message || 'Không tạo được tài khoản.', 'danger');
    showTempPassword(r.data.username, r.data.password);
    $('newUsername').value = '';
    loadUsers();
});

async function resetUserPassword(username) {
    if (!confirm(`Cấp lại mật khẩu tạm cho "${username}"? Người này sẽ bị đăng xuất.`)) return;
    const r = await api('POST', 'users/reset-password', { username });
    if (!r.ok) return toast(r.data.message || 'Không cấp lại được mật khẩu.', 'danger');
    showTempPassword(r.data.username, r.data.password);
    loadUsers();
}

async function setActive(username, active) {
    if (!active && !confirm(`Khóa tài khoản "${username}"? Người này sẽ bị đăng xuất ngay.`)) return;
    const r = await api('POST', 'users/set-active', { username, active });
    if (!r.ok) return toast(r.data.message || 'Không cập nhật được tài khoản.', 'danger');
    toast(active ? `Đã mở tài khoản ${username}.` : `Đã khóa tài khoản ${username}.`);
    loadUsers();
}

/* --------------------------------------------------------------------------
   Nhật ký
   -------------------------------------------------------------------------- */
const ACTION_LABELS = {
    login: 'Đăng nhập', login_fail: 'Đăng nhập sai', login_locked: 'Đăng nhập khi đang khóa', logout: 'Đăng xuất',
    change_password: 'Đổi mật khẩu', import: 'Import dữ liệu', issue_pins: 'Cấp PIN hàng loạt', reset_pin: 'Cấp lại PIN',
    unlock: 'Mở khóa tra cứu', create_user: 'Tạo tài khoản', reset_user_password: 'Cấp lại mật khẩu',
    enable_user: 'Mở tài khoản', disable_user: 'Khóa tài khoản', ip_denied: 'Chặn IP', csrf_reject: 'Chặn CSRF',
    success: 'Tra cứu thành công', fail: 'Tra cứu sai', fail_locked: 'Sai và bị khóa', fail_unknown_code: 'Mã không tồn tại',
    locked: 'Tra cứu khi đang khóa', invalid_input: 'Dữ liệu sai định dạng', ip_rate_limited: 'Vượt giới hạn theo IP'
};

$('logType').addEventListener('change', loadLogs);

async function loadLogs() {
    const r = await api('GET', `logs?type=${$('logType').value}`);
    if (!r.ok) return;
    $('logBody').replaceChildren(...r.data.items.map((e) => {
        const action = e.action || e.outcome || '';
        const detail = Object.entries(e)
            .filter(([k]) => !['ts', 'ip', 'user', 'employee_code', 'action', 'outcome'].includes(k))
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ');
        return h('tr', {}, h('td', {}, fmtTime(e.ts)), h('td', {}, e.ip || ''), h('td', {}, e.user || e.employee_code || ''),
            h('td', {}, ACTION_LABELS[action] || action), h('td', { class: 'muted' }, detail));
    }));
    if (!r.data.items.length) $('logBody').append(h('tr', {}, h('td', { colspan: '5', class: 'muted center' }, 'Chưa có nhật ký.')));
}

/* --------------------------------------------------------------------------
   Khởi động
   -------------------------------------------------------------------------- */
(async () => {
    try {
        const res = await fetch('/admin/api/me', { credentials: 'same-origin', cache: 'no-store' });
        if (res.ok) applySession(await res.json());
        else showLogin('');
    } catch (_) {
        showLogin('Không kết nối được máy chủ.');
    }
})();
