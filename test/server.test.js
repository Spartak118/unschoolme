// Run with: npm test   (Node's built-in test runner, no extra dependencies)
// Each group starts its own server process on a free port with a temporary
// users file, so tests never touch data/users.json and rate limits don't leak
// between groups. A local mock stands in for the CRM — nothing is sent out.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STRONG_SECRET = 'test-only-' + 'x'.repeat(40);

function freePort() {
  return new Promise(resolve => { const s = http.createServer().listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

function run(env, { waitForListen = true, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env },
    });
    let out = '';
    const done = (result) => { clearTimeout(timer); resolve({ child, out, ...result }); };
    const timer = setTimeout(() => done({ timedOut: true }), timeoutMs);
    child.stdout.on('data', d => { out += d; if (waitForListen && out.includes('running at')) done({ started: true }); });
    child.stderr.on('data', d => { out += d; });
    child.on('exit', code => done({ exited: true, code }));
  });
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const usersFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'um-test-')), 'users.json');
  const r = await run({ PORT: String(port), USERS_FILE: usersFile, CRM_API_URL: 'http://127.0.0.1:9/disabled', ...extraEnv });
  assert.ok(r.started, 'server should start: ' + r.out);
  return { base: `http://127.0.0.1:${port}`, child: r.child, out: () => r.out };
}

const post = (base, p, body, headers = {}) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function listPages() {
  const pages = [];
  (function walk(dir, url, depth) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || (depth === 0 && ['node_modules', 'data', 'css', 'js', 'views', 'public', 'test'].includes(e.name))) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), `${url}/${e.name}`, depth + 1);
      else if (e.name === 'index.html') pages.push(url || '/');
    }
  })(ROOT, '', 0);
  return pages.sort();
}

describe('startup / SESSION_SECRET', () => {
  test('refuses to start in production when SESSION_SECRET is missing (NODE_ENV)', async () => {
    const r = await run({ NODE_ENV: 'production', PORT: String(await freePort()) }, { waitForListen: false });
    assert.ok(r.exited, 'process should exit');
    assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /SESSION_SECRET is not set/);
  });

  test('refuses to start on Vercel when SESSION_SECRET is missing', async () => {
    const r = await run({ VERCEL: '1', PORT: String(await freePort()) }, { waitForListen: false });
    assert.ok(r.exited); assert.notStrictEqual(r.code, 0);
  });

  test('refuses a short secret in production and never prints it', async () => {
    const shortSecret = 'tooShortValue123';
    const r = await run({ NODE_ENV: 'production', SESSION_SECRET: shortSecret, PORT: String(await freePort()) }, { waitForListen: false });
    assert.ok(r.exited); assert.notStrictEqual(r.code, 0);
    assert.match(r.out, /too short/);
    assert.ok(!r.out.includes(shortSecret), 'secret value must not appear in output');
  });

  test('starts in production with a strong secret and never prints it', async () => {
    const r = await run({ NODE_ENV: 'production', SESSION_SECRET: STRONG_SECRET, PORT: String(await freePort()), CRM_API_URL: 'https://127.0.0.1:9/x' });
    assert.ok(r.started, r.out);
    assert.ok(!r.out.includes(STRONG_SECRET));
    r.child.kill();
  });

  test('starts in development without a secret (random dev-only fallback)', async () => {
    const r = await run({ PORT: String(await freePort()), USERS_FILE: path.join(os.tmpdir(), 'um-dev-users.json') });
    assert.ok(r.started, r.out);
    r.child.kill();
  });

  test('module exports an Express handler for Vercel', () => {
    const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.match(src, /module\.exports = app/);
  });
});

