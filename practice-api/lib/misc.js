// Teaching endpoints: echo, any status code, slow, redirects, rate limit, files, async jobs, idempotent
// payments, webhooks, request logs, CORS, OAuth 2.0, the deliberately insecure endpoints, reset.
'use strict';
const crypto = require('node:crypto');
const { send, error, requireJson, log, LOG, uid, now, isEmail } = require('./core');
const { db, reset } = require('./data');
const A = require('./auth');

// ---------------------------------------------------------------- echo: shows exactly what the server received
function echo(req, res) {
  const files = (req.files || []).map((f) => ({ field: f.name, filename: f.filename, type: f.type, size: f.data.length }));
  send(res, 200, {
    method: req.method,
    path: req.path,
    query: Object.fromEntries(req.query),
    headers: req.headers,
    contentType: req.headers['content-type'] || null,
    body: req.body === undefined ? null : req.body,
    files,
  });
}

// ---------------------------------------------------------------- any status code
const REASONS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 415: 'Unsupported Media Type', 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
function status(req, res, codeText) {
  const code = Number(codeText);
  if (!/^\d{3}$/.test(codeText) || code < 200 || code > 599) return error(res, 400, 'INVALID_STATUS', 'Use a status code from 200 to 599, for example /api/status/404.');
  if (code === 204 || code === 304) return send(res, code);
  const extra = code === 503 ? { 'Retry-After': '30' } : {};
  send(res, code, { status: code, reason: REASONS[code] || 'See the HTTP specification', message: `You asked for status ${code}.` }, extra);
}

// ---------------------------------------------------------------- slow responses
function slow(req, res) {
  const ms = req.query.has('ms') ? req.query.get('ms') : '2000';
  if (!/^\d+$/.test(ms) || Number(ms) > 10000) return error(res, 400, 'INVALID_DELAY', 'ms must be a whole number from 0 to 10000.');
  setTimeout(() => send(res, 200, { message: `This response waited ${ms} ms on purpose.`, delayMs: Number(ms) }), Number(ms));
}

// ---------------------------------------------------------------- redirects
const redirect = (code, to) => (req, res) => send(res, code, { message: `Moved. Follow the Location header to ${to}.` }, { Location: to });

// ---------------------------------------------------------------- rate limit: 5 requests per 10 seconds per client
const WINDOW_MS = 10000, LIMIT = 5;
const hits = new Map();
function limited(req, res) {
  const key = req.socket.remoteAddress;
  const t = Date.now();
  const list = (hits.get(key) || []).filter((x) => t - x < WINDOW_MS);
  const resetAt = list.length ? Math.ceil((list[0] + WINDOW_MS - t) / 1000) : WINDOW_MS / 1000;
  res.setHeader('X-RateLimit-Limit', LIMIT);
  if (list.length >= LIMIT) {
    hits.set(key, list);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', resetAt);
    res.setHeader('Retry-After', resetAt);
    return error(res, 429, 'RATE_LIMITED', `Only ${LIMIT} requests are allowed every ${WINDOW_MS / 1000} seconds. Try again in ${resetAt} s.`);
  }
  list.push(t);
  hits.set(key, list);
  res.setHeader('X-RateLimit-Remaining', LIMIT - list.length);
  res.setHeader('X-RateLimit-Reset', Math.ceil((list[0] + WINDOW_MS - t) / 1000));
  send(res, 200, { message: 'OK, you are within the limit.', remaining: LIMIT - list.length });
}

