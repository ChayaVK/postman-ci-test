// Latency vs throughput, measured on the practice API (Node.js 18+, no packages).
// Run: node tools/latency-vs-throughput.js      (with the practice API running)
const URL = 'http://localhost:3000/api/slow?ms=200';   // each call takes ~200 ms
const N = 10;

async function call() {
  const start = performance.now();
  const res = await fetch(URL);
  await res.text();
  return performance.now() - start;              // latency of this one call
}

function report(label, latencies, totalMs) {
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const perSecond = (latencies.length / totalMs) * 1000;
  console.log(`${label.padEnd(22)} total ${(totalMs / 1000).toFixed(2)} s | ` +
    `avg latency ${avg.toFixed(0)} ms | throughput ${perSecond.toFixed(1)} req/s`);
}

(async () => {
  let t = performance.now();
  const one = [];
  for (let i = 0; i < N; i++) one.push(await call()); // one user, one call at a time
  report(`${N} calls, one by one`, one, performance.now() - t);

  t = performance.now();
  const all = await Promise.all(Array.from({ length: N }, call)); // N users at once
  report(`${N} calls, all at once`, all, performance.now() - t);
})();
