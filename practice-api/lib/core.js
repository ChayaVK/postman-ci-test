// Small helpers shared by every route: responses, errors, body parsing, request log.
'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MAX_BODY = 1024 * 1024; // 1 MB

// ---------------------------------------------------------------- request log (for correlation IDs)
const LOG = [];
function log(req, msg) {
  LOG.push({ time: new Date().toISOString(), requestId: req.requestId, method: req.method, path: req.path, msg });
  if (LOG.length > 2000) LOG.shift();
}

// ---------------------------------------------------------------- responses
function send(res, status, body, headers = {}) {
  if (res.writableEnded) return;
  let payload = '';
  const h = { ...headers };
  if (body !== undefined && body !== null && status !== 204 && status !== 304) {
    if (typeof body === 'string' || Buffer.isBuffer(body)) {
      payload = body;
      h['Content-Type'] = h['Content-Type'] || 'text/plain; charset=utf-8';
    } else {
      payload = JSON.stringify(body, null, 2);
      h['Content-Type'] = h['Content-Type'] || 'application/json; charset=utf-8';
    }
  }
  // compress bigger text responses when the client says it can unzip them (Postman and browsers do)
  const ae = (res.req.headers['accept-encoding'] || '').toLowerCase();
  if (payload.length > 1024 && /\bgzip\b/.test(ae) && /json|text|xml/.test(h['Content-Type'] || '')) {
    payload = zlib.gzipSync(payload);
    h['Content-Encoding'] = 'gzip';
    h['Vary'] = h['Vary'] ? h['Vary'] + ', Accept-Encoding' : 'Accept-Encoding';
  }
  h['Content-Length'] = Buffer.byteLength(payload);
  res.writeHead(status, h);
  res.end(res.req.method === 'HEAD' ? undefined : payload);
}

function error(res, status, code, message, details) {
  const body = { error: { code, message } };
  if (details) body.error.details = details;
  body.requestId = res.req.requestId;
  log(res.req, `${status} ${code}: ${message}`);
  send(res, status, body);
}

// ---------------------------------------------------------------- body parsing
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooLarge = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { tooLarge = true; chunks.length = 0; return; } // keep reading, stop storing
      chunks.push(c);
    });
    req.on('end', () => (tooLarge ? reject(Object.assign(new Error('too large'), { tooLarge: true })) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const parts = [];
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    const next = buf.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buf.subarray(start + boundary.length + 2, next - 2); // skip CRLF after boundary, before next
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = part.subarray(0, sep).toString();
      const data = part.subarray(sep + 4);
      const name = /name="([^"]*)"/i.exec(head);
      const filename = /filename="([^"]*)"/i.exec(head);
      const type = /content-type:\s*([^\r\n]+)/i.exec(head);
      parts.push({ name: name && name[1], filename: filename && filename[1], type: type ? type[1].trim() : null, data });
    }
    start = next;
  }
  return parts;
}

// Parses the body by Content-Type. Sets req.body (object/string), req.rawBody, req.files.
async function parseBody(req, res) {
  if (['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(req.method) && !req.headers['content-length'] && !req.headers['transfer-encoding']) {
    req.body = undefined;
    return true;
  }
  let buf;
  try {
    buf = await readBody(req);
  } catch (e) {
    if (e.tooLarge) { res.setHeader('Connection', 'close'); error(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is larger than 1 MB.'); return false; }
    throw e;
  }
  req.rawBody = buf;
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (buf.length === 0) { req.body = undefined; return true; }
  if (ct.includes('application/json')) {
    try { req.body = JSON.parse(buf.toString()); }
    catch (e) { error(res, 400, 'INVALID_JSON', `The body is not valid JSON: ${e.message}`); return false; }
  } else if (ct.includes('application/x-www-form-urlencoded')) {
    req.body = Object.fromEntries(new URLSearchParams(buf.toString()));
  } else if (ct.includes('multipart/form-data')) {
    const parts = parseMultipart(buf, req.headers['content-type']) || [];
    req.body = {};
    req.files = [];
    for (const p of parts) {
      if (p.filename !== null && p.filename !== undefined) req.files.push(p);
      else if (p.name) req.body[p.name] = p.data.toString();
    }
  } else {
    req.body = buf.toString();
  }
  return true;
}

function requireJson(req, res) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.includes('application/json')) {
    error(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the body as JSON with the header Content-Type: application/json.');
    return false;
  }
  if (req.body === undefined || req.body === null || typeof req.body !== 'object' || Array.isArray(req.body)) {
    error(res, 400, 'BODY_REQUIRED', 'Send a JSON object in the request body.');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- small utils
const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const etagOf = (obj) => '"' + crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16) + '"';
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

module.exports = { LOG, log, send, error, parseBody, requireJson, isEmail, etagOf, now, uid };