// ---------------------------------------------------------------- files
const ALLOWED = { '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };
function upload(req, res) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('multipart/form-data')) return error(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload the file as form-data (multipart/form-data) with the key "file".');
  const f = (req.files || []).find((x) => x.name === 'file');
  if (!f) return error(res, 400, 'FILE_REQUIRED', 'Add a form-data field named "file" of type File.');
  if (!f.data.length) return error(res, 400, 'FILE_EMPTY', 'The uploaded file is empty.');
  const ext = (f.filename.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!ALLOWED[ext]) return error(res, 400, 'FILE_TYPE_NOT_ALLOWED', `Allowed file types: ${Object.keys(ALLOWED).join(', ')}.`);
  const id = uid().slice(0, 8);
  db.files[id] = { id, name: f.filename, type: ALLOWED[ext], size: f.data.length, data: f.data, description: (req.body && req.body.description) || null, uploadedAt: now() };
  const { data, ...meta } = db.files[id];
  send(res, 201, { ...meta, downloadUrl: `/api/files/${id}` }, { Location: `/api/files/${id}` });
}

const SAMPLE_CSV = 'id,name,price\n1,Wireless Mouse,799\n2,Mechanical Keyboard,3499\n3,USB-C Charger,1299\n';
function download(req, res, id) {
  if (id === 'sample') return send(res, 200, SAMPLE_CSV, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="products.csv"' });
  const f = db.files[id];
  if (!f) return error(res, 404, 'FILE_NOT_FOUND', `No file with id ${id}.`);
  send(res, 200, f.data, { 'Content-Type': f.type, 'Content-Disposition': `attachment; filename="${f.name}"` });
}

// ---------------------------------------------------------------- async jobs (202 Accepted + polling)
function startReport(req, res) {
  if (!requireJson(req, res)) return;
  const type = req.body.type;
  if (!['sales', 'stock'].includes(type)) return error(res, 400, 'VALIDATION_FAILED', 'type must be "sales" or "stock".', [{ field: 'type', message: 'type must be "sales" or "stock".' }]);
  const id = uid().slice(0, 8);
  db.jobs[id] = { id, type, startedAt: Date.now() };
  send(res, 202, { jobId: id, status: 'PENDING', statusUrl: `/api/jobs/${id}` }, { Location: `/api/jobs/${id}`, 'Retry-After': '1' });
}

function jobStatus(req, res, id) {
  const j = db.jobs[id];
  if (!j) return error(res, 404, 'JOB_NOT_FOUND', `No job with id ${id}.`);
  const age = Date.now() - j.startedAt;
  if (age < 1000) return send(res, 200, { jobId: id, status: 'PENDING', progress: 0 }, { 'Retry-After': '1' });
  if (age < 3000) return send(res, 200, { jobId: id, status: 'RUNNING', progress: Math.min(99, Math.round((age - 1000) / 20)) }, { 'Retry-After': '1' });
  const result = j.type === 'sales'
    ? { orders: db.orders.filter((o) => o.status !== 'CANCELLED').length, revenue: db.orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.total, 0) }
    : { products: db.products.length, outOfStock: db.products.filter((p) => p.stock === 0).map((p) => p.name) };
  send(res, 200, { jobId: id, status: 'DONE', progress: 100, result });
}

// ---------------------------------------------------------------- idempotent payments
function pay(req, res) {
  const key = req.headers['idempotency-key'];
  if (!key) return error(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (for example a UUID) so a retried payment is never charged twice.');
  if (!requireJson(req, res)) return;
  const { orderId, amount } = req.body;
  const hash = crypto.createHash('sha1').update(JSON.stringify({ orderId, amount })).digest('hex');
  const seen = db.payments[key];
  if (seen) {
    if (seen.hash !== hash) return error(res, 422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different body. Use a new key for a new payment.');
    return send(res, seen.status, seen.body, { 'Idempotent-Replayed': 'true' });
  }
  const errs = [];
  if (!Number.isInteger(orderId)) errs.push({ field: 'orderId', message: 'orderId must be a whole number.' });
  if (typeof amount !== 'number' || amount <= 0) errs.push({ field: 'amount', message: 'amount must be a number greater than 0.' });
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Some fields are missing or wrong.', errs);
  const body = { paymentId: 'pay_' + uid().slice(0, 8), orderId, amount, currency: 'INR', status: 'CAPTURED', createdAt: now() };
  db.payments[key] = { hash, status: 201, body };
  send(res, 201, body);
}

// ---------------------------------------------------------------- webhooks
function subscribe(req, res) {
  if (!requireJson(req, res)) return;
  const url = req.body.url;
  let u;
  try { u = new URL(url); } catch { return error(res, 400, 'INVALID_URL', 'url must be a full URL like http://localhost:3000/webhook-inbox.'); }
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname)) return error(res, 400, 'INVALID_URL', 'For safety this practice server only calls http://localhost URLs.');
  const h = { id: db.webhooks.length + 1, url, events: ['order.created'] };
  db.webhooks.push(h);
  send(res, 201, h);
}
const listHooks = (req, res) => send(res, 200, { data: db.webhooks });
function clearHooks(req, res) { db.webhooks = []; send(res, 204); }
function inboxPost(req, res) { db.inbox.push({ receivedAt: now(), event: req.headers['x-webhook-event'] || null, body: req.body }); send(res, 200, { received: true }); }
const inboxGet = (req, res) => send(res, 200, { data: db.inbox, total: db.inbox.length });
function inboxClear(req, res) { db.inbox = []; send(res, 204); }

