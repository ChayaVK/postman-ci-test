// REST resources: users, products, orders, login, sessions, Basic auth, API key.
'use strict';
const { send, error, requireJson, isEmail, etagOf, now, log, uid } = require('./core');
const { db } = require('./data');
const A = require('./auth');
const hooks = require('./hooks');

const ROLES = ['tester', 'developer', 'manager'];

// ---------------------------------------------------------------- helpers
function intParam(res, value, name) {
  if (!/^\d+$/.test(value)) { error(res, 400, 'INVALID_ID', `${name} must be a whole number, got "${value}".`); return null; }
  return Number(value);
}

function paginate(req, res, list) {
  const q = req.query;
  const page = q.has('page') ? q.get('page') : '1';
  const limit = q.has('limit') ? q.get('limit') : '5';
  if (!/^\d+$/.test(page) || Number(page) < 1) { error(res, 400, 'INVALID_PAGE', 'page must be a whole number of 1 or more.'); return null; }
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50) { error(res, 400, 'INVALID_LIMIT', 'limit must be a whole number from 1 to 50.'); return null; }
  const p = Number(page), l = Number(limit);
  const total = list.length;
  return { data: list.slice((p - 1) * l, p * l), page: p, limit: l, total, totalPages: Math.ceil(total / l) };
}

function sortList(req, res, list, allowed) {
  const s = req.query.get('sort');
  if (!s) return list;
  const desc = s.startsWith('-');
  const key = desc ? s.slice(1) : s;
  if (!allowed.includes(key)) { error(res, 400, 'INVALID_SORT', `sort must be one of: ${allowed.flatMap((k) => [k, '-' + k]).join(', ')}.`); return null; }
  return [...list].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (desc ? -1 : 1));
}

function validateUser(body, partial) {
  const errs = [];
  const has = (k) => body[k] !== undefined;
  if (!partial || has('name')) {
    if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 50) errs.push({ field: 'name', message: 'name is required and must be 2 to 50 characters.' });
  }
  if (!partial || has('email')) {
    if (!isEmail(body.email)) errs.push({ field: 'email', message: 'email is required and must be a valid email address.' });
  }
  if (has('role') && !ROLES.includes(body.role)) errs.push({ field: 'role', message: `role must be one of: ${ROLES.join(', ')}.` });
  if (has('active') && typeof body.active !== 'boolean') errs.push({ field: 'active', message: 'active must be true or false (a boolean, not a string).' });
  return errs;
}

function findUser(res, idText) {
  const id = intParam(res, idText, 'User id');
  if (id === null) return null;
  const u = db.users.find((x) => x.id === id);
  if (!u) { error(res, 404, 'USER_NOT_FOUND', `No user with id ${id}.`); return null; }
  return u;
}

function conditional(req, res, obj) {
  const tag = etagOf(obj);
  res.setHeader('ETag', tag);
  if (req.headers['if-none-match'] === tag) { send(res, 304); return { tag, done: true }; }
  return { tag, done: false };
}

function checkIfMatch(req, res, obj) {
  const want = req.headers['if-match'];
  if (want && want !== etagOf(obj)) {
    error(res, 412, 'PRECONDITION_FAILED', 'The record was changed by someone else after you read it (If-Match does not match the current ETag). GET it again, then retry.');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------- users
function listUsers(req, res) {
  let list = db.users;
  const role = req.query.get('role');
  if (role) {
    if (!ROLES.includes(role)) return error(res, 400, 'INVALID_ROLE', `role must be one of: ${ROLES.join(', ')}.`);
    list = list.filter((u) => u.role === role);
  }
  const active = req.query.get('active');
  if (active !== null) {
    if (!['true', 'false'].includes(active)) return error(res, 400, 'INVALID_ACTIVE', 'active must be true or false.');
    list = list.filter((u) => String(u.active) === active);
  }
  const search = req.query.get('search');
  if (search) list = list.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()));
  list = sortList(req, res, list, ['id', 'name', 'createdAt']);
  if (!list) return;
  const page = paginate(req, res, list);
  if (!page) return;
  res.setHeader('X-Total-Count', page.total);
  send(res, 200, page);
}

function getUser(req, res, id) {
  const u = findUser(res, id);
  if (!u) return;
  if (conditional(req, res, u).done) return;
  send(res, 200, u);
}