describe('pages and private files', () => {
  let s;
  before(async () => { s = await startServer(); });
  after(() => s.child.kill());

  test('all 57 pages return 200 HTML', async () => {
    const pages = listPages();
    assert.strictEqual(pages.length, 57);
    for (const p of pages) {
      const r = await fetch(s.base + p, { redirect: 'manual' });
      assert.strictEqual(r.status, 200, p);
      assert.match(r.headers.get('content-type'), /text\/html/, p);
    }
  });

  test('trailing slash redirects to canonical URL', async () => {
    const r = await fetch(s.base + '/taxes/?a=1', { redirect: 'manual' });
    assert.strictEqual(r.status, 301);
    assert.strictEqual(r.headers.get('location'), '/taxes?a=1');
  });

  test('private files return 404', async () => {
    for (const p of ['/server.js', '/package.json', '/package-lock.json', '/data/users.json', '/data/knowledge.json',
      '/.vercel/project.json', '/.git/config', '/.env', '/node_modules/express/package.json', '/test/server.test.js', '/index.html', '/vercel.json']) {
      const r = await fetch(s.base + p, { redirect: 'manual' });
      assert.strictEqual(r.status, 404, p);
    }
  });

  test('assets and unknown routes', async () => {
    assert.strictEqual((await fetch(s.base + '/css/main.css')).status, 200);
    assert.strictEqual((await fetch(s.base + '/js/main.js')).status, 200);
    assert.strictEqual((await fetch(s.base + '/js/config.js')).status, 200);
    assert.strictEqual((await fetch(s.base + '/favicon.ico')).status, 200);
    assert.strictEqual((await fetch(s.base + '/does-not-exist')).status, 404);
    const api = await fetch(s.base + '/api/nope');
    assert.strictEqual(api.status, 404);
    assert.match(api.headers.get('content-type'), /json/);
  });
});

describe('authentication', () => {
  let s;
  const email = 'auth-test@example.test';
  before(async () => { s = await startServer(); });
  after(() => s.child.kill());

  test('register → session → logout → login', async () => {
    const reg = await post(s.base, '/api/register', { name: 'Auth Test', email, password: 'secret123', role: 'creator' });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie');
    assert.match(cookie, /um_session=/); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Lax/i);
    const regBody = await reg.json();
    assert.strictEqual(regBody.user.password, undefined, 'password hash must never be returned');

    const me = await (await fetch(s.base + '/api/me', { headers: { cookie: cookie.split(';')[0] } })).json();
    assert.strictEqual(me.user.email, email);

    const out = await post(s.base, '/api/logout', {});
    assert.match(out.headers.get('set-cookie'), /um_session=;/);

    const ok = await post(s.base, '/api/login', { email: email.toUpperCase(), password: 'secret123' });
    assert.strictEqual(ok.status, 200);
  });

  test('tampered session cookie is rejected', async () => {
    const ok = await post(s.base, '/api/login', { email, password: 'secret123' });
    const [payload, sig] = ok.headers.get('set-cookie').split(';')[0].split('=')[1].split('.');
    const forged = Buffer.from(JSON.stringify({ user: { email: 'admin@x.y', role: 'creator' }, exp: Date.now() + 1e9 })).toString('base64url');
    const me = await (await fetch(s.base + '/api/me', { headers: { cookie: `um_session=${forged}.${sig}` } })).json();
    assert.strictEqual(me.user, null);
    assert.ok(payload);
  });

  test('duplicate email → 409, bad input → 400', async () => {
    assert.strictEqual((await post(s.base, '/api/register', { name: 'X', email, password: 'secret123' })).status, 409);
    assert.strictEqual((await post(s.base, '/api/register', { name: 'X', email: 'bad', password: 'secret123' })).status, 400);
    assert.strictEqual((await post(s.base, '/api/register', { name: 'X', email: 'a@b.co', password: '123' })).status, 400);
    assert.strictEqual((await post(s.base, '/api/login', '{not json')).status, 400);
    assert.strictEqual((await post(s.base, '/api/login', {})).status, 400);
  });

  test('wrong password → 401 with generic message (same for unknown email)', async () => {
    const a = await post(s.base, '/api/login', { email, password: 'nope-1' });
    const b = await post(s.base, '/api/login', { email: 'nobody@example.test', password: 'nope-1' });
    assert.strictEqual(a.status, 401); assert.strictEqual(b.status, 401);
    assert.strictEqual((await a.json()).error, (await b.json()).error);
  });

  test('cross-site POST is rejected with 403', async () => {
    const r = await post(s.base, '/api/login', { email, password: 'secret123' }, { Origin: 'https://evil.example' });
    assert.strictEqual(r.status, 403);
  });
});

