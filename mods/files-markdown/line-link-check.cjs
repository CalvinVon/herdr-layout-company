const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function element() {
  const node = { attrs: {}, children: [] };
  let view;
  view = new Proxy(node, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => {
      if (key === 'child') target.children.push(args[0]);
      else if (key === 'children') target.children.push(...args[0]);
      else if (key === 'when') { if (args[0]) args[1](view); }
      else target.attrs[key] = args;
      return view;
    };
  } });
  return view;
}

const values = new Map(), reads = [], reveals = [], errors = [], external = [], jobs = [];
let floating = false, load = async () => 'same\n\n中文 😀\nsame\n';
const makeDocument = value => ({ value: () => value, release() {}, search() {}, on() {},
  reveal_line(line, column) { reveals.push({ document: this, line, column }); },
});
const environment = {
  View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
  Editor: { new: element }, EditorState: { new: options => makeDocument(options.value) },
  TextView: { new: element }, TextViewState: { markdown: makeDocument },
  spaces: () => [{ id: 's1', active: true, folder: '/repo' }],
  panes: () => [{ pane: 'p1', cwd: '/repo' }], focused: () => ({ pane: 'p1', terminal: 't1' }),
  props: () => ({ floating }), theme: () => ({}), settings: () => ({}),
  shared: key => values.get(key), setShared: (key, value) => values.set(key, value),
  notify: message => errors.push(message),
  readTextFile: async filename => { reads.push(filename); return load(filename); },
};
const source = fs.readFileSync(process.env.FILES_SOURCE || path.join(__dirname, 'main.js'), 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default class Files', 'class Files');
const Files = new Function(...Object.keys(environment), `${source}\nreturn Files;`)(...Object.values(environment));
const cx = { notify() {}, spawn(task) { jobs.push(task); }, open_url(url) { external.push(url); } };
const flush = async () => { while (jobs.length) await jobs.shift()(cx); };
const makeViewer = () => Object.assign(new Files(), {
  context: { key: JSON.stringify({ cwd: '/repo', on: null, space: 's1' }) }, root: '/repo', on: null,
  entries: new Map(), folders: new Set(), marks: {}, search: { value: () => '' },
});
const request = async (view, target) => {
  values.set('files-markdown.open', target);
  view.render(cx);
  await flush();
};

(async () => {
  for (const mode of ['inline', 'floating']) {
    floating = mode === 'floating';
    values.set('project-tabs.panel-mode', mode);
    const view = makeViewer();
    await request(view, { path: '/repo/index.vue', line: 1356, column: 9 });
    assert.equal(reads.at(-1), '/repo/index.vue', 'line numbers are never passed to the filesystem');
    assert.equal(view.file, '/repo/index.vue');
    assert.equal(view.preview, false, 'source locations always open source, including Markdown files');
    assert.equal(reveals.at(-1).line, 1356);
    assert.equal(reveals.at(-1).column, 9);
    assert.equal(values.get('files-markdown.open'), null);
    const code = view.code, readCount = reads.length;
    await request(view, { path: '/repo/index.vue', line: 2 });
    assert.equal(view.code, code, 'same-file jumps preserve the native editor instance');
    assert.equal(reads.length, readCount, 'same-file jumps do not read the file again');
    assert.equal(reveals.at(-1).line, 2, 'blank target lines reach the line API directly');
    assert.equal(reveals.at(-1).column, 1);
    const beforeInvalid = reads.length;
    await request(view, { path: '/repo/index.vue', line: 0 });
    assert.equal(reads.length, beforeInvalid);
    assert.ok(errors.at(-1).body.includes('正整数'));
    await request(view, '/repo/plain.vue');
    assert.equal(reads.at(-1), '/repo/plain.vue', 'plain-file requests keep working');
  }

  floating = false; values.set('project-tabs.panel-mode', 'inline');
  const view = makeViewer();
  view.file = '/repo/guide.md';
  for (const [url, filename, line, column] of [
    ['index.vue:3', '/repo/index.vue', 3, 1],
    ['../src/index.vue:12:7', '/repo/../src/index.vue', 12, 7],
    ['file:///repo/a%20b.vue:7:2', '/repo/a b.vue', 7, 2],
    ['C:\\repo\\index.vue:14:3', 'C:\\repo\\index.vue', 14, 3],
  ]) {
    view.file = '/repo/guide.md';
    view.openLink(url, cx); await flush();
    assert.equal(reads.at(-1), filename);
    assert.equal(reveals.at(-1).line, line);
    assert.equal(reveals.at(-1).column, column);
  }
  const beforeExternal = reads.length;
  view.openLink('https://example.com:8443/path', cx);
  assert.equal(external.at(-1), 'https://example.com:8443/path');
  assert.equal(reads.length, beforeExternal, 'web URL ports are never parsed as source locations');
  const longText = 'same\n'.repeat(100001);
  load = async () => longText;
  view.show('/repo/large.vue', cx); await flush();
  assert.ok(view.code.value().length < longText.length, 'ordinary large-file previews keep their existing size bound');
  await request(view, { path: '/repo/large.vue', line: 100000 });
  assert.equal(view.code.value(), longText, 'a jump reloads a truncated preview so its destination is not silently removed');

  const pending = [];
  load = () => new Promise(resolve => pending.push(resolve));
  view.show('/repo/race.vue', cx, { line: 2, column: 1 });
  const oldLoad = jobs.shift()(cx);
  view.show('/repo/race.vue', cx, { line: 4, column: 1 });
  const newLoad = jobs.shift()(cx);
  pending[1]('new\n\nnew\nnew'); await newLoad;
  const newestEditor = view.code;
  pending[0]('old'); await oldLoad;
  assert.equal(view.code, newestEditor, 'an older load of the same file cannot replace the newer editor');
  assert.equal(view.code.value(), 'new\n\nnew\nnew');
  assert.equal(reveals.at(-1).line, 4);
  const beforeQueued = reveals.length;
  view.show('/repo/race.vue', cx, { line: 1, column: 1 });
  view.show('/repo/race.vue', cx, { line: 3, column: 1 });
  await flush();
  assert.equal(reveals.length, beforeQueued + 1, 'a superseded queued jump cannot flash an older target');
  assert.equal(reveals.at(-1).line, 3);

  values.set('project-tabs.panel-mode', 'floating');
  const target = { path: '/repo/race.vue', line: 2 };
  values.set('files-markdown.open', target);
  view.render(cx);
  assert.equal(values.get('files-markdown.open'), target, 'an inactive docked copy leaves the request for the floating copy');
  console.log('Source links passed: exact file/line/column handoff, plain opens, inline/floating, URI decoding, Windows paths, blank lines, no truncation, same-file reuse and stale-load protection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