function createUser(req, res) {
  if (!requireJson(req, res)) return;
  const b = req.body;
  const errs = validateUser(b, false);
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Some fields are missing or wrong.', errs);
  if (db.users.some((u) => u.email.toLowerCase() === b.email.toLowerCase())) return error(res, 409, 'EMAIL_TAKEN', `A user with email ${b.email} already exists.`);
  const user = { id: db.nextUserId++, name: b.name.trim(), email: b.email, role: b.role || 'tester', active: b.active === undefined ? true : b.active, createdAt: now() };
  db.users.push(user);
  log(req, `created user ${user.id}`);
  send(res, 201, user, { Location: `/api/users/${user.id}` });
}

function replaceUser(req, res, id) {
  const u = findUser(res, id);
  if (!u) return;
  if (!requireJson(req, res)) return;
  if (!checkIfMatch(req, res, u)) return;
  const b = req.body;
  const missing = ['name', 'email', 'role', 'active'].filter((k) => b[k] === undefined);
  if (missing.length) return error(res, 400, 'VALIDATION_FAILED', 'PUT replaces the whole user, so send every field: name, email, role, active.', missing.map((f) => ({ field: f, message: `${f} is required for PUT.` })));
  const errs = validateUser(b, false);
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Some fields are missing or wrong.', errs);
  if (db.users.some((x) => x.id !== u.id && x.email.toLowerCase() === b.email.toLowerCase())) return error(res, 409, 'EMAIL_TAKEN', `A user with email ${b.email} already exists.`);
  Object.assign(u, { name: b.name.trim(), email: b.email, role: b.role, active: b.active, updatedAt: now() });
  send(res, 200, u, { ETag: etagOf(u) });
}

function patchUser(req, res, id) {
  const u = findUser(res, id);
  if (!u) return;
  if (!requireJson(req, res)) return;
  if (!checkIfMatch(req, res, u)) return;
  const b = req.body;
  const fields = ['name', 'email', 'role', 'active'].filter((k) => b[k] !== undefined);
  if (!fields.length) return error(res, 400, 'NOTHING_TO_UPDATE', 'Send at least one of: name, email, role, active.');
  const errs = validateUser(b, true);
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Some fields are wrong.', errs);
  if (b.email && db.users.some((x) => x.id !== u.id && x.email.toLowerCase() === b.email.toLowerCase())) return error(res, 409, 'EMAIL_TAKEN', `A user with email ${b.email} already exists.`);
  for (const f of fields) u[f] = f === 'name' ? b.name.trim() : b[f];
  u.updatedAt = now();
  send(res, 200, u, { ETag: etagOf(u) });
}

function deleteUser(req, res, id) {
  const u = findUser(res, id);
  if (!u) return;
  db.users = db.users.filter((x) => x.id !== u.id);
  log(req, `deleted user ${u.id}`);
  send(res, 204);
}

// old version of the users API, kept for older clients
function listUsersV1(req, res) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
  res.setHeader('Link', '</api/v2/users>; rel="successor-version"');
  send(res, 200, db.users.map((u) => ({ id: u.id, fullName: u.name, mail: u.email })));
}

// ---------------------------------------------------------------- products
const CATS = ['electronics', 'stationery', 'home'];

function toXml(p) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<product>\n${Object.entries(p).map(([k, v]) => `  <${k}>${esc(v)}</${k}>`).join('\n')}\n</product>\n`;
}

function listProducts(req, res) {
  let list = db.products;
  const q = req.query;
  const cat = q.get('category');
  if (cat) {
    if (!CATS.includes(cat)) return error(res, 400, 'INVALID_CATEGORY', `category must be one of: ${CATS.join(', ')}.`);
    list = list.filter((p) => p.category === cat);
  }
  for (const [k, fn] of [['minPrice', (p, v) => p.price >= v], ['maxPrice', (p, v) => p.price <= v]]) {
    if (q.has(k)) {
      const v = q.get(k);
      if (!/^\d+(\.\d+)?$/.test(v)) return error(res, 400, 'INVALID_PRICE', `${k} must be a number.`);
      list = list.filter((p) => fn(p, Number(v)));
    }
  }
  if (q.get('inStock') === 'true') list = list.filter((p) => p.stock > 0);
  const search = q.get('search');
  if (search) list = list.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  list = sortList(req, res, list, ['id', 'name', 'price']);
  if (!list) return;
  const page = paginate(req, res, list);
  if (!page) return;
  res.setHeader('X-Total-Count', page.total);
  send(res, 200, page);
}

function getProduct(req, res, idText) {
  const id = intParam(res, idText, 'Product id');
  if (id === null) return;
  const p = db.products.find((x) => x.id === id);
  if (!p) return error(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}.`);
  const accept = (req.headers.accept || '*/*').toLowerCase();
  const wantsXml = accept.includes('application/xml') || accept.includes('text/xml');
  const okJson = accept.includes('application/json') || accept.includes('*/*') || accept.includes('application/*');
  if (!wantsXml && !okJson) return error(res, 406, 'NOT_ACCEPTABLE', 'This endpoint can return application/json or application/xml. Change the Accept header.');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('Vary', 'Accept');
  if (conditional(req, res, p).done) return;
  if (wantsXml && !accept.startsWith('application/json')) return send(res, 200, toXml(p), { 'Content-Type': 'application/xml; charset=utf-8' });
  send(res, 200, p);
}

