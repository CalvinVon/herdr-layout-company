const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function load(file, env) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const names = [...source.matchAll(/^export (?:const|function|class) (\w+)/gm)].map(match => match[1]);
  const main = source.match(/export default class (\w+)/)?.[1];
  const body = source.replace(/^import .*;\n/gm, '').replace(/export default class /, 'class ').replace(/^export /gm, '');
  return new Function(...Object.keys(env), body + '\nreturn {' + names.join(',') + (main ? `${names.length ? ',' : ''}default:${main}` : '') + '};')(...Object.values(env));
}
function element() {
  const data = { props: {}, nodes: [] };
  let view;
  view = new Proxy(data, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') target.nodes.push(args[0]);
      else if (key === 'children') target.nodes.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](view); }
      else target.props[key] = args[0];
      return view;
    };
  } });
  return view;
}
const store = load('store.js', {}), encoder = load('qr-encoder.js', {});
const files = new Map();
let target = { roomKey: 'local:alpha', roomName: 'Alpha', services: [] };
const pending = [];
const shared = [], opened = [];
const cx = { notify() {}, focus_handle: () => ({ focus() {} }), timer: { every() {} }, spawn(fn) { pending.push(Promise.resolve().then(() => fn(cx))); } };
async function flush() { while (pending.length) await Promise.all(pending.splice(0)); }
const input = () => ({ text: '', set_value(value) { this.text = value; }, value() { return this.text; }, focus() {} });
const env = { ...store, ...encoder, View: class {}, div: element, h_flex: element, v_flex: element, InputState: { new: input }, Input: { new: element },
  props: () => target, theme: () => ({ solid: '#111', solid_foreground: '#fff', raised: '#eee', foreground: '#111', input: '#ddd', background: '#fff', surface: '#fff', muted: '#555', blocked: '#f00', popover: '#fff', dim: '#777' }),
  appHome: () => '/test', readTextFile: async file => files.has(file) ? files.get(file) : null,
  writeTextFile: async (file, text, expected) => { if ((files.get(file) ?? null) !== expected) throw Error('stale'); files.set(file, text); },
  run() {}, closeOverlay() {}, setShared: (key, value) => shared.push({ key, value }), window: () => ({ platform: 'macos' }), exec: async (command, args) => { opened.push({ command, args }); return { code: 0 }; } };
