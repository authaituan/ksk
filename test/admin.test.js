'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.KSK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ksk-admin-test-'));
process.env.PORT = '0';
process.env.IP_MAX_REQUESTS = '1000';
process.env.ADMIN_ALLOWED_IPS = '127.0.0.1,::1';
process.env.PUBLIC_URL = 'http://ksk.noibo:8080/';

const db = require('../server/db');
const { parseAllowList } = require('../server/admin');
const { start } = require('../server/server');

const template = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'mau_import_ksk.xlsx'));
const badExcel = fs.readFileSync(path.join(__dirname, 'fixtures', 'excel_general_format.xlsx'));
let server, base;

test.before(async () => {
    server = start();
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** Trình duyệt giả: giữ cookie phiên và token CSRF. */
function client() {
    let cookie = '';
    let csrf = '';
    async function call(method, route, body, { raw = false, withCsrf = true } = {}) {
        const headers = {};
        if (cookie) headers.Cookie = cookie;
        if (withCsrf && csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
        let payload;
        if (body !== undefined) {
            headers['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
            payload = raw ? body : JSON.stringify(body);
        }
        const res = await fetch(`${base}/admin/api/${route}`, { method, headers, body: payload });
        const setCookie = res.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0];
        const data = await res.json().catch(() => ({}));
        if (data.csrf) csrf = data.csrf;
        return { status: res.status, data };
    }
    return { call };
}

async function loginFresh(username, role) {
    const temp = db.createAdminUser(username, role);
    const c = client();
    const r = await c.call('POST', 'login', { username, password: temp });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.must_change_password, true);
    // Chưa đổi mật khẩu -> chưa được làm gì
    assert.strictEqual((await c.call('GET', 'employees')).status, 403);
    const newPass = `Mat-khau-moi-${role}-2026`;
    const ch = await c.call('POST', 'password', { current_password: temp, new_password: newPass });
    assert.strictEqual(ch.status, 200);
    assert.strictEqual(ch.data.public_url, 'http://ksk.noibo:8080/');
    return c;
}

let admin, yte, nhansu;

test('allow list: exact IPs and IPv4 CIDR', () => {
    const rules = parseAllowList('127.0.0.1, ::1, 192.168.10.0/24');
    const ok = (ip) => rules.some((m) => m(ip));
    assert.ok(ok('127.0.0.1') && ok('::1') && ok('192.168.10.77'));
    assert.ok(!ok('192.168.11.1') && !ok('10.0.0.1'));
    assert.throws(() => parseAllowList('192.168.1.0/40'));
});

test('first login forces password change; then roles work', async () => {
    admin = await loginFresh('quantri', 'admin');
    yte = await loginFresh('yte01', 'yte');
    nhansu = await loginFresh('nhansu01', 'nhansu');
});

test('wrong password -> 401, locked after 5 fails', async () => {
    db.createAdminUser('khoa.thu', 'yte');
    const c = client();
    for (let i = 0; i < 5; i++) assert.strictEqual((await c.call('POST', 'login', { username: 'khoa.thu', password: 'sai-mat-khau' })).status, 401);
    assert.strictEqual((await c.call('POST', 'login', { username: 'khoa.thu', password: 'sai-mat-khau' })).status, 423);
});

test('no session -> 401; missing CSRF header -> 403', async () => {
    assert.strictEqual((await client().call('GET', 'employees')).status, 401);
    const r = await yte.call('POST', 'import?mode=preview', template, { raw: true, withCsrf: false });
    assert.strictEqual(r.status, 403);
});

test('yte: preview then commit import; cannot issue PINs or manage users', async () => {
    const bad = await yte.call('POST', 'import?mode=preview', badExcel, { raw: true });
    assert.strictEqual(bad.status, 200);
    assert.strictEqual(bad.data.errors.length, 1);
    assert.match(bad.data.errors[0], /^Dòng 4:/);
    assert.strictEqual((await yte.call('POST', 'import?mode=commit', badExcel, { raw: true })).status, 400);
    const csvFile = await yte.call('POST', 'import?mode=preview', Buffer.from('stt,họ_và_tên\n1,A'), { raw: true });
    assert.match(csvFile.data.errors[0], /Chỉ nhận file Excel \.xlsx/);

    const pre = await yte.call('POST', 'import?mode=preview', template, { raw: true });
    assert.deepStrictEqual([pre.data.valid_count, pre.data.inserted, pre.data.errors.length], [3, 3, 0]);
    const done = await yte.call('POST', 'import?mode=commit', template, { raw: true });
    assert.deepStrictEqual(done.data, { inserted: 3, updated: 0 });

    assert.strictEqual((await yte.call('POST', 'pins/issue-missing', {})).status, 403);
    assert.strictEqual((await yte.call('GET', 'users')).status, 403);
});

test('file mẫu Excel tải được từ trang quản trị', async () => {
    const tpl = await fetch(`${base}/admin/mau_import_ksk.xlsx`);
    assert.strictEqual(tpl.status, 200);
    assert.match(tpl.headers.get('content-type'), /spreadsheetml/);
});

test('employee without PIN cannot look up', async () => {
    const res = await fetch(`${base}/api/lookup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: '00000001', dob: '01/01/1990', pin: '000000' })
    });
    assert.strictEqual(res.status, 401);
});

test('employee list has identity only, never health data or DOB', async () => {
    const r = await nhansu.call('GET', 'employees?q=nguyễn');
    assert.strictEqual(r.data.total, 1);
    const text = JSON.stringify(r.data);
    for (const leak of ['01/01/1990', 'blood', 'conclusion', 'ÂM TÍNH', 'pin_hash', '"pin"']) assert.ok(!text.includes(leak), leak);
    assert.strictEqual(r.data.items[0].has_pin, false);
});

test('nhansu: issue PINs once, reset PIN, unlock; cannot import', async () => {
    const r = await nhansu.call('POST', 'pins/issue-missing', {});
    assert.strictEqual(r.data.issued.length, 3);
    assert.match(r.data.issued[0].pin, /^\d{6}$/);
    assert.strictEqual((await nhansu.call('POST', 'pins/issue-missing', {})).data.issued.length, 0);

    const pin = r.data.issued.find((p) => p.employee_code === '00000001').pin;
    const ok = await fetch(`${base}/api/lookup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: '00000001', dob: '01/01/1990', pin })
    });
    assert.strictEqual(ok.status, 200);

    const reset = await nhansu.call('POST', 'employees/reset-pin', { employee_code: '00000002' });
    assert.strictEqual(reset.data.issued[0].employee_code, '00000002');
    assert.strictEqual((await nhansu.call('POST', 'employees/unlock', { employee_code: '00000002' })).status, 200);
    assert.strictEqual((await nhansu.call('POST', 'import?mode=preview', template, { raw: true })).status, 403);
});

