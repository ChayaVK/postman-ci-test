// A small WebSocket server (RFC 6455, no libraries) at ws://localhost:3000/ws
// Messages: plain text is echoed back; JSON {"type":"ping"} -> pong; {"type":"subscribe","topic":"orders"}
// -> you receive an "order.created" message every time an order is placed.
'use strict';
const crypto = require('node:crypto');

const clients = new Set();

function frame(text) {
  const data = Buffer.from(text);
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  return Buffer.concat([head, data]);
}

function sendJson(c, obj) { if (!c.socket.destroyed) c.socket.write(frame(JSON.stringify(obj))); }

function onMessage(c, text) {
  let msg = null;
  if (text.trim().startsWith('{')) {
    try { msg = JSON.parse(text); } catch { return sendJson(c, { type: 'error', message: 'That looks like JSON but is not valid JSON.' }); }
  }
  if (!msg) return sendJson(c, { type: 'echo', received: text, at: new Date().toISOString() });
  switch (msg.type) {
    case 'ping': return sendJson(c, { type: 'pong', at: new Date().toISOString() });
    case 'subscribe':
      if (msg.topic !== 'orders') return sendJson(c, { type: 'error', message: 'Only the "orders" topic exists.' });
      c.topics.add('orders');
      return sendJson(c, { type: 'subscribed', topic: 'orders', message: 'You will get a message each time an order is placed.' });
    case 'unsubscribe':
      c.topics.delete(msg.topic);
      return sendJson(c, { type: 'unsubscribed', topic: msg.topic });
    default:
      return sendJson(c, { type: 'error', message: 'Unknown type. Use "ping", "subscribe" or "unsubscribe", or send plain text to get it echoed.' });
  }
}

function upgrade(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket' || !req.headers['sec-websocket-key']) {
    socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\nWebSocket endpoint is ws://localhost:3000/ws');
    return;
  }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const c = { socket, topics: new Set(), buf: Buffer.alloc(0), parts: [] };
  clients.add(c);
  sendJson(c, { type: 'welcome', message: 'Connected to the practice API WebSocket. Send any text to get it echoed, or {"type":"subscribe","topic":"orders"}.' });
  const onData = (chunk) => {
    c.buf = Buffer.concat([c.buf, chunk]);
    while (c.buf.length >= 2) {
      const fin = (c.buf[0] & 0x80) !== 0, op = c.buf[0] & 0x0f, masked = (c.buf[1] & 0x80) !== 0;
      let len = c.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (c.buf.length < need) return;
      let data = c.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) { const mask = c.buf.subarray(off, off + 4); data = Buffer.from(data.map((b, i) => b ^ mask[i % 4])); }
      c.buf = c.buf.subarray(need);
      if (op === 0x8) { socket.end(Buffer.from([0x88, 0])); clients.delete(c); return; }
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); continue; }
      if (op === 0x1 || op === 0x0) {
        c.parts.push(data);
        if (fin) { const text = Buffer.concat(c.parts).toString(); c.parts = []; onMessage(c, text); }
      }
    }
  };
  socket.on('data', onData);
  if (head && head.length) onData(head);
  socket.on('close', () => clients.delete(c));
  socket.on('error', () => clients.delete(c));
}

function broadcast(topic, obj) {
  for (const c of clients) if (c.topics.has(topic)) sendJson(c, obj);
}

module.exports = { upgrade, broadcast };
