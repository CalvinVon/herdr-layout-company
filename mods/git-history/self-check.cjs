const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, 'graph.js'), 'utf8');
/** @type {typeof import('./graph.js')} */
const { parseLog, graphRows } = new Function(source.replace(/export /g, '') + '\nreturn { parseLog, graphRows };')();
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'herdr-git-history-'));
/** @param {...string} args */
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
(async () => {
  try {
    git('init', '--initial-branch=main');
    const tree = execFileSync('git', ['mktree'], { cwd: repo, input: '', encoding: 'utf8' }).trim();
    /** @param {string} subject @param {string[]} [parents] */
    const commit = (subject, parents = []) => git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit-tree', tree, '-m', subject, ...parents.flatMap(parent => ['-p', parent]));
    const root = commit('root');
    const main = commit('main', [root]);
    const topic = commit('feature 中文', [root]);
    const third = commit('third', [root]);
    const merge = commit('octopus merge', [main, topic, third]);
    git('update-ref', 'refs/heads/main', merge);
    git('update-ref', 'refs/heads/topic', topic);
    const format = '%H%x00%P%x00%h%x00%an%x00%ad%x00%s%x00%D%x1e';
    const commits = parseLog(git('log', '--all', '--topo-order', '--date=short', `--format=${format}`));
    assert.equal(commits[0].hash, merge);
    assert.deepEqual(commits[0].parents, [main, topic, third]);
    assert.equal(commits.find(item => item.hash === topic).subject, 'feature 中文');
    assert.ok(commits[0].refs.includes('HEAD -> main'));
    const before = JSON.stringify(commits), rows = graphRows(commits);
    assert.equal(JSON.stringify(commits), before);
    assert.equal(rows[0].edges.length, 3);
    assert.equal(new Set(rows[0].edges.map(edge => edge.to)).size, 3);
    assert.equal(new Set(rows[0].edges.map(edge => edge.color)).size, 3);
    const rootRow = rows.find(row => row.hash === root);
    assert.equal(rootRow.edges.length, 0);
    assert.equal(rootRow.incoming, true);
    let destinations = new Map();
    for (const row of rows) {
      if (row.incoming) assert.equal(destinations.get(row.hash), row.slot);
      const next = new Map();
      for (const edge of row.edges) {
        assert.ok(edge.from >= 0 && edge.to >= 0);
        assert.ok(edge.from * 16 + 12 < row.width && edge.to * 16 + 12 < row.width);
        if (!edge.middle) {
          const hash = [...destinations].find(([, lane]) => lane === edge.from)?.[0];
          if (hash && hash !== row.hash) next.set(hash, edge.to);
        }
      }
      for (const [index, parent] of row.parents.entries()) next.set(parent, row.edges.filter(edge => edge.middle)[index].to);
      destinations = next;
    }
    assert.deepEqual(graphRows([]), []);
    assert.deepEqual(parseLog('\n'), []);
    assert.throws(() => parseLog('invalid\x1e'), /Cannot parse/);
    git('checkout', '--detach', main);
    assert.ok(parseLog(git('log', '-1', `--format=${format}`))[0].refs.includes('HEAD'));

    let cwd = '/repo';
    const pending = new Map();
    /** @type {Promise<unknown>[]} */
    const jobs = [];
    /** @type {{notify: () => void, spawn: (fn: (cx: any) => Promise<any>) => void}} */
    const cx = { notify() {}, spawn(fn) { jobs.push(fn(cx)); } };
    /** @type {{View: any, parseLog: typeof parseLog, graphRows: typeof graphRows, spaces: () => any[], focused: () => any, panes: () => any[], exec: (program: string, args: string[]) => Promise<any>}} */
    const env = {
      View: class {}, parseLog, graphRows,
      spaces: () => [{ active: true, folder: cwd, machine: null }], focused: () => null, panes: () => [],
      exec: (_program, args) => new Promise(resolve => pending.set(args.at(-2), resolve)),
    };
    const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const History = new Function(...Object.keys(env), mainSource.replace(/^import .*;\n/gm, '').replace('export default class GitHistory', 'class GitHistory') + '\nreturn GitHistory;')(...Object.values(env));
    const panel = new History();
    Object.assign(panel, { commits: rows, context: JSON.stringify({ cwd, on: null }), root: cwd, detailRequest: 0 });
    panel.pick(merge, cx); panel.pick(main, cx);
    pending.get(main)({ code: 0, stdout: 'new selection', stderr: '' });
    await jobs[1];
    pending.get(merge)({ code: 0, stdout: 'stale selection', stderr: '' });
    await jobs[0];
    assert.deepEqual(panel.detail, ['new selection']);
    panel.pick(topic, cx); cwd = '/another-worktree';
    pending.get(topic)({ code: 0, stdout: 'wrong worktree', stderr: '' });
    await jobs[2];
    assert.deepEqual(panel.detail, []);
    const count = jobs.length; panel.pick('missing', cx); assert.equal(jobs.length, count);
    console.log('Passed: real Git octopus merge, lane continuity and convergence, branch labels, Unicode, detached HEAD, roots, malformed input, stale-selection and worktree-switch isolation. Fixture Git writes were limited to a temporary repository.');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
