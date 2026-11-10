// QAMadeEasy Practice API: run with   node server.js   (needs Node.js 18 or newer, nothing to install)
// Change the port with   PORT=4000 node server.js   (Windows PowerShell: $env:PORT=4000; node server.js)
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { send, error, parseBody, log } = require('./lib/core');
const R = require('./lib/rest');
const M = require('./lib/misc');
const G = require('./lib/graphql');
const S = require('./lib/soap');
const WS = require('./lib/ws');
const DOCS = require('./lib/docs');

const PORT = Number(process.env.PORT) || 3000;

// [methods, path pattern, handler]. ":x" in a path is a parameter passed to the handler in order.
const ROUTES = [
  ['GET', '/', DOCS.home],
  ['GET', '/docs', DOCS.page],
  ['GET', '/openapi.json', DOCS.openapi],
  ['GET', '/health', (req, res) => send(res, 200, { status: 'UP', time: new Date().toISOString() })],
  ['POST', '/api/reset', M.doReset],
  ['GET', '/debug/db', M.dbView],

  ['GET', '/api/users', R.listUsers],
  ['GET', '/api/v2/users', R.listUsers],
  ['GET', '/api/v1/users', R.listUsersV1],
  ['POST', '/api/users', R.createUser],
  ['GET', '/api/users/:id', R.getUser],
  ['PUT', '/api/users/:id', R.replaceUser],
  ['PATCH', '/api/users/:id', R.patchUser],
  ['DELETE', '/api/users/:id', R.deleteUser],

  ['GET', '/api/products', R.listProducts],
  ['POST', '/api/products', R.createProduct],
  ['GET', '/api/products/:id', R.getProduct],
  ['DELETE', '/api/products/:id', R.deleteProduct],

  ['POST', '/api/auth/login', R.login],
  ['GET', '/api/auth/me', R.me],
  ['GET', '/api/orders', R.listOrders],
  ['POST', '/api/orders', R.createOrder],
  ['GET', '/api/orders/:id', R.getOrder],
  ['DELETE', '/api/orders/:id', R.cancelOrder],
  ['DELETE', '/api/admin/users/:id', R.adminDeleteUser],

  ['POST', '/api/session/login', R.sessionLogin],
  ['GET', '/api/session/me', R.sessionMe],
  ['POST', '/api/session/logout', R.sessionLogout],
  ['GET', '/api/basic/profile', R.basicProfile],
  ['GET', '/api/reports/sales', R.salesReport],

  ['GET,POST,PUT,PATCH,DELETE', '/api/echo', M.echo],
  ['GET', '/api/status/:code', M.status],
  ['GET', '/api/slow', M.slow],
  ['GET', '/api/old-users', M.redirect(301, '/api/users')],
  ['GET', '/api/temp-products', M.redirect(302, '/api/products')],
  ['GET', '/api/limited', M.limited],
  ['POST', '/api/files', M.upload],
  ['GET', '/api/files/:id', M.download],
  ['POST', '/api/reports', M.startReport],
  ['GET', '/api/jobs/:id', M.jobStatus],
  ['POST', '/api/payments', M.pay],
  ['POST', '/api/webhooks', M.subscribe],
  ['GET', '/api/webhooks', M.listHooks],
  ['DELETE', '/api/webhooks', M.clearHooks],
  ['POST', '/webhook-inbox', M.inboxPost],
  ['GET', '/webhook-inbox', M.inboxGet],
  ['DELETE', '/webhook-inbox', M.inboxClear],
  ['GET', '/api/logs', M.logs],
  ['GET,POST,OPTIONS', '/api/cors/open', M.corsOpen],
  ['GET', '/api/cors/closed', M.corsClosed],
  ['GET', '/cors-demo', M.corsPage],

  ['GET', '/oauth/authorize', M.authorizePage],
  ['POST', '/oauth/authorize', M.authorizeSubmit],
  ['POST', '/oauth/token', M.token],
  ['GET', '/oauth/callback', M.oauthCallback],

  ['GET,POST', '/graphql', G.handle],
  ['GET', '/graphql/schema', G.schema],
  ['GET,POST', '/soap/calculator', S.handle],

  ['GET', '/api/insecure/orders/:id', M.insecureOrder],
  ['POST', '/api/insecure/register', M.insecureRegister],
  ['GET', '/api/insecure/profile', M.insecureProfile],
  ['GET', '/api/insecure/search', M.insecureSearch],
].map(([methods, path, fn]) => {
  const names = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  return { methods: methods.split(','), re, fn, path };
});

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.path = url.pathname;
  req.query = url.searchParams;
  req.requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Powered-By', 'QAMadeEasy Practice API');

  const matches = ROUTES.map((r) => ({ r, m: r.re.exec(req.path) })).filter((x) => x.m);
  if (!matches.length) return error(res, 404, 'NOT_FOUND', `There is no endpoint ${req.path}. See GET /docs for the full list.`);
  const allowed = [...new Set(matches.flatMap((x) => x.r.methods))];
  if (allowed.includes('GET')) allowed.push('HEAD');
  if (!allowed.includes('OPTIONS')) allowed.push('OPTIONS');
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const hit = matches.find((x) => x.r.methods.includes(method));
  if (!hit) {
    if (req.method === 'OPTIONS') { res.setHeader('Allow', allowed.join(', ')); return send(res, 204); }
    res.setHeader('Allow', allowed.join(', '));
    return error(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on ${req.path}. Allowed: ${allowed.join(', ')}.`);
  }
  if (!(await parseBody(req, res))) return;
  log(req, `${req.method} ${req.path}`);
  await hit.r.fn(req, res, ...hit.m.slice(1).map(decodeURIComponent));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) error(res, 500, 'INTERNAL_ERROR', 'Something went wrong on the server.');
  });
});
server.on('upgrade', (req, socket, head) => {
  if ((req.headers.upgrade || '').toLowerCase() === 'websocket') return WS.upgrade(req, socket, head);
  // Any other upgrade (for example curl --http2 asking for h2c): ignore it and answer as normal HTTP/1.1.
  const res = new http.ServerResponse(req);
  res.shouldKeepAlive = false;
  res.assignSocket(socket);
  res.on('finish', () => { res.detachSocket(socket); socket.destroySoon(); });
  handle(req, res).catch(() => socket.destroy());
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Either the practice API is already running in another window,`);
    console.error(`or another program uses port ${PORT}. Stop it, or start this API on another port:`);
    console.error('  macOS/Linux:        PORT=4000 node server.js');
    console.error('  Windows PowerShell: $env:PORT=4000; node server.js\n');
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, () => {
  console.log(`QAMadeEasy Practice API is running at http://localhost:${PORT}`);
  console.log(`Endpoint list: http://localhost:${PORT}/docs    Stop: press Ctrl+C`);
});