// ---------------------------------------------------------------- server log, filtered by request id
function logs(req, res) {
  const id = req.query.get('requestId');
  if (!id) return error(res, 400, 'REQUEST_ID_REQUIRED', 'Add ?requestId=<the X-Request-Id of a response>.');
  send(res, 200, { requestId: id, entries: LOG.filter((e) => e.requestId === id) });
}

// ---------------------------------------------------------------- CORS
function corsOpen(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return send(res, 204);
  }
  send(res, 200, { message: 'This response allows any website (origin) to read it.' });
}
const corsClosed = (req, res) => send(res, 200, { message: 'No Access-Control-Allow-Origin header here, so browsers block other websites from reading this. Postman does not care.' });
const CORS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>CORS demo</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;line-height:1.5}button{padding:8px 14px;margin:4px}pre{background:#f4f4f4;padding:12px;white-space:pre-wrap}</style></head>
<body><h1>CORS demo</h1>
<p>This page is loaded from <b>http://localhost:3000</b>. The buttons call the same API through <b>http://127.0.0.1:3000</b>, which the browser treats as a different origin.</p>
<button onclick="go('/api/cors/open')">Call /api/cors/open</button>
<button onclick="go('/api/cors/closed')">Call /api/cors/closed</button>
<pre id="out">Click a button. For the closed one, open DevTools (F12) &gt; Console to see the CORS error.</pre>
<script>
async function go(path){
  const out=document.getElementById('out');
  try{const r=await fetch('http://127.0.0.1:3000'+path);out.textContent='Status '+r.status+'\\n'+await r.text();}
  catch(e){out.textContent='Blocked by the browser: '+e.message+'\\nThe server DID answer (look in the Network tab), but the browser hid the response because there is no Access-Control-Allow-Origin header.';}
}
</script></body></html>`;
const corsPage = (req, res) => send(res, 200, CORS_PAGE, { 'Content-Type': 'text/html; charset=utf-8' });

// ---------------------------------------------------------------- OAuth 2.0 (authorization code, client credentials, refresh)
const codes = {};     // code -> { clientId, redirectUri, scope, user, expires }
const refreshTokens = {};
function clientFrom(req) {
  const b = req.body || {};
  const h = req.headers.authorization || '';
  if (/^Basic\s+/i.test(h)) {
    const [id, ...s] = Buffer.from(h.replace(/^Basic\s+/i, ''), 'base64').toString().split(':');
    return { id: decodeURIComponent(id), secret: decodeURIComponent(s.join(':')) };
  }
  return { id: b.client_id, secret: b.client_secret };
}
const oauthErr = (res, status, code, desc) => send(res, status, { error: code, error_description: desc });

function authorizePage(req, res) {
  const q = req.query;
  const client = A.OAUTH_CLIENTS[q.get('client_id')];
  if (q.get('response_type') !== 'code') return send(res, 400, 'response_type must be "code".');
  if (!client) return send(res, 400, 'Unknown client_id.');
  const redirect = q.get('redirect_uri') || client.redirectUris[0];
  if (!client.redirectUris.includes(redirect)) return send(res, 400, `redirect_uri ${redirect} is not registered for this client.`);
  const scope = q.get('scope') || 'orders:read';
  const state = q.get('state') || '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Practice API - Sign in</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:60px auto}button{padding:10px 18px;font-size:16px}</style></head><body>
<h2>Practice API</h2><p><b>Postman (postman-client)</b> wants to access your account with these permissions:</p><p><code>${scope.replace(/</g, '&lt;')}</code></p>
<form method="post" action="/oauth/authorize">
<input type="hidden" name="client_id" value="${q.get('client_id')}"><input type="hidden" name="redirect_uri" value="${redirect}">
<input type="hidden" name="scope" value="${scope.replace(/"/g, '&quot;')}"><input type="hidden" name="state" value="${state.replace(/"/g, '&quot;')}">
<p>Username <input name="username" value="tester"></p><p>Password <input name="password" type="password" value="Test@123"></p>
<button type="submit">Allow</button></form></body></html>`;
  send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
}

