'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.KSK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ksk-test-'));
process.env.MAX_FAILS = '3';
process.env.IP_MAX_REQUESTS = '1000';
process.env.PORT = '0'; // cổng ngẫu nhiên, không đụng máy chủ thật

const db = require('../server/db');
const { fileToRecords, normalizeDob } = require('../server/records');
const { start } = require('../server/server');

const template = fs.readFileSync(path.join(__dirname, '..', 'admin-ui', 'mau_import_ksk.xlsx'));
let server, base, pins;

test.before(async () => {
    const { records, errors } = fileToRecords(template);
    assert.deepStrictEqual(errors, []);
    db.importRecords(records);
    pins = Object.fromEntries(db.issueMissingPins().map((p) => [p.employee_code, p.pin]));
    server = start();
    await new Promise((r) => server.once('listening', r));
    base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

const lookup = (body) => fetch(base + '/api/lookup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

test('normalizeDob', () => {
    assert.strictEqual(normalizeDob('1/2/1990'), '01/02/1990');
    assert.strictEqual(normalizeDob('1990-02-01'), '01/02/1990');
    assert.strictEqual(normalizeDob('30/02/1990'), null);
});

test('correct code + dob + pin returns exactly one record', async () => {
    const res = await lookup({ employee_code: '00000001', dob: '1/1/1990', pin: pins['00000001'] });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.record.employee_code, '00000001');
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
});

test('wrong dob or wrong pin -> same generic 401', async () => {
    const a = await lookup({ employee_code: '00000002', dob: '16/06/1995', pin: pins['00000002'] });
    const b = await lookup({ employee_code: '00000002', dob: '15/06/1995', pin: '000000' === pins['00000002'] ? '111111' : '000000' });
    const c = await lookup({ employee_code: '99999999', dob: '15/06/1995', pin: '123456' });
    assert.deepStrictEqual([a.status, b.status, c.status], [401, 401, 401]);
    const [ma, mb, mc] = await Promise.all([a.json(), b.json(), c.json()]);
    assert.strictEqual(ma.message, mb.message);
    assert.strictEqual(mb.message, mc.message);
});

test('lock after MAX_FAILS, even correct credentials are refused while locked', async () => {
    const code = '00000003';
    for (let i = 0; i < 3; i++) await lookup({ employee_code: code, dob: '01/01/2000', pin: '123456' });
    const res = await lookup({ employee_code: code, dob: '20/12/1985', pin: pins[code] });
    assert.strictEqual(res.status, 423);
    db.clearFailures(code);
    const ok = await lookup({ employee_code: code, dob: '20/12/1985', pin: pins[code] });
    assert.strictEqual(ok.status, 200);
});

test('ngày sinh nhập dạng ddmmyyyy cũng tra cứu được', async () => {
    const res = await lookup({ employee_code: '00000001', dob: '01011990', pin: pins['00000001'] });
    assert.strictEqual(res.status, 200);
});

test('invalid input -> 400; GET on API -> 405', async () => {
    assert.strictEqual((await lookup({ employee_code: 'x', dob: 'abc', pin: '12' })).status, 400);
    assert.strictEqual((await fetch(base + '/api/lookup')).status, 405);
});

test('static: index served with CSP; data dir and traversal not reachable', async () => {
    const res = await fetch(base + '/');
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    for (const p of ['/../data/ksk.db', '/%2e%2e/data/ksk.db', '/%2e%2e/server/db.js', '/mau_import_ksk.xlsx']) {
        assert.strictEqual((await fetch(base + p)).status, 404, p);
    }
});

test('access log records outcome but never pin or dob', () => {
    const log = fs.readFileSync(path.join(process.env.KSK_DATA_DIR, 'access.log'), 'utf8');
    assert.match(log, /"outcome":"success"/);
    for (const pin of Object.values(pins)) assert.ok(!log.includes(`"${pin}"`));
    assert.ok(!log.includes('1990'));
});
