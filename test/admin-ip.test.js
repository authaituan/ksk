'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.KSK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ksk-ip-test-'));
process.env.PORT = '0';
process.env.ADMIN_ALLOWED_IPS = '10.99.99.99'; // máy test (127.0.0.1) KHÔNG nằm trong danh sách

const { start } = require('../server/server');
let server, base;
test.before(async () => {
    server = start();
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('IP not in ADMIN_ALLOWED_IPS gets 404 for admin UI and API; lookup page still works', async () => {
    for (const p of ['/admin', '/admin/', '/admin/admin.js', '/admin/api/me']) {
        assert.strictEqual((await fetch(base + p)).status, 404, p);
    }
    const login = await fetch(base + '/admin/api/login', { method: 'POST', body: '{"username":"a","password":"b"}' });
    assert.strictEqual(login.status, 404);
    assert.strictEqual((await fetch(base + '/')).status, 200);
});
