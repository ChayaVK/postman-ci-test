// A small GraphQL server (no libraries): queries, mutations, variables, aliases, nested selections.
// Fragments and introspection are not supported; the error messages say so.
'use strict';
const { send, isEmail, now } = require('./core');
const { db } = require('./data');

const SCHEMA_SDL = `type Query {
  users(role: String, limit: Int): [User!]!
  user(id: Int!): User
  products(category: String, maxPrice: Int): [Product!]!
  product(id: Int!): Product
}

type Mutation {
  createUser(name: String!, email: String!, role: String): User
  deleteUser(id: Int!): Boolean!
}

type User {
  id: Int!
  name: String!
  email: String!
  role: String!
  active: Boolean!
  createdAt: String!
}

type Product {
  id: Int!
  name: String!
  category: String!
  price: Int!
  stock: Int!
  inStock: Boolean!
}
`;

const TYPES = {
  User: { id: 'Int', name: 'String', email: 'String', role: 'String', active: 'Boolean', createdAt: 'String' },
  Product: { id: 'Int', name: 'String', category: 'String', price: 'Int', stock: 'Int', inStock: 'Boolean' },
};
const ROOT = {
  Query: {
    users: { type: 'User', list: true, args: { role: 'String', limit: 'Int' } },
    user: { type: 'User', args: { id: 'Int!' } },
    products: { type: 'Product', list: true, args: { category: 'String', maxPrice: 'Int' } },
    product: { type: 'Product', args: { id: 'Int!' } },
  },
  Mutation: {
    createUser: { type: 'User', args: { name: 'String!', email: 'String!', role: 'String' } },
    deleteUser: { type: 'Boolean', args: { id: 'Int!' } },
  },
};

class GqlError extends Error {}

// ---------------------------------------------------------------- lexer
function lex(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const push = (t, v) => toks.push({ t, v, line, col });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { i++; line++; col = 1; continue; }
    if (/[\s,﻿]/.test(c)) { i++; col++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('...', i)) { push('punct', '...'); i += 3; col += 3; continue; }
    if ('{}()[]:!$=@|&'.includes(c)) { push('punct', c); i++; col++; continue; }
    if (c === '"') {
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        if (end === -1) throw new GqlError(`Syntax Error: Unterminated string at line ${line}.`);
        push('string', src.slice(i + 3, end)); col += end + 3 - i; i = end + 3; continue;
      }
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw new GqlError(`Syntax Error: Unterminated string at line ${line}.`);
        if (src[j] === '\\') { const n = src[j + 1]; s += { n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/' }[n] ?? n; j += 2; } else s += src[j++];
      }
      if (j >= src.length) throw new GqlError(`Syntax Error: Unterminated string at line ${line}.`);
      push('string', s); col += j + 1 - i; i = j + 1; continue;
    }
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { push(num[1] || num[2] ? 'float' : 'int', num[0]); i += num[0].length; col += num[0].length; continue; }
    const name = /^[_A-Za-z][_0-9A-Za-z]*/.exec(src.slice(i));
    if (name) { push('name', name[0]); i += name[0].length; col += name[0].length; continue; }
    throw new GqlError(`Syntax Error: Unexpected character "${c}" at line ${line}, column ${col}.`);
  }
  toks.push({ t: 'eof', v: '<EOF>', line, col });
  return toks;
}