describe('login rate limiting', () => {
  let s;
  const email = 'limit-test@example.test';
  before(async () => {
    s = await startServer();
    await post(s.base, '/api/register', { name: 'Limit Test', email, password: 'right-pass' });
  });
  after(() => s.child.kill());

  test('5 failures per IP+email → 429 with Retry-After; other accounts unaffected', async () => {
    for (let i = 0; i < 5; i++) assert.strictEqual((await post(s.base, '/api/login', { email, password: 'wrong' })).status, 401);
    const blocked = await post(s.base, '/api/login', { email, password: 'right-pass' });
    assert.strictEqual(blocked.status, 429, 'even the right password waits until the window expires');
    const retry = Number(blocked.headers.get('retry-after'));
    assert.ok(retry > 0 && retry <= 15 * 60, 'temporary lockout, at most 15 minutes');
    assert.match((await blocked.json()).error, /try again in \d+ minute/);
    // a different account from the same IP is not locked
    assert.strictEqual((await post(s.base, '/api/login', { email: 'other@example.test', password: 'x' })).status, 401);
  });

  test('30 attempts per IP → 429', async () => {
    let last;
    for (let i = 0; i < 30; i++) last = await post(s.base, '/api/login', { email: `u${i}@example.test`, password: 'x' });
    assert.strictEqual(last.status, 429);
  });
});

describe('registration abuse protection + CRM sync', () => {
  let s, crm, received = [];
  before(async () => {
    const crmPort = await freePort();
    crm = http.createServer((req, res) => {
      let body = ''; req.on('data', d => body += d);
      req.on('end', () => { received.push({ auth: req.headers.authorization, body: JSON.parse(body) }); res.end('{}'); });
    }).listen(crmPort);
    s = await startServer({ CRM_API_URL: `http://127.0.0.1:${crmPort}/api/customers`, CRM_API_KEY: 'test-crm-key' });
  });
  after(() => { s.child.kill(); crm.close(); });

  test('valid signup syncs sanitized data to the CRM with the server-side key', async () => {
    const r = await post(s.base, '/api/register', { name: '  Ada\u0007 Lovelace ', email: 'ADA@Example.test', password: 'secret123', phone: '(555) 123-4567', role: 'admin' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(received.length, 1);
    const { auth, body } = received[0];
    assert.strictEqual(auth, 'Bearer test-crm-key');
    assert.deepStrictEqual([body.firstName, body.lastName, body.email, body.type], ['Ada', 'Lovelace', 'ada@example.test', 'learner']);
    assert.ok(!s.out().includes('test-crm-key'), 'CRM key must not be logged');
  });

  test('invalid / bot / cross-site signups never reach the CRM', async () => {
    const before = received.length;
    assert.strictEqual((await post(s.base, '/api/register', { name: 'Bot', email: 'bot@example.test', password: 'secret123', website: 'http://spam' })).status, 400);
    assert.strictEqual((await post(s.base, '/api/register', { name: 'P', email: 'p@example.test', password: 'secret123', phone: '<script>' })).status, 400);
    assert.strictEqual((await post(s.base, '/api/register', { name: 'x'.repeat(101), email: 'n@example.test', password: 'secret123' })).status, 400);
    assert.strictEqual((await post(s.base, '/api/register', { name: 'C', email: 'c@example.test', password: 'secret123' }, { Origin: 'https://evil.example' })).status, 403);
    assert.strictEqual((await post(s.base, '/api/register', { name: 'Ada', email: 'ada@example.test', password: 'secret123' })).status, 409);
    assert.strictEqual(received.length, before);
  });

  test('more than 10 signup attempts per IP per hour → 429', async () => {
    let last;
    for (let i = 0; i < 6; i++) last = await post(s.base, '/api/register', { name: 'R', email: `r${i}@x`, password: 'secret123' });
    assert.strictEqual(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
  });
});