test('admin: create, disable (kills session), cannot disable last admin or self', async () => {
    const created = await admin.call('POST', 'users', { username: 'yte02', role: 'yte' });
    assert.strictEqual(created.status, 200);
    assert.strictEqual(created.data.password.length, 12);
    assert.strictEqual((await admin.call('POST', 'users', { username: 'yte02', role: 'yte' })).status, 400);
    assert.strictEqual((await admin.call('POST', 'users', { username: 'x', role: 'root' })).status, 400);

    assert.strictEqual((await admin.call('POST', 'users/set-active', { username: 'yte01', active: false })).status, 200);
    assert.strictEqual((await yte.call('GET', 'employees')).status, 401);

    assert.strictEqual((await admin.call('POST', 'users/set-active', { username: 'quantri', active: false })).status, 400);
    const list = await admin.call('GET', 'users');
    assert.ok(list.data.items.some((u) => u.username === 'yte01' && !u.active));

    const logs = await admin.call('GET', 'logs?type=admin');
    assert.ok(logs.data.items.some((e) => e.action === 'issue_pins' && e.count === 3));
    assert.ok(!JSON.stringify(logs.data).match(/"pin":"\d{6}"/));
});

test('admin UI served under /admin/; logout ends session', async () => {
    const res = await fetch(`${base}/admin/`);
    assert.strictEqual(res.status, 200);
    assert.match(await res.text(), /Quản trị/);
    assert.strictEqual((await fetch(`${base}/admin/../data/ksk.db`)).status, 404);
    assert.strictEqual((await admin.call('POST', 'logout', {})).status, 200);
    assert.strictEqual((await admin.call('GET', 'me')).status, 401);
});