function validateProduct(b, partial) {
  const errs = [];
  const has = (k) => b[k] !== undefined;
  if (!partial || has('name')) if (typeof b.name !== 'string' || b.name.trim().length < 2) errs.push({ field: 'name', message: 'name is required (2+ characters).' });
  if (!partial || has('category')) if (!CATS.includes(b.category)) errs.push({ field: 'category', message: `category must be one of: ${CATS.join(', ')}.` });
  if (!partial || has('price')) if (typeof b.price !== 'number' || b.price <= 0) errs.push({ field: 'price', message: 'price must be a number greater than 0.' });
  if (!partial || has('stock')) if (!Number.isInteger(b.stock) || b.stock < 0) errs.push({ field: 'stock', message: 'stock must be a whole number, 0 or more.' });
  return errs;
}

function createProduct(req, res) {
  if (!A.requireRole(req, res, 'admin')) return;
  if (!requireJson(req, res)) return;
  const errs = validateProduct(req.body, false);
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Some fields are missing or wrong.', errs);
  const b = req.body;
  const p = { id: db.nextProductId++, name: b.name.trim(), category: b.category, price: b.price, stock: b.stock };
  db.products.push(p);
  send(res, 201, p, { Location: `/api/products/${p.id}` });
}

function deleteProduct(req, res, idText) {
  if (!A.requireRole(req, res, 'admin')) return;
  const id = intParam(res, idText, 'Product id');
  if (id === null) return;
  if (!db.products.some((p) => p.id === id)) return error(res, 404, 'PRODUCT_NOT_FOUND', `No product with id ${id}.`);
  db.products = db.products.filter((p) => p.id !== id);
  send(res, 204);
}

// ---------------------------------------------------------------- login (JWT)
function login(req, res) {
  if (!requireJson(req, res)) return;
  const { username, password, expiresIn } = req.body;
  const errs = [];
  if (!username) errs.push({ field: 'username', message: 'username is required.' });
  if (!password) errs.push({ field: 'password', message: 'password is required.' });
  if (expiresIn !== undefined && (!Number.isInteger(expiresIn) || expiresIn < 10 || expiresIn > 3600)) errs.push({ field: 'expiresIn', message: 'expiresIn must be a whole number of seconds from 10 to 3600.' });
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Send username and password.', errs);
  const acc = db.accounts.find((a) => a.username === username && a.password === password);
  if (!acc) return error(res, 401, 'INVALID_CREDENTIALS', 'Username or password is wrong.');
  const secs = expiresIn || 3600;
  const token = A.signJwt({ sub: acc.username, role: acc.role, name: acc.name }, secs);
  log(req, `login ok for ${acc.username}`);
  send(res, 200, { token, tokenType: 'Bearer', expiresIn: secs, user: { username: acc.username, role: acc.role, name: acc.name } });
}

function me(req, res) {
  const u = A.requireToken(req, res);
  if (!u) return;
  send(res, 200, { username: u.sub, role: u.role, name: u.name, scope: u.scope, issuedAt: new Date(u.iat * 1000).toISOString(), expiresAt: new Date(u.exp * 1000).toISOString() });
}

// ---------------------------------------------------------------- orders (need a token)
function canSee(user, order) { return user.role === 'admin' || order.owner === user.sub; }

function listOrders(req, res) {
  const u = A.requireToken(req, res);
  if (!u) return;
  const list = db.orders.filter((o) => canSee(u, o));
  send(res, 200, { data: list, total: list.length });
}

