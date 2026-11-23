const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let builds = 0;
const element = () => {
  const view = { props: {}, nodes: [] };
  for (const name of ['id', 'size', 'bg', 'left', 'top', 'w', 'h']) view[name] = value => { view.props[name] = value; return view; };
  for (const name of ['relative', 'absolute', 'flex_none']) view[name] = () => view;
  view.child = child => { view.nodes.push(child); return view; };
  return view;
};
const PathBuilder = { fill() {
  const polygons = [];
  return {
    add_polygon(points) { polygons.push(points); },
    build() { builds++; return { polygons }; },
  };
} };
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, 'main.js'), 'utf8');
const wallQR = new Function('View', 'PathBuilder', 'div', source.replace(/^import .*;\n/gm, '').replace('export default class ', 'class ') + '\nreturn wallQR;')(class {}, PathBuilder, element);
const previousWindow = globalThis.window;
globalThis.window = { paint_path(geometry, color) { return Object.assign(element(), { geometry, color }); } };

function verify(matrix, unit, id) {
  const view = wallQR(matrix, unit, id);
  assert.equal(view.props.id, id);
  assert.equal(view.props.size, (matrix.length + 8) * unit);
  const painted = view.nodes[0];
  assert.equal(painted.color, '#000000');
  const pixels = new Set();
  for (const points of painted.geometry.polygons) {
    const [[left, top], [right], [, bottom]] = points;
    assert.equal(bottom - top, unit);
    assert.ok(left >= 4 * unit && top >= 4 * unit, 'QR quiet zone stays empty');
    for (let x = left / unit - 4; x < right / unit - 4; x++) pixels.add(`${x},${top / unit - 4}`);
  }
  for (let y = 0; y < matrix.length; y++) for (let x = 0; x < matrix.length; x++) {
    assert.equal(pixels.has(`${x},${y}`), Boolean(matrix[y][x]), `QR pixel ${x},${y}`);
  }
  return view;
}

try {
  const matrix = Array.from({ length: 37 }, (_, y) => Array.from({ length: 37 }, (_, x) => (x * 3 + y * 5) % 7 < 3));
  const first = verify(matrix, 2, 'qr-first');
  const next = verify(matrix, 2, 'qr-next');
  assert.notEqual(next, first, 'each render must create a fresh element');
  assert.notEqual(next.nodes[0], first.nodes[0], 'paint elements belong to their render');
  assert.equal(builds, 1, 'focus-only renders must not rebuild unchanged native QR geometry');
  verify(matrix, 3, 'qr-resized');
  assert.equal(builds, 2, 'resizing must rebuild QR geometry');
  const replacement = matrix.map(row => [...row]);
  replacement[0][0] = !replacement[0][0];
  verify(replacement, 3, 'qr-updated');
  assert.equal(builds, 3, 'replacing QR data must rebuild geometry');
  verify(matrix, 2, 'qr-original-size');
  assert.equal(builds, 4, 'returning to an earlier size must still produce correctly scaled pixels');
  console.log('Passed: QR pixels, quiet zone, focus reuse, fresh elements, resize and replacement.');
} finally {
  globalThis.window = previousWindow;
}