function authorizeSubmit(req, res) {
  const b = req.body || {};
  const client = A.OAUTH_CLIENTS[b.client_id];
  if (!client || !client.redirectUris.includes(b.redirect_uri)) return send(res, 400, 'Invalid client or redirect_uri.');
  const acc = db.accounts.find((a) => a.username === b.username && a.password === b.password);
  if (!acc) return send(res, 401, 'Wrong username or password. Go back and try again.');
  const code = uid().replace(/-/g, '').slice(0, 20);
  codes[code] = { clientId: b.client_id, redirectUri: b.redirect_uri, scope: b.scope, user: acc, expires: Date.now() + 60000 };
  const loc = `${b.redirect_uri}?code=${code}${b.state ? '&state=' + encodeURIComponent(b.state) : ''}`;
  send(res, 302, `Redirecting to ${loc}`, { Location: loc });
}

function token(req, res) {
  const b = req.body || {};
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/x-www-form-urlencoded') && !ct.includes('application/json')) return oauthErr(res, 400, 'invalid_request', 'Send the token request as x-www-form-urlencoded.');
  const c = clientFrom(req);
  const client = A.OAUTH_CLIENTS[c.id];
  if (!client || client.secret !== c.secret) {
    res.setHeader('WWW-Authenticate', 'Basic realm="oauth"');
    return oauthErr(res, 401, 'invalid_client', 'client_id or client_secret is wrong.');
  }
  const issue = (sub, role, scope, withRefresh) => {
    const access = A.signJwt({ sub, role, scope, client_id: c.id }, 900);
    const out = { access_token: access, token_type: 'Bearer', expires_in: 900, scope };
    if (withRefresh) {
      const r = uid().replace(/-/g, '');
      refreshTokens[r] = { sub, role, scope, clientId: c.id };
      out.refresh_token = r;
    }
    return send(res, 200, out, { 'Cache-Control': 'no-store' });
  };
  switch (b.grant_type) {
    case 'authorization_code': {
      const entry = codes[b.code];
      if (!entry || entry.clientId !== c.id || entry.expires < Date.now()) return oauthErr(res, 400, 'invalid_grant', 'The code is wrong, expired or already used.');
      if (b.redirect_uri && b.redirect_uri !== entry.redirectUri) return oauthErr(res, 400, 'invalid_grant', 'redirect_uri does not match the one used to get the code.');
      delete codes[b.code];
      return issue(entry.user.username, entry.user.role, entry.scope, true);
    }
    case 'client_credentials':
      return issue(c.id, 'service', b.scope || 'reports:read', false);
    case 'refresh_token': {
      const r = refreshTokens[b.refresh_token];
      if (!r || r.clientId !== c.id) return oauthErr(res, 400, 'invalid_grant', 'The refresh token is wrong or was already used.');
      delete refreshTokens[b.refresh_token];
      return issue(r.sub, r.role, r.scope, true);
    }
    default:
      return oauthErr(res, 400, 'unsupported_grant_type', 'grant_type must be authorization_code, client_credentials or refresh_token.');
  }
}

