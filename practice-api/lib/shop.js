// GET /shop (login page) and GET /shop/orders (My Orders page): a tiny web UI over the same API,
// so UI tests and mixed API + UI tests have a real page to drive. The pages call the API with fetch.
'use strict';
const { send } = require('./core');

const STYLE = `
  body { font-family: system-ui, Arial, sans-serif; margin: 0; background: #f4f6fb; color: #1b2a44; }
  header { background: #16223a; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; }
  header b { color: #f2c25c; }
  main { max-width: 760px; margin: 32px auto; background: #fff; padding: 24px 28px; border-radius: 10px; box-shadow: 0 2px 8px #0002; }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  input { width: 100%; padding: 9px; box-sizing: border-box; border: 1px solid #b8c2d6; border-radius: 6px; }
  button { margin-top: 16px; padding: 9px 18px; border: 0; border-radius: 6px; background: #2f6fdb; color: #fff; font-weight: 600; cursor: pointer; }
  .error { color: #b3261e; margin-top: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e1e6f0; }
  .status { font-weight: 700; }
`;

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${STYLE}</style></head>
<body><header><span><b>QA</b>MadeEasy Shop</span><span id="who"></span></header><main>${body}</main></body></html>`;
}

const LOGIN = page('Shop: Log in', `
<h1>Log in</h1>
<form id="login-form">
  <label for="username">Username</label><input id="username" name="username" autocomplete="username">
  <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password">
  <button type="submit">Log in</button>
  <p class="error" role="alert" id="error" hidden></p>
</form>
<script>
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.value, password: password.value }) });
  const body = await res.json();
  if (!res.ok) { error.textContent = body.error.message; error.hidden = false; return; }
  sessionStorage.setItem('token', body.token);
  sessionStorage.setItem('name', body.user.name);
  location.href = '/shop/orders';
});
</script>`);

const ORDERS = page('Shop: My Orders', `
<h1>My Orders</h1>
<p id="loading">Loading your orders...</p>
<table id="orders" hidden>
  <thead><tr><th>Order</th><th>Product</th><th>Qty</th><th>Total</th><th>Status</th></tr></thead>
  <tbody></tbody>
</table>
<p id="empty" hidden>You have no orders yet.</p>
<button id="logout">Log out</button>
<script>
const token = sessionStorage.getItem('token');
if (!token) location.href = '/shop';
document.getElementById('who').textContent = 'Signed in as ' + sessionStorage.getItem('name');
document.getElementById('logout').onclick = () => { sessionStorage.clear(); location.href = '/shop'; };
(async () => {
  const auth = { headers: { Authorization: 'Bearer ' + token } };
  const [o, p] = await Promise.all([fetch('/api/orders', auth), fetch('/api/products?limit=50')]);
  if (o.status === 401) { sessionStorage.clear(); location.href = '/shop'; return; }
  const orders = (await o.json()).data, products = (await p.json()).data;
  const name = (id) => (products.find((x) => x.id === id) || { name: 'Product ' + id }).name;
  const body = document.querySelector('#orders tbody');
  for (const x of orders) {
    const tr = document.createElement('tr');
    tr.dataset.orderId = x.id;
    tr.innerHTML = '<td>#' + x.id + '</td><td>' + name(x.productId) + '</td><td>' + x.quantity + '</td><td>' +
      x.total + '</td><td class="status">' + x.status + '</td>';
    body.appendChild(tr);
  }
  document.getElementById('loading').hidden = true;
  document.getElementById(orders.length ? 'orders' : 'empty').hidden = false;
})();
</script>`);

function html(res, body) { send(res, 200, body, { 'Content-Type': 'text/html; charset=utf-8' }); }

module.exports = {
  loginPage: (req, res) => html(res, LOGIN),
  ordersPage: (req, res) => html(res, ORDERS),
};
