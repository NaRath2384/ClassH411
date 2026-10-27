import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const periods = new Set(['ព្រឹក', 'រសៀល', 'យប់', 'ម៉ោងទី១', 'ម៉ោងទី២']);
const avatars = new Set(['👨‍🎓', '👩‍🎓', '🧑‍🎓', '⭐']);
const digest = value => createHash('sha256').update(value).digest('hex');
const hashPassword = (password, salt) => scryptSync(password, salt, 64).toString('hex');
class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function text(data, key, max, trim = true) {
    if (typeof data[key] !== 'string') throw new ApiError(400, `${key} is required.`);
    const value = trim ? data[key].trim() : data[key];
    if (!value || value.length > max || value.includes('\0')) throw new ApiError(400, `${key} must contain 1–${max} characters.`);
    return value;
}
function studentData(data) {
    const student = {
        id: text(data, 'id', 40), name: text(data, 'name', 150),
        gender: text(data, 'gender', 20), avatar: text(data, 'avatar', 16)
    };
    if (!/^[A-Za-z0-9_-]+$/.test(student.id)) throw new ApiError(400, 'Student ID can contain letters, numbers, hyphens and underscores.');
    if (!['ប្រុស', 'ស្រី'].includes(student.gender) || !avatars.has(student.avatar)) throw new ApiError(400, 'Invalid gender or avatar.');
    return student;
}
async function readBody(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'Expected JSON.');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) throw new ApiError(413, 'Request is too large.');
        chunks.push(chunk);
    }
    try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        return value;
    } catch { throw new ApiError(400, 'Invalid JSON request.'); }
}