function oauthCallback(req, res) {
  send(res, 200, { message: 'This is where the authorization server sends the user back. Copy the code below into the token request.', code: req.query.get('code'), state: req.query.get('state') });
}

// ---------------------------------------------------------------- DELIBERATELY INSECURE endpoints (security chapter)
// 1. BOLA / IDOR: any logged-in user can read any order by changing the id.
function insecureOrder(req, res, idText) {
  const u = A.requireToken(req, res);
  if (!u) return;
  const o = db.orders.find((x) => String(x.id) === idText);
  if (!o) return error(res, 404, 'ORDER_NOT_FOUND', `No order with id ${idText}.`);
  send(res, 200, o); // BUG: no owner check
}

// 2. Mass assignment: the client can set "role" and become admin.
function insecureRegister(req, res) {
  if (!requireJson(req, res)) return;
  const b = req.body;
  if (!b.username || !b.password) return error(res, 400, 'VALIDATION_FAILED', 'username and password are required.');
  if (db.accounts.some((a) => a.username === b.username)) return error(res, 409, 'USERNAME_TAKEN', `${b.username} already exists.`);
  const acc = { role: 'user', name: b.username, ...b }; // BUG: copies every field the client sent, including role
  db.accounts.push(acc);
  send(res, 201, { username: acc.username, role: acc.role, name: acc.name });
}

// 3. Broken token check: reads the token without verifying the signature.
function insecureProfile(req, res) {
  const t = A.bearer(req);
  if (!t) return error(res, 401, 'UNAUTHORIZED', 'Send Authorization: Bearer <token>.');
  const p = A.decodeJwtUnsafe(t); // BUG: signature and expiry are never checked
  if (!p) return error(res, 401, 'INVALID_TOKEN', 'Could not read the token.');
  send(res, 200, { username: p.sub, role: p.role, secretAdminData: p.role === 'admin' ? 'Quarterly revenue: 48,20,000 INR' : null });
}

// 4. Excessive data exposure + verbose errors.
function insecureSearch(req, res) {
  const q = req.query.get('q') || '';
  if (q.includes("'")) {
    return send(res, 500, { error: 'SQLException: You have an error in your SQL syntax near \'' + q + '\'', query: `SELECT * FROM accounts WHERE username LIKE '%${q}%'`, stack: 'at AccountRepository.search (AccountRepository.java:42)\n  at SearchController.handle (SearchController.java:17)' });
  }
  const found = db.accounts.filter((a) => a.username.includes(q)).map((a) => ({ ...a, passwordHash: crypto.createHash('md5').update(a.password).digest('hex'), password: undefined }));
  send(res, 200, { data: found }); // BUG: returns password hashes and internal fields
}

// ---------------------------------------------------------------- reset + database view
function doReset(req, res) { reset(); hits.clear(); send(res, 200, { message: 'All data is back to the starting state.' }); }
function dbView(req, res) {
  const table = req.query.get('table');
  const tables = { users: db.users, products: db.products, orders: db.orders };
  if (table) {
    if (!tables[table]) return error(res, 400, 'UNKNOWN_TABLE', 'table must be users, products or orders.');
    return send(res, 200, { table, rows: tables[table] });
  }
  send(res, 200, { tables: Object.keys(tables), hint: 'Add ?table=users (or products, orders) to see the rows.' });
}

module.exports = {
  echo, status, slow, redirect, limited, upload, download, startReport, jobStatus, pay,
  subscribe, listHooks, clearHooks, inboxPost, inboxGet, inboxClear, logs, corsOpen, corsClosed, corsPage,
  authorizePage, authorizeSubmit, token, oauthCallback,
  insecureOrder, insecureRegister, insecureProfile, insecureSearch, doReset, dbView, isEmail,
};
