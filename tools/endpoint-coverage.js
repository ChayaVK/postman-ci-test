// Which operations in the API's OpenAPI file does a collection call? (Node.js 18+)
// Run: node tools/endpoint-coverage.js collections/ch33-capstone.postman_collection.json
const fs = require('node:fs');

const collection = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const called = new Set();
(function walk(items) {
  for (const it of items) {
    if (it.item) walk(it.item);
    else {
      const path = '/' + it.request.url.path
        .map((p) => (/^\{\{.+\}\}$|^\d+$|^:/.test(p) ? '{id}' : p)).join('/');
      called.add(`${it.request.method} ${path}`);
    }
  }
})(collection.item);

fetch('http://localhost:3000/openapi.json').then((r) => r.json()).then((spec) => {
  const ops = Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.keys(methods).filter((m) => m !== 'parameters').map((m) => `${m.toUpperCase()} ${path}`));
  const missing = ops.filter((op) => !called.has(op));
  console.log(`Covered ${ops.length - missing.length} of ${ops.length} operations in /openapi.json`);
  missing.forEach((op) => console.log('  not called:', op));
});
