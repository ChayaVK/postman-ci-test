// The in-memory "database". Restarting the server (or POST /api/reset) puts the starting data back.
'use strict';

function seed() {
  return {
    users: [
      { id: 1, name: 'Asha Rao', email: 'asha@example.com', role: 'tester', active: true, createdAt: '2026-01-05T09:00:00.000Z' },
      { id: 2, name: 'Ravi Kumar', email: 'ravi@example.com', role: 'developer', active: true, createdAt: '2026-01-12T10:30:00.000Z' },
      { id: 3, name: 'Meera Iyer', email: 'meera@example.com', role: 'manager', active: true, createdAt: '2026-02-01T08:15:00.000Z' },
      { id: 4, name: 'John Mathew', email: 'john@example.com', role: 'tester', active: false, createdAt: '2026-02-20T14:45:00.000Z' },
      { id: 5, name: 'Priya Shah', email: 'priya@example.com', role: 'developer', active: true, createdAt: '2026-03-03T11:00:00.000Z' },
      { id: 6, name: 'Kiran Das', email: 'kiran@example.com', role: 'tester', active: true, createdAt: '2026-03-18T16:20:00.000Z' },
      { id: 7, name: 'Neha Verma', email: 'neha@example.com', role: 'manager', active: true, createdAt: '2026-04-02T09:40:00.000Z' },
      { id: 8, name: 'Arjun Nair', email: 'arjun@example.com', role: 'developer', active: false, createdAt: '2026-04-25T13:10:00.000Z' },
    ],
    products: [
      { id: 1, name: 'Wireless Mouse', category: 'electronics', price: 799, stock: 25 },
      { id: 2, name: 'Mechanical Keyboard', category: 'electronics', price: 3499, stock: 10 },
      { id: 3, name: 'USB-C Charger', category: 'electronics', price: 1299, stock: 0 },
      { id: 4, name: 'Notebook A5', category: 'stationery', price: 120, stock: 200 },
      { id: 5, name: 'Gel Pen (Pack of 5)', category: 'stationery', price: 150, stock: 120 },
      { id: 6, name: 'Desk Lamp', category: 'home', price: 1899, stock: 8 },
      { id: 7, name: 'Water Bottle', category: 'home', price: 499, stock: 60 },
      { id: 8, name: 'Laptop Stand', category: 'electronics', price: 2199, stock: 15 },
      { id: 9, name: 'Sticky Notes', category: 'stationery', price: 90, stock: 300 },
      { id: 10, name: 'Coffee Mug', category: 'home', price: 349, stock: 40 },
      { id: 11, name: 'Headphones', category: 'electronics', price: 2999, stock: 12 },
      { id: 12, name: 'Highlighter Set', category: 'stationery', price: 199, stock: 80 },
    ],
    // login accounts (separate from the users list above, like a real auth service)
    accounts: [
      { username: 'tester', password: 'Test@123', role: 'user', name: 'Test User' },
      { username: 'admin', password: 'Admin@123', role: 'admin', name: 'Admin User' },
      { username: 'buyer2', password: 'Buyer@123', role: 'user', name: 'Second Buyer' },
    ],
    orders: [
      { id: 1001, owner: 'tester', productId: 1, quantity: 2, total: 1598, status: 'DELIVERED', createdAt: '2026-05-01T10:00:00.000Z' },
      { id: 1002, owner: 'buyer2', productId: 6, quantity: 1, total: 1899, status: 'SHIPPED', createdAt: '2026-05-03T12:30:00.000Z' },
    ],
    payments: {},   // idempotency key -> { bodyHash, status, body }
    jobs: {},
    files: {},
    sessions: {},   // sid -> username
    webhooks: [],   // subscribed URLs
    inbox: [],      // events received at /webhook-inbox
    nextUserId: 9,
    nextProductId: 13,
    nextOrderId: 1003,
  };
}

const db = seed();
function reset() {
  const fresh = seed();
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, fresh);
}

module.exports = { db, reset };