export function createApp({ dbPath = resolve(root, 'data/attendance.sqlite3') } = {}) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, name TEXT NOT NULL, gender TEXT NOT NULL, avatar TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS attendance(
            date TEXT NOT NULL, session TEXT NOT NULL,
            student_id TEXT NOT NULL REFERENCES students(id) ON UPDATE CASCADE ON DELETE CASCADE,
            status TEXT NOT NULL CHECK(status IN ('P','L','A','T')), PRIMARY KEY(date,session,student_id));
        CREATE TABLE IF NOT EXISTS login_attempts(address TEXT PRIMARY KEY, failures INTEGER NOT NULL, reset_at INTEGER NOT NULL);`);
    const get = (sql, ...args) => db.prepare(sql).get(...args);
    const run = (sql, ...args) => db.prepare(sql).run(...args);
    function transaction(fn) {
        db.exec('BEGIN IMMEDIATE');
        try { const result = fn(); db.exec('COMMIT'); return result; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    function sessionFor(req) {
        const token = /(?:^|;\s*)attendance_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        return token ? get('SELECT * FROM sessions WHERE token_hash=? AND expires>?', digest(token), Date.now()) : null;
    }
    function newSession(username, req) {
        const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
        const oldSession = sessionFor(req);
        if (oldSession) run('DELETE FROM sessions WHERE token_hash=?', oldSession.token_hash);
        run('DELETE FROM sessions WHERE expires<=?', Date.now());
        run('INSERT INTO sessions VALUES(?,?,?,?)', digest(token), username, csrf, Date.now() + 43_200_000);
        return [{ role: 'admin', csrf, setupRequired: false }, `attendance_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`];
    }
    const server = http.createServer(async (req, res) => {
        function reply(status, data, cookie) {
            res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff', ...(cookie ? { 'Set-Cookie': cookie } : {}) });
            res.end(JSON.stringify(data));
        }
        try {
            const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const method = req.method;
            // Explicit allowlist keeps database, source and configuration private.
            if (!path.startsWith('/api/')) {
                const asset = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js' }[path];
                if (method !== 'GET' || !asset) throw new ApiError(404, 'Not found.');
                const body = readFileSync(resolve(root, asset));
                res.writeHead(200, { 'Content-Type': asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
                    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
                res.end(body); return;
            }
            if (method !== 'GET') {
                if ((req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site')
                    throw new ApiError(403, 'Cross-origin requests are not allowed.');
            }
            if (method === 'GET' && path === '/api/auth') {
                const session = sessionFor(req);
                reply(200, { role: session ? 'admin' : 'visitor', csrf: session?.csrf || '', setupRequired: !get('SELECT 1 FROM users LIMIT 1') }); return;
            }
            if (method === 'POST' && ['/api/setup', '/api/login'].includes(path)) {
                const data = await readBody(req);
                const username = text(data, 'username', 80), password = text(data, 'password', 256, false);
                if (path === '/api/setup') {
                    if (password.length < 10) throw new ApiError(400, 'Choose a password with at least 10 characters.');
                    transaction(() => {
                        if (get('SELECT 1 FROM users LIMIT 1')) throw new ApiError(409, 'Administrator already exists. Please sign in.');
                        const salt = randomBytes(16).toString('hex');
                        run('INSERT INTO users VALUES(?,?,?)', username, salt, hashPassword(password, salt));
                    });
                } else {
                    const address = req.socket.remoteAddress;
                    const attempt = get('SELECT * FROM login_attempts WHERE address=?', address);
                    if (attempt?.reset_at > Date.now() && attempt.failures >= 10) throw new ApiError(429, 'Too many attempts. Try again in 15 minutes.');
                    const user = get('SELECT * FROM users WHERE username=?', username);
                    const actual = hashPassword(password, user?.salt || '0'.repeat(32));
                    if (!user || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(user.password_hash, 'hex'))) {
                        const active = attempt?.reset_at > Date.now();
                        run('INSERT OR REPLACE INTO login_attempts VALUES(?,?,?)', address, active ? attempt.failures + 1 : 1, active ? attempt.reset_at : Date.now() + 900_000);
                        throw new ApiError(401, 'Incorrect username or password.');
                    }
                    run('DELETE FROM login_attempts WHERE address=?', address);
                }
                reply(200, ...newSession(username, req)); return;
            }
            const session = sessionFor(req);
            if (!session) throw new ApiError(401, 'Please sign in to continue.');
            if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) throw new ApiError(403, 'Session verification failed. Refresh the page.');
            if (method === 'POST' && path === '/api/logout') {
                run('DELETE FROM sessions WHERE token_hash=?', session.token_hash);
                reply(200, { ok: true }, 'attendance_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return;
            }
            if (method === 'GET' && path === '/api/data') {
                const records = Object.create(null);
                for (const row of db.prepare('SELECT * FROM attendance ORDER BY date,session,student_id').all()) {
                    const key = `${row.date}_${row.session}`;
                    (records[key] ??= Object.create(null))[row.student_id] = row.status;
                }
                reply(200, { students: db.prepare('SELECT * FROM students ORDER BY id').all(), attendanceRecords: records }); return;
            }
            if (path === '/api/students' && method === 'POST') {
                const s = studentData(await readBody(req));
                run('INSERT INTO students VALUES(?,?,?,?)', s.id, s.name, s.gender, s.avatar);
                reply(200, { ok: true }); return;
            }
            if (path.startsWith('/api/students/') && ['PUT', 'DELETE'].includes(method)) {
                const id = path.slice('/api/students/'.length);
                const data = method === 'PUT' ? studentData(await readBody(req)) : null;
                if (!get('SELECT 1 FROM students WHERE id=?', id)) throw new ApiError(404, 'Student no longer exists. Refresh the page.');
                if (data) run('UPDATE students SET id=?,name=?,gender=?,avatar=? WHERE id=?', data.id, data.name, data.gender, data.avatar, id);
                else run('DELETE FROM students WHERE id=?', id);
                reply(200, { ok: true }); return;
            }
            if (method === 'PUT' && path === '/api/attendance') {
                const data = await readBody(req);
                const day = text(data, 'date', 10), period = text(data, 'session', 40);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day)
                    throw new ApiError(400, 'Choose a valid attendance date.');
                if (!periods.has(period)) throw new ApiError(400, 'Invalid session.');
                if (!data.records || typeof data.records !== 'object' || Array.isArray(data.records) || !Object.keys(data.records).length)
                    throw new ApiError(400, 'Select at least one student.');
                transaction(() => {
                    for (const [id, status] of Object.entries(data.records)) {
                        if (!['P', 'L', 'A', 'T'].includes(status)) throw new ApiError(400, 'Invalid attendance status.');
                        if (!get('SELECT 1 FROM students WHERE id=?', id)) throw new ApiError(400, 'Unknown student. Refresh the page.');
                        run('INSERT INTO attendance VALUES(?,?,?,?) ON CONFLICT(date,session,student_id) DO UPDATE SET status=excluded.status', day, period, id, status);
                    }
                });
                reply(200, { ok: true }); return;
            }
            throw new ApiError(404, 'API route not found.');
        } catch (error) {
            if (error.code?.startsWith('ERR_SQLITE') && /UNIQUE constraint failed/.test(error.message)) reply(409, { error: 'That student ID already exists.' });
            else {
                if (!error.status) console.error(error);
                reply(error.status || 500, { error: error.status ? error.message : 'Server error. Please try again.' });
            }
        }
    });
    server.on('close', () => db.close());
    return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || 3000);
    const server = createApp();
    server.listen(port, '127.0.0.1', () => console.log(`Class Attendance System: http://localhost:${server.address().port}`));
    server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