function createOrder(req, res) {
  const u = A.requireToken(req, res);
  if (!u) return;
  if (!requireJson(req, res)) return;
  const { productId, quantity } = req.body;
  const errs = [];
  if (!Number.isInteger(productId)) errs.push({ field: 'productId', message: 'productId is required and must be a whole number.' });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) errs.push({ field: 'quantity', message: 'quantity must be a whole number from 1 to 10.' });
  if (errs.length) return error(res, 400, 'VALIDATION_FAILED', 'Some fields are missing or wrong.', errs);
  const p = db.products.find((x) => x.id === productId);
  if (!p) return error(res, 422, 'PRODUCT_NOT_FOUND', `Product ${productId} does not exist, so it cannot be ordered.`);
  if (p.stock < quantity) return error(res, 409, 'OUT_OF_STOCK', `Only ${p.stock} left of "${p.name}".`);
  p.stock -= quantity;
  const o = { id: db.nextOrderId++, owner: u.sub, productId, quantity, total: p.price * quantity, status: 'PLACED', createdAt: now() };
  db.orders.push(o);
  log(req, `order ${o.id} placed by ${u.sub}`);
  hooks.fire('order.created', o);
  send(res, 201, o, { Location: `/api/orders/${o.id}` });
}

function getOrder(req, res, idText) {
  const u = A.requireToken(req, res);
  if (!u) return;
  const id = intParam(res, idText, 'Order id');
  if (id === null) return;
  const o = db.orders.find((x) => x.id === id);
  // 404 (not 403) for someone else's order, so attackers can't even learn that it exists
  if (!o || !canSee(u, o)) return error(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id} for you.`);
  send(res, 200, o);
}

function cancelOrder(req, res, idText) {
  const u = A.requireToken(req, res);
  if (!u) return;
  const id = intParam(res, idText, 'Order id');
  if (id === null) return;
  const o = db.orders.find((x) => x.id === id);
  if (!o || !canSee(u, o)) return error(res, 404, 'ORDER_NOT_FOUND', `No order with id ${id} for you.`);
  if (o.status !== 'PLACED') return error(res, 409, 'CANNOT_CANCEL', `Order ${id} is ${o.status} and can no longer be cancelled.`);
  o.status = 'CANCELLED';
  const p = db.products.find((x) => x.id === o.productId);
  if (p) p.stock += o.quantity;
  send(res, 200, o);
}

// ---------------------------------------------------------------- admin-only
function adminDeleteUser(req, res, id) {
  if (!A.requireRole(req, res, 'admin')) return;
  deleteUser(req, res, id);
}

// ---------------------------------------------------------------- session cookie login
function sessionLogin(req, res) {
  const b = req.body || {};
  const acc = db.accounts.find((a) => a.username === b.username && a.password === b.password);
  if (!acc) return error(res, 401, 'INVALID_CREDENTIALS', 'Username or password is wrong.');
  const sid = uid();
  db.sessions[sid] = acc.username;
  send(res, 200, { message: `Logged in as ${acc.username}. The session id is in the Set-Cookie header.` },
    { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600` });
}

function sessionMe(req, res) {
  const sid = A.parseCookies(req).sid;
  const user = sid && db.sessions[sid];
  if (!user) return error(res, 401, 'NOT_LOGGED_IN', 'No valid session cookie. Call POST /api/session/login first.');
  const acc = db.accounts.find((a) => a.username === user);
  send(res, 200, { username: acc.username, role: acc.role, name: acc.name });
}

function sessionLogout(req, res) {
  const sid = A.parseCookies(req).sid;
  if (sid) delete db.sessions[sid];
  send(res, 200, { message: 'Logged out.' }, { 'Set-Cookie': 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
}

// ---------------------------------------------------------------- Basic auth and API key
function basicProfile(req, res) {
  const acc = A.requireBasic(req, res);
  if (!acc) return;
  send(res, 200, { username: acc.username, role: acc.role, name: acc.name, authMethod: 'Basic' });
}

function salesReport(req, res) {
  if (!A.requireApiKey(req, res)) return;
  const byCat = {};
  const orders = db.orders.filter((o) => o.status !== 'CANCELLED');
  for (const o of orders) {
    const p = db.products.find((x) => x.id === o.productId);
    const c = p ? p.category : 'unknown';
    byCat[c] = (byCat[c] || 0) + o.total;
  }
  send(res, 200, { currency: 'INR', orders: orders.length, revenue: orders.reduce((s, o) => s + o.total, 0), byCategory: byCat });
}

module.exports = {
  listUsers, getUser, createUser, replaceUser, patchUser, deleteUser, listUsersV1,
  listProducts, getProduct, createProduct, deleteProduct,
  login, me, listOrders, createOrder, getOrder, cancelOrder, adminDeleteUser,
  sessionLogin, sessionMe, sessionLogout, basicProfile, salesReport,
};
