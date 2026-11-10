// GET / (summary), GET /docs (HTML list of every endpoint), GET /openapi.json (OpenAPI 3 description).
'use strict';
const { send } = require('./core');

const GROUPS = [
  ['Users (no login needed)', [
    ['GET', '/api/users', 'List users. Query: page, limit (1-50), role, active, search, sort (id, name, createdAt; add - for descending)'],
    ['GET', '/api/users/:id', 'One user. Returns an ETag; send If-None-Match to get 304'],
    ['POST', '/api/users', 'Create: {"name","email","role"?,"active"?}. 201 + Location'],
    ['PUT', '/api/users/:id', 'Replace: send name, email, role and active. Optional If-Match'],
    ['PATCH', '/api/users/:id', 'Change some fields. Optional If-Match'],
    ['DELETE', '/api/users/:id', 'Delete. 204'],
    ['GET', '/api/v1/users', 'Old version (fullName, mail) with Deprecation and Sunset headers'],
    ['GET', '/api/v2/users', 'Current version (same as /api/users)'],
  ]],
  ['Products', [
    ['GET', '/api/products', 'List. Query: category, minPrice, maxPrice, inStock=true, search, sort (id, name, price), page, limit'],
    ['GET', '/api/products/:id', 'One product. JSON or XML (Accept header), ETag, Cache-Control'],
    ['POST', '/api/products', 'Create (admin token)'],
    ['DELETE', '/api/products/:id', 'Delete (admin token)'],
  ]],
  ['Login and orders', [
    ['POST', '/api/auth/login', 'Get a JWT: {"username":"tester","password":"Test@123"}; optional "expiresIn" (10-3600 s)'],
    ['GET', '/api/auth/me', 'Who am I (Bearer token)'],
    ['GET', '/api/orders', 'Your orders (admin sees all)'],
    ['POST', '/api/orders', 'Place an order: {"productId":1,"quantity":2}'],
    ['GET', '/api/orders/:id', 'One of your orders'],
    ['DELETE', '/api/orders/:id', 'Cancel an order that is still PLACED'],
    ['DELETE', '/api/admin/users/:id', 'Admin only: delete a user (403 for others)'],
  ]],
  ['Other ways to log in', [
    ['GET', '/api/basic/profile', 'Basic auth (tester / Test@123)'],
    ['GET', '/api/reports/sales', 'API key: header x-api-key: qa-key-123'],
    ['POST', '/api/session/login', 'Cookie session: sets sid cookie'],
    ['GET', '/api/session/me', 'Reads the sid cookie'],
    ['POST', '/api/session/logout', 'Clears the cookie'],
    ['GET', '/oauth/authorize', 'OAuth 2.0 authorization page (client_id postman-client)'],
    ['POST', '/oauth/token', 'OAuth 2.0 token: authorization_code, client_credentials, refresh_token (secret postman-secret)'],
  ]],
  ['HTTP behavior playground', [
    ['ANY', '/api/echo', 'Returns exactly what the server received: method, headers, query, body, files'],
    ['GET', '/api/status/:code', 'Responds with any status code from 200 to 599'],
    ['GET', '/api/slow?ms=2000', 'Waits before answering (max 10000 ms)'],
    ['GET', '/api/old-users', '301 redirect to /api/users'],
    ['GET', '/api/temp-products', '302 redirect to /api/products'],
    ['GET', '/api/limited', 'Rate limited: 5 requests per 10 seconds, then 429'],
    ['POST', '/api/files', 'Upload a file (form-data key "file"; txt, csv, json, png, jpg, pdf; max 1 MB)'],
    ['GET', '/api/files/:id', 'Download an uploaded file; /api/files/sample downloads a CSV'],
    ['POST', '/api/reports', 'Start a slow job: {"type":"sales"} -> 202 Accepted'],
    ['GET', '/api/jobs/:id', 'Poll the job: PENDING -> RUNNING -> DONE'],
    ['POST', '/api/payments', 'Needs an Idempotency-Key header: {"orderId":1001,"amount":1598}'],
    ['POST', '/api/webhooks', 'Subscribe a URL to order.created events'],
    ['GET', '/webhook-inbox', 'Events received by the built-in webhook receiver'],
    ['GET', '/api/logs?requestId=...', 'Server log lines for one request (X-Request-Id)'],
    ['GET', '/api/cors/open', 'Allows any origin (Access-Control-Allow-Origin: *)'],
    ['GET', '/api/cors/closed', 'No CORS header'],
    ['GET', '/cors-demo', 'Browser page that shows CORS in action'],
  ]],
  ['Other API styles', [
    ['POST', '/graphql', 'GraphQL: {"query":"{ users { id name } }"}. Schema: GET /graphql/schema'],
    ['POST', '/soap/calculator', 'SOAP 1.1 Calculator (Add, Subtract, Multiply, Divide). WSDL: GET /soap/calculator?wsdl'],
    ['WS', '/ws', 'WebSocket: ws://localhost:3000/ws'],
  ]],
  ['Deliberately INSECURE (for the security chapter only)', [
    ['GET', '/api/insecure/orders/:id', 'Any logged-in user can read any order (BOLA)'],
    ['POST', '/api/insecure/register', 'Accepts any field, including role (mass assignment)'],
    ['GET', '/api/insecure/profile', 'Trusts a token without checking its signature'],
    ['GET', '/api/insecure/search?q=', 'Leaks password hashes and stack traces'],
  ]],
  ['Housekeeping', [
    ['GET', '/health', 'Is the server up?'],
    ['POST', '/api/reset', 'Put all data back to the starting state'],
    ['GET', '/debug/db?table=users', 'Look at the data directly, like checking the database'],
  ]],
];

