const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

// ── SESSIONS ─────────────────────────────────────────────────────────
// Stateless, HMAC-signed cookie. On Vercel every request can hit a different
// function instance, so an in-memory session store (express-session's default
// MemoryStore) silently loses sessions. A signed cookie works on any instance.
//
// Production (NODE_ENV=production or running on Vercel) REQUIRES a strong
// SESSION_SECRET. Without one the module throws at load time, so the server
// refuses to start (locally: exit code 1; on Vercel: every request fails with
// a 500 instead of silently issuing forgeable cookies). The secret's value is
// never logged — error messages only mention the variable name.
const MIN_SECRET_LENGTH = 32;
function resolveSessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= MIN_SECRET_LENGTH) return s;
  if (IS_PROD) {
    throw new Error(s
      ? `SESSION_SECRET is too short (minimum ${MIN_SECRET_LENGTH} characters). Refusing to start.`
      : 'SESSION_SECRET is not set. Refusing to start in production. Set it in the Vercel project environment variables.');
  }
  if (s) console.warn(`[unschoolme] SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters (allowed in development only).`);
  // Development-only fallback: random per process, so it is never a known value.
  // Sessions simply reset when the local dev server restarts.
  return s || crypto.randomBytes(32).toString('hex');
}
const SESSION_SECRET = resolveSessionSecret();
const SESSION_COOKIE = 'um_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function readSession(req) {
  const header = req.headers.cookie || '';
  const raw = header.split(';').map(s => s.trim()).find(s => s.startsWith(SESSION_COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = decodeURIComponent(raw.slice(SESSION_COOKIE.length + 1)).split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data.user || null;
  } catch { return null; }
}

function writeSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ user, exp: Date.now() + SESSION_MAX_AGE_MS })).toString('base64url');
  res.cookie(SESSION_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: 'lax', secure: IS_PROD, maxAge: SESSION_MAX_AGE_MS, path: '/'
  });
}

// ── USER STORE ───────────────────────────────────────────────────────
// Users are kept in memory and mirrored to data/users.json when the filesystem
// is writable (local dev). Vercel's filesystem is read-only, so in production
// accounts only live as long as the function instance — a real database is
// required for durable accounts (see README / deployment notes).
const USERS_FILE = process.env.USERS_FILE || path.join(ROOT, 'data', 'users.json'); // override used by tests
let users = [];
try {
  const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  if (Array.isArray(parsed)) users = parsed;
} catch { /* no file yet */ }

function persistUsers() {
  try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
  catch { /* read-only filesystem (Vercel) — keep in memory only */ }
}

function toSafeUser(u) {
  const { password, ...safe } = u;
  return safe;
}

// ── STATIC ASSETS ────────────────────────────────────────────────────
// Only these folders are public. Previously express.static(__dirname) exposed
// server.js, package.json, data/users.json, .vercel/ and node_modules/.
app.use('/css', express.static(path.join(ROOT, 'css'), { fallthrough: false }));
app.use('/js', express.static(path.join(ROOT, 'js'), { index: false }));
app.get(['/favicon.svg', '/favicon.ico'], (req, res) => {
  res.type('image/svg+xml').sendFile(path.join(ROOT, 'favicon.svg'));
});

// Publicly-safe config generated from server env vars, so affiliate links and
// the contact address can be set in Vercel — no code changes needed.
// Unset values are sent as null and the matching UI is hidden / falls back.
app.get('/js/config.js', (req, res) => {
  res.type('application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  const cfg = {
    affiliate: {
      banking: process.env.NEXT_PUBLIC_AFFILIATE_BANKING || null,
      credit: process.env.NEXT_PUBLIC_AFFILIATE_CREDIT || null,
    },
    contactEmail: process.env.CONTACT_EMAIL || null,
  };
  res.send(`window.AFFILIATE_LINKS = ${JSON.stringify(cfg.affiliate)};\nwindow.SITE_CONFIG = ${JSON.stringify({ contactEmail: cfg.contactEmail })};`);
});

