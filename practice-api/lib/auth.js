// Authentication helpers: JWT (HS256), API key, Basic auth, session cookies, OAuth 2.0 clients.
'use strict';
const crypto = require('node:crypto');
const { error } = require('./core');
const { db } = require('./data');

const SECRET = 'practice-api-secret-do-not-use-in-production';
const API_KEY = 'qa-key-123';
const OAUTH_CLIENTS = {
  'postman-client': { secret: 'postman-secret', redirectUris: ['https://oauth.pstmn.io/v1/callback', 'http://localhost:3000/oauth/callback'] },
};

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signJwt(payload, seconds = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat, exp: iat + seconds };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(data).digest());
  return data + '.' + sig;
}

// Returns { ok, payload, reason }
function verifyJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Token is not a JWT (it must have 3 parts separated by dots).' };
  let header, payload;
  try { header = JSON.parse(fromB64url(parts[0])); payload = JSON.parse(fromB64url(parts[1])); }
  catch { return { ok: false, reason: 'Token header or payload is not valid Base64URL JSON.' }; }
  if (header.alg !== 'HS256') return { ok: false, reason: `Algorithm ${header.alg} is not allowed.` };
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(parts[0] + '.' + parts[1]).digest());
  const a = Buffer.from(expected), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'Token signature is invalid (the token was changed or signed with another key).' };
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'Token has expired. Log in again to get a new one.', expired: true };
  return { ok: true, payload };
}

// Decodes WITHOUT checking the signature (used only by the deliberately insecure endpoint).
function decodeJwtUnsafe(token) {
  try { return JSON.parse(fromB64url(String(token).split('.')[1])); } catch { return null; }
}

function bearer(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Middleware-style: returns the user payload or sends 401 and returns null.
function requireToken(req, res) {
  const t = bearer(req);
  if (!t) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="practice-api"');
    error(res, 401, 'UNAUTHORIZED', 'Missing token. Send the header Authorization: Bearer <token>. Get a token from POST /api/auth/login.');
    return null;
  }
  const v = verifyJwt(t);
  if (!v.ok) {
    res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
    error(res, 401, v.expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', v.reason);
    return null;
  }
  req.user = v.payload;
  return v.payload;
}

function requireRole(req, res, role) {
  const u = requireToken(req, res);
  if (!u) return null;
  if (u.role !== role) {
    error(res, 403, 'FORBIDDEN', `You are logged in as "${u.sub}" (role ${u.role}), but this action needs role ${role}.`);
    return null;
  }
  return u;
}

function requireApiKey(req, res) {
  const key = req.headers['x-api-key'] || req.query.get('api_key');
  if (!key || key !== API_KEY) res.setHeader('WWW-Authenticate', 'ApiKey header="x-api-key"');
  if (!key) { error(res, 401, 'API_KEY_MISSING', 'Send your API key in the header x-api-key.'); return false; }
  if (key !== API_KEY) { error(res, 401, 'API_KEY_INVALID', 'The API key is not valid.'); return false; }
  return true;
}

function requireBasic(req, res) {
  const h = req.headers.authorization || '';
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) {
    res.setHeader('WWW-Authenticate', 'Basic realm="practice-api"');
    error(res, 401, 'UNAUTHORIZED', 'Send username and password with Basic auth.');
    return null;
  }
  const [user, ...rest] = Buffer.from(m[1], 'base64').toString().split(':');
  const acc = db.accounts.find((a) => a.username === user && a.password === rest.join(':'));
  if (!acc) {
    res.setHeader('WWW-Authenticate', 'Basic realm="practice-api"');
    error(res, 401, 'INVALID_CREDENTIALS', 'Username or password is wrong.');
    return null;
  }
  return acc;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

module.exports = {
  SECRET, API_KEY, OAUTH_CLIENTS, signJwt, verifyJwt, decodeJwtUnsafe, bearer,
  requireToken, requireRole, requireApiKey, requireBasic, parseCookies, b64url,
};
