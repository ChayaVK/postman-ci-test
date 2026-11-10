import { test, expect } from '@playwright/test';

test('tester logs in and places an order', async ({ request }) => {
  // 1. log in and keep the token
  const login = await request.post('/api/auth/login', {
    data: { username: 'tester', password: 'Test@123' },
  });
  expect(login.status()).toBe(200);
  const { token } = await login.json();

  // 2. place an order with the token
  const auth = { Authorization: `Bearer ${token}` };
  const res = await request.post('/api/orders', {
    headers: auth,
    data: { productId: 1, quantity: 2 },
  });
  expect(res.status()).toBe(201);
  const order = await res.json();
  expect(order).toMatchObject({
    productId: 1, quantity: 2, status: 'PLACED', total: 1598,
  });

  // 3. clean up: cancel the order so the stock goes back
  const cancel = await request.delete(`/api/orders/${order.id}`, { headers: auth });
  expect(cancel.status()).toBe(200);
});