// ── RATE LIMITING ────────────────────────────────────────────────────
// Fixed-window counters held in memory. On Vercel (Fluid Compute) an instance
// serves many requests, so this stops bursts and credential stuffing hitting
// an instance, but counters are NOT shared between instances or kept across
// cold starts. For a hard global limit add a Vercel Firewall rate-limit rule
// on /api/login and /api/register (see deployment notes). Lockouts always
// expire with the window — nobody is locked out permanently.
const MAX_TRACKED_KEYS = 10000;
function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const prune = (now) => {
    for (const [k, e] of hits) if (e.reset <= now) hits.delete(k);
    if (hits.size > MAX_TRACKED_KEYS) hits.clear(); // memory safety valve
  };
  const entry = (key, now) => {
    let e = hits.get(key);
    if (!e || e.reset <= now) {
      if (hits.size >= MAX_TRACKED_KEYS) prune(now);
      e = { count: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    return e;
  };
  return {
    // seconds until allowed again, or 0 if not limited
    blockedFor(key) {
      const now = Date.now(); const e = hits.get(key);
      return e && e.reset > now && e.count >= max ? Math.ceil((e.reset - now) / 1000) : 0;
    },
    hit(key) { entry(key, Date.now()).count++; },
    reset(key) { hits.delete(key); },
  };
}

const MIN = 60 * 1000;
const loginIpLimiter = createLimiter({ windowMs: 15 * MIN, max: 30 });       // all login attempts per IP
const loginFailLimiter = createLimiter({ windowMs: 15 * MIN, max: 5 });      // failed attempts per IP + email
const registerIpLimiter = createLimiter({ windowMs: 60 * MIN, max: 10 });    // signup attempts per IP

// Client IP. On Vercel, x-forwarded-for is set by the platform (client-supplied
// values are overwritten), so it is trustworthy there. Elsewhere use the socket
// address so the header can't be spoofed to dodge limits.
function clientIp(req) {
  if (process.env.VERCEL) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

function tooMany(res, seconds, message) {
  res.setHeader('Retry-After', String(seconds));
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return res.status(429).json({ success: false, error: `${message} Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
}

// Browsers always send Origin on cross-site POSTs. Reject those so other
// sites can't drive signups/logins (and CRM writes) from a visitor's browser.
function isCrossSite(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host !== host;
  } catch { return true; }
}

// ── API ──────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+().\-\s]{7,25}$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const clean = (v, max) => String(v == null ? '' : v).replace(CONTROL_CHARS, '').trim().slice(0, max + 1);

// CRM sync target. Optional CRM_API_KEY is sent as a Bearer token (server-side
// only — never sent to the browser or logged). Non-https URLs are refused in
// production so user data is never sent in cleartext.
const CRM_URL = process.env.CRM_API_URL || 'https://crm-backend-flame.vercel.app/api/customers';
const CRM_ENABLED = (() => {
  try {
    const u = new URL(CRM_URL);
    if (IS_PROD && u.protocol !== 'https:') { console.warn('[unschoolme] CRM_API_URL must use https in production — CRM sync disabled.'); return false; }
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { console.warn('[unschoolme] CRM_API_URL is not a valid URL — CRM sync disabled.'); return false; }
})();

async function syncToCrm({ name, email, phone, role }) {
  if (!CRM_ENABLED) return;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CRM_API_KEY) headers.Authorization = `Bearer ${process.env.CRM_API_KEY}`;
  try {
    const r = await fetch(CRM_URL, {
      method: 'POST',
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        source: 'UnschoolMe', type: role,
        firstName: name.split(/\s+/)[0], lastName: name.split(/\s+/).slice(1).join(' '),
        email, phone, notes: 'Registered via UnschoolMe'
      })
    });
    if (!r.ok) console.log('CRM sync returned status', r.status); // no user data in logs
  } catch (crmErr) {
    console.log('CRM sync failed (non-fatal):', crmErr.name);
  }
}

app.post('/api/register', async (req, res) => {
  try {
    if (isCrossSite(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const ip = clientIp(req);
    const wait = registerIpLimiter.blockedFor(ip);
    if (wait) return tooMany(res, wait, 'Too many sign-up attempts.');
    registerIpLimiter.hit(ip);

    const body = req.body || {};
    // Honeypot: a hidden field real users never fill in.
    if (body.website) return res.status(400).json({ success: false, error: 'Could not create account' });

    const name = clean(body.name, 100);
    const email = clean(body.email, 254).toLowerCase();
    const password = String(body.password || '');
    const phone = clean(body.phone, 25);
    const role = body.role === 'creator' ? 'creator' : 'learner';
    if (!name || !email || !password) return res.status(400).json({ success: false, error: 'Missing required fields' });
    if (name.length > 100) return res.status(400).json({ success: false, error: 'Name must be 100 characters or fewer' });
    if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Please enter a valid email address' });
    if (phone && !PHONE_RE.test(phone)) return res.status(400).json({ success: false, error: 'Please enter a valid phone number' });
    if (password.length < 6) return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    if (password.length > 128) return res.status(400).json({ success: false, error: 'Password must be 128 characters or fewer' });
    if (users.find(u => u.email === email)) return res.status(409).json({ success: false, error: 'Email already registered' });

    const user = { id: uuidv4(), name, email, phone, password: await bcrypt.hash(password, 10), role, created_at: new Date().toISOString() };
    users.push(user);
    persistUsers();
    const safeUser = toSafeUser(user);
    writeSession(res, safeUser);

    // Only validated, newly created accounts reach the CRM (bounded by a timeout).
    await syncToCrm(user);

    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// Used to make "unknown email" take as long as "wrong password" (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

app.post('/api/login', async (req, res) => {
  try {
    if (isCrossSite(req)) return res.status(403).json({ success: false, error: 'Forbidden' });
    const ip = clientIp(req);
    const ipWait = loginIpLimiter.blockedFor(ip);
    if (ipWait) return tooMany(res, ipWait, 'Too many login attempts.');
    loginIpLimiter.hit(ip);

    const email = clean((req.body || {}).email, 254).toLowerCase();
    const password = String((req.body || {}).password || '');
    if (!email || !password) return res.status(400).json({ success: false, error: 'Missing fields' });
    if (password.length > 128) return res.status(401).json({ success: false, error: 'Invalid email or password' });

    // Failures are counted per IP + email, so an attacker elsewhere can't lock
    // a real user out of their own account.
    const failKey = `${ip}|${email}`;
    const failWait = loginFailLimiter.blockedFor(failKey);
    if (failWait) return tooMany(res, failWait, 'Too many failed attempts for this account.');

    const user = users.find(u => u.email === email);
    const match = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);
    if (!user || !match) {
      loginFailLimiter.hit(failKey);
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }
    loginFailLimiter.reset(failKey);
    const safeUser = toSafeUser(user);
    writeSession(res, safeUser);
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: readSession(req) });
});

let knowledge = null;
function getKnowledge() {
  if (!knowledge) knowledge = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'knowledge.json'), 'utf8'));
  return knowledge;
}

app.post('/api/chat', (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.json({ answer: 'Please ask me something!' });
    const q = message.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;
    getKnowledge().entries.forEach(entry => {
      let score = 0;
      entry.keywords.forEach(keyword => {
        if (q.includes(keyword.toLowerCase())) score += keyword.split(' ').length;
      });
      if (score > bestScore) { bestScore = score; bestMatch = entry; }
    });
    if (bestMatch && bestScore > 0) {
      res.json({ answer: bestMatch.answer, topic: bestMatch.question });
    } else {
      res.json({ answer: "Try asking about taxes, credit scores, banking, government, business, your rights, or any US state salary." });
    }
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ answer: 'Chat unavailable right now.' });
  }
});

app.all('/api/*', (req, res) => res.status(404).json({ error: 'Not found' }));

// ── PAGES ────────────────────────────────────────────────────────────
// Every folder containing an index.html is a page: /taxes, /taxes/how-taxes-work…
// Pages are discovered at startup, so new articles work without touching this
// file (previously each route was hand-listed and many articles were missing).
const NON_PAGE_DIRS = new Set(['node_modules', 'data', 'css', 'js', 'views', 'public']);
const PAGES = new Map();
(function discover(dir, urlPath) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      if (urlPath === '' && NON_PAGE_DIRS.has(entry.name)) continue;
      discover(path.join(dir, entry.name), `${urlPath}/${entry.name}`);
    } else if (entry.name === 'index.html') {
      PAGES.set(urlPath || '/', path.join(dir, entry.name));
    }
  }
})(ROOT, '');

app.get('*', (req, res, next) => {
  const [pathname, query] = [req.path, req.originalUrl.slice(req.path.length)];
  // Canonical URLs have no trailing slash: /taxes/ → /taxes
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return res.redirect(301, pathname.replace(/\/+$/, '') + query);
  }
  const file = PAGES.get(pathname);
  if (!file) return next();
  res.sendFile(file);
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(ROOT, '404.html'));
});

app.use((err, req, res, next) => {
  if (err.status === 404 || err.statusCode === 404) return res.status(404).sendFile(path.join(ROOT, '404.html'));
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, error: 'Invalid request body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'Request too large' });
  console.error(err.message);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Server error' });
  res.status(500).send('Something went wrong.');
});

// Vercel (@vercel/node) imports this module and uses the exported app as the
// request handler; app.listen only runs for local development.
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`UnschoolMe running at http://localhost:${PORT}`));
}