// ---------------------------------------------------------------- parser
function parse(src) {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const at = (t, v) => toks[p].t === t && (v === undefined || toks[p].v === v);
  const expect = (t, v) => {
    const k = toks[p];
    if (k.t !== t || (v !== undefined && k.v !== v)) throw new GqlError(`Syntax Error: Expected ${v || t}, found ${k.v} at line ${k.line}, column ${k.col}.`);
    p++; return k;
  };
  function value(isConst) {
    const k = peek();
    if (at('punct', '$')) { if (isConst) throw new GqlError('Syntax Error: Variables are not allowed here.'); p++; return { kind: 'var', name: expect('name').v }; }
    if (k.t === 'int') { p++; return { kind: 'int', value: parseInt(k.v, 10) }; }
    if (k.t === 'float') { p++; return { kind: 'float', value: parseFloat(k.v) }; }
    if (k.t === 'string') { p++; return { kind: 'string', value: k.v }; }
    if (k.t === 'name') { p++; if (k.v === 'true' || k.v === 'false') return { kind: 'boolean', value: k.v === 'true' }; if (k.v === 'null') return { kind: 'null', value: null }; return { kind: 'enum', value: k.v }; }
    if (at('punct', '[')) { p++; const items = []; while (!at('punct', ']')) items.push(value(isConst)); p++; return { kind: 'list', items }; }
    if (at('punct', '{')) { p++; const fields = {}; while (!at('punct', '}')) { const n = expect('name').v; expect('punct', ':'); fields[n] = value(isConst); } p++; return { kind: 'object', fields }; }
    throw new GqlError(`Syntax Error: Unexpected ${k.v} at line ${k.line}, column ${k.col}.`);
  }
  function typeRef() {
    let t;
    if (at('punct', '[')) { p++; t = '[' + typeRef() + ']'; expect('punct', ']'); } else t = expect('name').v;
    if (at('punct', '!')) { p++; t += '!'; }
    return t;
  }
  function skipDirectives() { while (at('punct', '@')) { p++; expect('name'); if (at('punct', '(')) args(); } }
  function args() {
    const out = {};
    expect('punct', '(');
    while (!at('punct', ')')) { const n = expect('name').v; expect('punct', ':'); out[n] = value(false); }
    p++;
    return out;
  }
  function selectionSet() {
    expect('punct', '{');
    const sels = [];
    while (!at('punct', '}')) {
      if (at('punct', '...')) throw new GqlError('Fragments are not supported by this practice server. Write the fields out directly.');
      const first = expect('name');
      let alias = null, name = first.v;
      if (at('punct', ':')) { p++; alias = first.v; name = expect('name').v; }
      const a = at('punct', '(') ? args() : {};
      skipDirectives();
      const sub = at('punct', '{') ? selectionSet() : null;
      sels.push({ alias, name, args: a, sel: sub, line: first.line, col: first.col });
    }
    p++;
    if (!sels.length) throw new GqlError('Syntax Error: A selection set cannot be empty.');
    return sels;
  }
  const ops = [];
  while (!at('eof')) {
    if (at('punct', '{')) { ops.push({ type: 'query', name: null, vars: {}, sel: selectionSet() }); continue; }
    const k = expect('name');
    if (k.v === 'fragment') throw new GqlError('Fragments are not supported by this practice server. Write the fields out directly.');
    if (k.v !== 'query' && k.v !== 'mutation') {
      if (k.v === 'subscription') throw new GqlError('Subscriptions are not supported. See the WebSocket chapter for live updates.');
      throw new GqlError(`Syntax Error: Unexpected Name "${k.v}" at line ${k.line}, column ${k.col}. An operation starts with query, mutation or {.`);
    }
    const op = { type: k.v, name: at('name') ? expect('name').v : null, vars: {} };
    if (at('punct', '(')) {
      p++;
      while (!at('punct', ')')) {
        expect('punct', '$');
        const n = expect('name').v; expect('punct', ':');
        const t = typeRef();
        let def;
        if (at('punct', '=')) { p++; def = value(true); }
        op.vars[n] = { type: t, def };
      }
      p++;
    }
    skipDirectives();
    op.sel = selectionSet();
    ops.push(op);
  }
  if (!ops.length) throw new GqlError('Syntax Error: The document has no operation.');
  return ops;
}

// ---------------------------------------------------------------- execution
function literal(v, vars) {
  switch (v.kind) {
    case 'var': return vars[v.name];
    case 'list': return v.items.map((x) => literal(x, vars));
    case 'object': return Object.fromEntries(Object.entries(v.fields).map(([k, x]) => [k, literal(x, vars)]));
    default: return v.value;
  }
}

function checkType(val, type, what) {
  const required = type.endsWith('!');
  const base = type.replace(/!$/, '');
  if (val === undefined || val === null) {
    if (required) throw new GqlError(`${what} of required type ${type} was not provided.`);
    return;
  }
  const ok = { Int: Number.isInteger(val), String: typeof val === 'string', Boolean: typeof val === 'boolean' }[base];
  if (ok === false || ok === undefined) throw new GqlError(`${what} expects type ${type}, but got ${JSON.stringify(val)}.`);
}

function project(obj, sel, typeName, path, errors) {
  if (obj === null || obj === undefined) return null;
  const out = {};
  for (const s of sel) {
    const key = s.alias || s.name;
    if (s.name === '__typename') { out[key] = typeName; continue; }
    if (!(s.name in TYPES[typeName])) throw new GqlError(`Cannot query field "${s.name}" on type "${typeName}".`);
    if (s.sel) throw new GqlError(`Field "${s.name}" must not have a selection since type "${TYPES[typeName][s.name]}" has no subfields.`);
    out[key] = s.name === 'inStock' ? obj.stock > 0 : obj[s.name];
  }
  return out;
}