function home(req, res) {
  send(res, 200, {
    name: 'QAMadeEasy Practice API',
    message: 'Welcome! Open http://localhost:3000/docs in a browser for every endpoint.',
    accounts: [{ username: 'tester', password: 'Test@123', role: 'user' }, { username: 'admin', password: 'Admin@123', role: 'admin' }, { username: 'buyer2', password: 'Buyer@123', role: 'user' }],
    apiKey: 'qa-key-123',
    oauth: { clientId: 'postman-client', clientSecret: 'postman-secret' },
  });
}

function page(req, res) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const rows = GROUPS.map(([g, list]) => `<h2>${esc(g)}</h2><table>${list.map(([m, p, d]) =>
    `<tr><td class="m ${m}">${m}</td><td><code>${esc(p)}</code></td><td>${esc(d)}</td></tr>`).join('')}</table>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Practice API endpoints</title><style>
body{font-family:system-ui,sans-serif;max-width:1000px;margin:30px auto;padding:0 16px;color:#1d2433}
h1{margin-bottom:4px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #e3e3e3;padding:6px 8px;vertical-align:top}
.m{font-weight:700;width:70px}.GET{color:#2e7d32}.POST{color:#b26a00}.PUT{color:#1565c0}.PATCH{color:#6a1b9a}.DELETE{color:#c62828}
code{background:#f3f3f3;padding:1px 4px;border-radius:3px}</style></head><body>
<h1>QAMadeEasy Practice API</h1><p>Base URL <code>http://localhost:3000</code>. Logins: tester / Test@123, admin / Admin@123, buyer2 / Buyer@123. API key: qa-key-123.</p>
${rows}</body></html>`;
  send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
}

const userSchema = {
  type: 'object', required: ['id', 'name', 'email', 'role', 'active', 'createdAt'],
  properties: {
    id: { type: 'integer', example: 1 }, name: { type: 'string', example: 'Asha Rao' }, email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['tester', 'developer', 'manager'] }, active: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' },
  },
};
const productSchema = {
  type: 'object', required: ['id', 'name', 'category', 'price', 'stock'],
  properties: { id: { type: 'integer' }, name: { type: 'string' }, category: { type: 'string', enum: ['electronics', 'stationery', 'home'] }, price: { type: 'number' }, stock: { type: 'integer' } },
};
const errorSchema = { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } } }, requestId: { type: 'string' } } };
const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };

function openapi(req, res) {
  send(res, 200, {
    openapi: '3.0.3',
    info: { title: 'QAMadeEasy Practice API', version: '2.0.0', description: 'Practice API for the QAMadeEasy API Testing with Postman course.' },
    servers: [{ url: 'http://localhost:3000' }],
    paths: {
      '/api/users': {
        get: { summary: 'List users', tags: ['Users'], parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 5 } },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['tester', 'developer', 'manager'] } },
          { name: 'sort', in: 'query', schema: { type: 'string', example: '-createdAt' } }],
        responses: { 200: { description: 'A page of users', content: { 'application/json': { schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/User' } }, page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } } } } }, 400: err('Bad query parameter') } },
        post: { summary: 'Create a user', tags: ['Users'], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['tester', 'developer', 'manager'] }, active: { type: 'boolean' } } }, example: { name: 'Sara Khan', email: 'sara@example.com', role: 'tester' } } } },
          responses: { 201: { description: 'Created', headers: { Location: { schema: { type: 'string' } } }, content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }, 400: err('Validation failed'), 409: err('Email already used'), 415: err('Body is not JSON') } },
      },
      '/api/users/{id}': {
        parameters: [idParam],
        get: { summary: 'Get one user', tags: ['Users'], responses: { 200: { description: 'The user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } }, 404: err('No such user') } },
        put: { summary: 'Replace a user', tags: ['Users'], responses: { 200: { description: 'Replaced' }, 400: err('Missing fields'), 404: err('No such user'), 412: err('ETag does not match') } },
        patch: { summary: 'Update some fields', tags: ['Users'], responses: { 200: { description: 'Updated' }, 400: err('Bad fields'), 404: err('No such user') } },
        delete: { summary: 'Delete a user', tags: ['Users'], responses: { 204: { description: 'Deleted' }, 404: err('No such user') } },
      },
      '/api/products': { get: { summary: 'List products', tags: ['Products'], responses: { 200: { description: 'A page of products' } } } },
      '/api/products/{id}': { parameters: [idParam], get: { summary: 'Get one product', tags: ['Products'], responses: { 200: { description: 'The product', content: { 'application/json': { schema: { $ref: '#/components/schemas/Product' } }, 'application/xml': {} } }, 404: err('No such product'), 406: err('Unsupported Accept') } } },
      '/api/auth/login': { post: { summary: 'Log in and get a token', tags: ['Auth'], requestBody: { required: true, content: { 'application/json': { example: { username: 'tester', password: 'Test@123' } } } }, responses: { 200: { description: 'Token' }, 400: err('Missing fields'), 401: err('Wrong credentials') } } },
      '/api/orders': {
        get: { summary: 'Your orders', tags: ['Orders'], security: [{ bearerAuth: [] }], responses: { 200: { description: 'Orders' }, 401: err('No or bad token') } },
        post: { summary: 'Place an order', tags: ['Orders'], security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { example: { productId: 1, quantity: 2 } } } }, responses: { 201: { description: 'Placed' }, 400: err('Bad fields'), 401: err('No or bad token'), 409: err('Out of stock'), 422: err('Product does not exist') } },
      },
      '/api/orders/{id}': { parameters: [idParam], get: { summary: 'One of your orders', tags: ['Orders'], security: [{ bearerAuth: [] }], responses: { 200: { description: 'The order' }, 401: err('No or bad token'), 404: err('Not found or not yours') } } },
    },
    components: {
      schemas: { User: userSchema, Product: productSchema, Error: errorSchema },
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  });
}

module.exports = { home, page, openapi, GROUPS };
