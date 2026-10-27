import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.js';

test('authentication, student lifecycle, attendance isolation and persistence', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'attendance-test-'));
    const dbPath = join(folder, 'test.sqlite3');
    let server, base, cookie = '', csrf = '';
    async function start() {
        server = createApp({ dbPath }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
        base = `http://127.0.0.1:${server.address().port}`;
    }
    async function stop() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    async function request(path, method = 'GET', body, headers = {}) {
        const response = await fetch(base + path, { method, headers: {
            'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf, ...headers
        }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const data = await response.json();
        return { status: response.status, data, cookie: response.headers.get('set-cookie') };
    }
    try {
        await start();
        assert.equal((await request('/api/auth')).data.setupRequired, true);
        assert.equal((await request('/api/data')).status, 401);
        const credentials = { username: 'teacher', password: 'strong test password' };
        assert.equal((await request('/api/setup', 'POST', { ...credentials, password: 'short' })).status, 400);
        const setup = await request('/api/setup', 'POST', credentials);
        assert.equal(setup.status, 200);
        cookie = setup.cookie.split(';')[0]; csrf = setup.data.csrf;
        assert.match(setup.cookie, /HttpOnly/);
        assert.equal((await request('/api/setup', 'POST', credentials)).status, 409);
        assert.equal((await request('/api/students', 'POST', {}, { 'X-CSRF-Token': '' })).status, 403);
        assert.equal((await request('/api/logout', 'POST', {}, { Origin: 'https://attacker.example' })).status, 403);
        const student = { id: 'STU-001', name: 'សុខ ចាន់ <b>test</b>, "quoted"', gender: 'ប្រុស', avatar: '👨‍🎓' };
        assert.equal((await request('/api/students', 'POST', student)).status, 200);
        assert.equal((await request('/api/students', 'POST', student)).status, 409);
        assert.equal((await request('/api/students', 'POST', { ...student, id: "bad'id" })).status, 400);
        assert.deepEqual((await request('/api/data')).data.attendanceRecords, {});
        const mark = { date: '2026-10-27', session: 'ព្រឹក', records: { 'STU-001': 'A' } };
        assert.equal((await request('/api/attendance', 'PUT', mark)).status, 200);
        assert.equal((await request('/api/attendance', 'PUT', { ...mark, session: 'រសៀល', records: { 'STU-001': 'T' } })).status, 200);
        assert.equal((await request('/api/attendance', 'PUT', { ...mark, date: '2026-02-30' })).status, 400);
        assert.equal((await request('/api/attendance', 'PUT', { ...mark, records: { 'STU-001': 'P', unknown: 'A' } })).status, 400);
        assert.equal((await request('/api/data')).data.attendanceRecords['2026-10-27_ព្រឹក']['STU-001'], 'A', 'Failed batches roll back');
        assert.equal((await request('/api/students', 'POST', { ...student, id: 'STU-002' })).status, 200);
        assert.equal((await request('/api/students/STU-001', 'PUT', { ...student, id: 'STU-002' })).status, 409);
        assert.equal((await request('/api/students/STU-001', 'PUT', { ...student, id: 'STU-010' })).status, 200);
        let data = (await request('/api/data')).data;
        assert.equal(data.attendanceRecords['2026-10-27_ព្រឹក']['STU-010'], 'A', 'Renaming IDs preserves history');
        assert.equal(data.attendanceRecords['2026-10-27_ព្រឹក']['STU-002'], undefined, 'New students are unmarked');
        await stop(); await start();
        data = (await request('/api/data')).data;
        assert.equal(data.students.find(s => s.id === 'STU-010').name, student.name);
        assert.equal(data.attendanceRecords['2026-10-27_រសៀល']['STU-010'], 'T');
        for (const path of ['/server.js', '/data/attendance.sqlite3', '/package.json']) assert.equal((await request(path)).status, 404);
        assert.equal((await fetch(base + '/')).status, 200);
        assert.equal((await fetch(base + '/app.js')).status, 200);
        assert.equal((await request('/api/students/STU-010', 'DELETE')).status, 200);
        assert.deepEqual((await request('/api/data')).data.attendanceRecords, {});
        assert.equal((await request('/api/logout', 'POST', {})).status, 200);
        assert.equal((await request('/api/data')).status, 401);
        assert.equal((await request('/api/login', 'POST', { ...credentials, password: 'incorrect' })).status, 401);
        assert.equal((await request('/api/login', 'POST', credentials)).status, 200);
        for (let i = 0; i < 10; i++) await request('/api/login', 'POST', { ...credentials, password: 'incorrect' });
        assert.equal((await request('/api/login', 'POST', credentials)).status, 429);
    } finally {
        if (server?.listening) await stop();
        rmSync(folder, { recursive: true, force: true });
    }
});