function resolve(opType, field, a, errors, path) {
  if (opType === 'query') {
    switch (field) {
      case 'users': {
        let list = db.users;
        if (a.role) list = list.filter((u) => u.role === a.role);
        if (a.limit !== undefined && a.limit !== null) list = list.slice(0, Math.max(0, a.limit));
        return list;
      }
      case 'user': return db.users.find((u) => u.id === a.id) || null;
      case 'products': {
        let list = db.products;
        if (a.category) list = list.filter((p) => p.category === a.category);
        if (a.maxPrice !== undefined && a.maxPrice !== null) list = list.filter((p) => p.price <= a.maxPrice);
        return list;
      }
      case 'product': return db.products.find((p) => p.id === a.id) || null;
    }
  } else {
    switch (field) {
      case 'createUser': {
        const role = a.role || 'tester';
        if (a.name.trim().length < 2) { errors.push({ message: 'name must be at least 2 characters.', path }); return null; }
        if (!isEmail(a.email)) { errors.push({ message: `"${a.email}" is not a valid email address.`, path }); return null; }
        if (!['tester', 'developer', 'manager'].includes(role)) { errors.push({ message: 'role must be tester, developer or manager.', path }); return null; }
        if (db.users.some((u) => u.email.toLowerCase() === a.email.toLowerCase())) { errors.push({ message: `A user with email ${a.email} already exists.`, path }); return null; }
        const u = { id: db.nextUserId++, name: a.name.trim(), email: a.email, role, active: true, createdAt: now() };
        db.users.push(u);
        return u;
      }
      case 'deleteUser': {
        const before = db.users.length;
        db.users = db.users.filter((u) => u.id !== a.id);
        return db.users.length < before;
      }
    }
  }
  return null;
}

function execute(query, variables, operationName) {
  const ops = parse(query);
  let op;
  if (operationName) {
    op = ops.find((o) => o.name === operationName);
    if (!op) throw new GqlError(`Unknown operation named "${operationName}".`);
  } else {
    if (ops.length > 1) throw new GqlError('The document has more than one operation, so send operationName to say which one to run.');
    op = ops[0];
  }
  // variables
  const vars = {};
  for (const [n, d] of Object.entries(op.vars)) {
    let v = variables && Object.prototype.hasOwnProperty.call(variables, n) ? variables[n] : undefined;
    if (v === undefined && d.def) v = literal(d.def, {});
    checkType(v, d.type, `Variable "$${n}"`);
    vars[n] = v;
  }
  const rootName = op.type === 'query' ? 'Query' : 'Mutation';
  const root = ROOT[rootName];
  const data = {};
  const errors = [];
  for (const s of op.sel) {
    const key = s.alias || s.name;
    if (s.name === '__typename') { data[key] = rootName; continue; }
    if (s.name === '__schema' || s.name === '__type') throw new GqlError('Introspection is not supported by this practice server. The schema is at GET /graphql/schema.');
    const f = root[s.name];
    if (!f) throw new GqlError(`Cannot query field "${s.name}" on type "${rootName}".`);
    const a = {};
    for (const [an, av] of Object.entries(s.args)) {
      if (!f.args[an]) throw new GqlError(`Unknown argument "${an}" on field "${rootName}.${s.name}".`);
      a[an] = literal(av, vars);
    }
    for (const [an, at] of Object.entries(f.args)) checkType(a[an], at, `Argument "${an}" on field "${s.name}"`);
    if (f.type !== 'Boolean' && !s.sel) throw new GqlError(`Field "${s.name}" of type "${f.type}" must have a selection of subfields, like ${s.name} { id name }.`);
    const val = resolve(op.type, s.name, a, errors, [key]);
    if (f.type === 'Boolean') data[key] = val;
    else if (f.list) data[key] = val.map((x, i) => project(x, s.sel, f.type, [key, i], errors));
    else data[key] = project(val, s.sel, f.type, [key], errors);
  }
  return errors.length ? { data, errors } : { data };
}

function handle(req, res) {
  let query, variables, operationName;
  if (req.method === 'GET') {
    query = req.query.get('query');
    operationName = req.query.get('operationName') || undefined;
    try { variables = req.query.get('variables') ? JSON.parse(req.query.get('variables')) : undefined; }
    catch { return send(res, 400, { errors: [{ message: 'variables must be valid JSON.' }] }); }
  } else {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/graphql')) query = req.body;
    else if (ct.includes('application/json') && req.body && typeof req.body === 'object') ({ query, variables, operationName } = req.body);
    else return send(res, 415, { errors: [{ message: 'Send JSON with Content-Type: application/json, like {"query": "{ users { id name } }"}.' }] });
    if (req.method === 'GET' || typeof query !== 'string') { /* fallthrough */ }
  }
  if (typeof query !== 'string' || !query.trim()) return send(res, 400, { errors: [{ message: 'Send a GraphQL query in the "query" field.' }] });
  try {
    if (req.method === 'GET' && /^\s*mutation\b/.test(query)) return send(res, 405, { errors: [{ message: 'Mutations must use POST, not GET.' }] }, { Allow: 'POST' });
    send(res, 200, execute(query, variables || {}, operationName));
  } catch (e) {
    if (e instanceof GqlError) return send(res, 400, { errors: [{ message: e.message }] });
    throw e;
  }
}

const schema = (req, res) => send(res, 200, SCHEMA_SDL, { 'Content-Type': 'text/plain; charset=utf-8' });

module.exports = { handle, schema, execute, SCHEMA_SDL };
