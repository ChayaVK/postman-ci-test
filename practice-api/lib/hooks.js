// Webhooks: when something happens (an order is placed), POST an event to every subscribed URL.
'use strict';
const http = require('node:http');
const { db } = require('./data');

function fire(event, data) {
  require('./ws').broadcast('orders', { type: event, data, at: new Date().toISOString() });
  const payload = JSON.stringify({ event, data, sentAt: new Date().toISOString() });
  for (const h of db.webhooks) {
    try {
      const u = new URL(h.url);
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'X-Webhook-Event': event } });
      req.on('error', () => {});
      req.end(payload);
    } catch { /* bad URL: ignore */ }
  }
}

module.exports = { fire };