const Panel = load('main.js', env).default;
const find = (node, id) => node?.props?.id === id ? node : (node?.nodes ?? []).map(child => find(child, id)).find(Boolean);
(async () => {
  const alpha = new Panel(); alpha.init({}, cx); await flush();
  alpha.edit(null, cx); alpha.name.set_value('开发地址'); alpha.url.set_value('https://example.org/qr'); alpha.saveEdit(cx); await flush();
  const data = JSON.parse(files.get('/test/office-wall-pins.json'));
  assert.equal(data.rooms['local:alpha'][0].url, 'https://example.org/qr');
  assert.equal(data.rooms['local:alpha'][0].qrKind, 'generated');
  assert.ok(store.validMatrix(data.rooms['local:alpha'][0].qr));
  assert.ok(find(alpha.render(), 'wall-card-0'));
  alpha.services = [{ id: 't1', name: '终端服务', status: 'running', urls: ['http://localhost:8081/'], qr: data.rooms['local:alpha'][0].qr, pane: 'pane-a' }];
  find(alpha.render(), 'pin-0').props.on_click({}, cx); await flush();
  const pinned = JSON.parse(files.get('/test/office-wall-pins.json')).rooms['local:alpha'];
  assert.equal(pinned.length, 2);
  assert.equal(pinned[1].qrKind, 'terminal');
  assert.deepEqual(pinned[1].qr, data.rooms['local:alpha'][0].qr);
  alpha.services[0].qr = null;
  const labels = node => typeof node === 'string' ? [node] : (node?.nodes ?? []).flatMap(labels);
  assert.ok(labels(alpha.render()).includes('终端原码'));
  target = { roomKey: 'local:beta', roomName: 'Beta', services: [] };
  const beta = new Panel(); beta.init({}, cx); await flush();
  assert.equal(beta.pins.length, 0);
  target = { roomKey: 'local:alpha', roomName: 'Alpha', services: [] };
  const restored = new Panel(); restored.init({}, cx); await flush();
  assert.equal(restored.pins[0].name, '开发地址');
  restored.change({ type: 'remove', id: restored.pins[0].id }, cx); await flush();
  assert.equal(JSON.parse(files.get('/test/office-wall-pins.json')).rooms['local:alpha'][0].id, 't1');
  restored.change({ type: 'remove', id: 't1' }, cx); await flush();
  assert.deepEqual(JSON.parse(files.get('/test/office-wall-pins.json')).rooms['local:alpha'], []);
  files.set('/test/snapshot.json', JSON.stringify({ _updatedAt: Date.now() - 60000, 'local:alpha': [{ id: 't1', status: 'running', urls: [] }] }));
  target = { roomKey: 'local:alpha', roomName: 'Alpha', services: [], serviceFile: '/test/snapshot.json' };
  const stale = new Panel(); stale.init({}, cx); await flush();
  assert.equal(stale.services[0].status, 'unknown');
  assert.ok(stale.serviceError);
  target = { roomKey: 'local:gamma', roomName: 'Gamma', services: [] };
  const first = new Panel(), second = new Panel(); first.init({}, cx); second.init({}, cx); await flush();
  first.edit(null, cx); first.name.set_value('一'); first.url.set_value('https://example.org/one'); first.saveEdit(cx); await flush();
  second.edit(null, cx); second.name.set_value('二'); second.url.set_value('https://example.org/two'); second.saveEdit(cx); await flush();
  assert.deepEqual(JSON.parse(files.get('/test/office-wall-pins.json')).rooms['local:gamma'].map(card => card.name), ['一', '二']);
  find(first.render(), 'wall-add-note').props.on_click({}, cx);
  first.name.set_value('备忘'); first.content.set_value('原始内容'); first.saveEdit(cx); await flush();
  let note = first.pins.find(card => card.kind === 'note');
  assert.equal(note.text, '原始内容');
  let noteIndex = first.pins.findIndex(card => card.id === note.id);
  find(first.render(), `edit-${noteIndex}`).props.on_click({}, cx);
  first.content.set_value('更新内容'); first.saveEdit(cx); await flush();
  assert.equal(first.pins.find(card => card.id === note.id).text, '更新内容');
  find(first.render(), 'wall-add-file').props.on_click({}, cx);
  first.name.set_value('报告'); first.content.set_value('/tmp/report.html'); first.saveEdit(cx); await flush();
  const fileIndex = first.pins.findIndex(card => card.kind === 'file');
  find(first.render(), `file-open-${fileIndex}`).props.on_click({}, cx); await flush();
  assert.deepEqual(opened.at(-1), { command: 'open', args: ['/tmp/report.html'] });
  find(first.render(), `unpin-${fileIndex}`).props.on_click({}, cx); await flush();
  assert.equal(first.pins.some(card => card.kind === 'file'), false);
  first.services = [{ id: 'goal', kind: 'goal', name: '目标', text: '完成任务', source: 'agent' }, { id: 'published', kind: 'note', name: '发布', text: '可见内容', source: 'agent', published: true }];
  assert.ok(labels(first.render()).includes('可见内容'));
  find(first.render(), 'pin-0').props.on_click({}, cx); await flush();
  assert.equal(first.pins.find(card => card.id === 'goal').kind, 'note');
  first.services[0].text = '新目标';
  assert.ok(labels(first.render()).includes('新目标'));
  find(first.render(), 'pin-1').props.on_click({}, cx); await flush();
  assert.ok(first.pins.some(card => card.id === 'published'));
  find(first.render(), 'hide-1').props.on_click({}, cx); await flush();
  assert.equal(first.pins.some(card => card.id === 'published'), false);
  assert.equal(shared.at(-1).key, 'office-wall.remove-request');
  assert.equal(shared.at(-1).value.id, 'published');
  files.set('/test/remove-error.json', JSON.stringify({ _updatedAt: Date.now(), _removeError: { roomKey: 'local:gamma', id: 'published' }, 'local:gamma': [{ id: 'published', kind: 'note', name: '发布', text: '可见内容', published: true }] }));
  first.serviceFile = '/test/remove-error.json'; first.refreshServices(cx); await flush();
  assert.equal(Boolean(first.hidden.published), false);
  assert.ok(first.serviceError);
  target = { roomKey: 'local:delta', roomName: 'Delta', services: [{ id: 'web', name: 'Web', urls: ['http://localhost:8081/', 'http://192.0.2.1:8081/'], qr: data.rooms['local:alpha'][0].qr, qrKind: 'generated', qrUrl: 'http://192.0.2.1:8081/' }] };
  const generated = new Panel(); generated.init({}, cx); await flush();
  find(generated.render(), 'pin-0').props.on_click({}, cx); await flush();
  assert.equal(generated.pins[0].url, 'http://192.0.2.1:8081/');
  assert.equal(generated.pins[0].qrKind, 'generated');
  target = { roomKey: 'local:delta', roomName: 'Delta', fileIds: ['desk-a', 'desk-a-pinned'], services: [
    { id: 'desk-a', kind: 'file', name: 'A 方案', path: '/tmp/a.md' },
    { id: 'desk-b', kind: 'file', name: 'B 方案', path: '/tmp/b.pdf' },
  ] };
  const documents = new Panel(); documents.init({}, cx); await flush();
  documents.pins.push(
    { id: 'desk-a-pinned', kind: 'file', name: 'A 报告', path: '/tmp/a.html', url: '' },
    { id: 'desk-b-pinned', kind: 'file', name: 'B 报告', path: '/tmp/b.html', url: '' },
    { id: 'project-note', kind: 'note', name: '项目便签', text: '共享内容', url: '' },
  );
  const documentView = documents.render(), documentLabels = labels(documentView);
  assert.ok(documentLabels.includes('工位文档'));
  assert.ok(documentLabels.includes('Delta · 2 项'));
  assert.ok(documentLabels.includes('A 方案'));
  assert.ok(documentLabels.includes('A 报告'));
  assert.equal(documentLabels.includes('B 方案'), false);
  assert.equal(documentLabels.includes('B 报告'), false);
  assert.equal(documentLabels.includes('项目便签'), false);
  for (const id of ['wall-add', 'wall-add-note', 'wall-add-file']) assert.equal(find(documentView, id), undefined);
  find(documentView, 'file-open-0').props.on_click({}, cx); await flush();
  assert.deepEqual(opened.at(-1), { command: 'open', args: ['/tmp/a.md'] });
  target = { ...target, fileIds: [] };
  const emptyDocuments = new Panel(); emptyDocuments.init({}, cx); await flush();
  assert.ok(labels(emptyDocuments.render()).includes('暂无工位文档。'));
  assert.equal(find(emptyDocuments.render(), 'wall-card-0'), undefined);
  files.set('/test/office-wall-pins.json', '{invalid');
  const broken = new Panel(); broken.init({}, cx); await flush();
  assert.equal(broken.loaded, false);
  assert.ok(broken.error);
  assert.equal(files.get('/test/office-wall-pins.json'), '{invalid');
  console.log('Panel link persistence, QR generation, project isolation and removal checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
