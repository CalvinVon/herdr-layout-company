const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(process.env.ARTIFACTS_SOURCE || path.join(__dirname, 'artifacts.js'), 'utf8').replace(/^export /gm, '');
const { artifactOwner, verifyArtifactOwners } = new Function(`${source}\nreturn {artifactOwner, verifyArtifactOwners};`)();
const parent = { address: 'parent', state: 'live', created_ms: 10 };
const child = { address: 'child', state: 'live', created_ms: 20, parent: 'parent' };
const project = { id: 'space-a', projectKey: 'repo', machine: null, members: [{ terminal: 'parent' }] };
const card = { id: 'report', kind: 'file', roomKey: 'repo', path: '/repo/report.md', author: { terminal: 'child', createdMs: 20 }, workstation: { terminal: 'parent', createdMs: 10, space: 'space-a' } };
assert.equal(artifactOwner(card, project, [parent, child]), 'parent');
assert.equal(artifactOwner(card, { ...project, members: [...project.members, { terminal: 'child' }] }, [parent, child]), 'child');
assert.equal(artifactOwner(card, { ...project, projectKey: 'different' }, [parent, child]), null);
assert.equal(artifactOwner(card, { ...project, id: 'other-space' }, [parent, child]), null);
assert.equal(artifactOwner(card, { ...project, machine: 'remote' }, [parent, child]), null);
assert.equal(artifactOwner({ ...card, author: undefined, workstation: undefined, source: 'Agent · parent' }, project, [parent]), null);
assert.equal(artifactOwner(card, project, [{ ...parent, created_ms: 11 }, { ...child, created_ms: 21 }]), null);
assert.equal(artifactOwner(card, project, []), null);
(async () => {
  const snapshot = { address: 'parent', state: 'live', pid: 100, foreground: { pid: 123 }, title: '⠋ 修复', status: 'working' };
  let inspections = 0;
  const proofs = await verifyArtifactOwners([card, { ...card, id: 'report-2' }], [snapshot], async address => {
    inspections++;
    assert.equal(address, 'parent');
    return parent;
  });
  assert.equal(inspections, 1);
  assert.equal(artifactOwner(card, project, [snapshot], proofs), 'parent');
  for (const update of [
    { title: '⠙ 修复' },
    { status: 'idle', status_ms: 1000, turn: 2 },
    { report: { app: 'codex', msg: '修复完成' } },
    { labels: { role: '测试工程师' } },
    { cwd: '/repo/subfolder', cols: 120, rows: 40 },
    { foreground: { pid: 123, cwd: '/repo/subfolder', name: 'codex' } },
  ]) {
    assert.equal(artifactOwner(card, project, [{ ...snapshot, ...update }], proofs), 'parent', `Live metadata must not make workstation documents disappear: ${JSON.stringify(update)}`);
  }
  assert.equal(artifactOwner(card, project, [{ ...snapshot, pid: 101 }], proofs), null);
  assert.equal(artifactOwner(card, project, [{ ...snapshot, foreground: { pid: 456 } }], proofs), null);
  assert.equal(artifactOwner(card, project, [{ ...snapshot, created_ms: 11 }], proofs), null);
  const failed = await verifyArtifactOwners([card], [snapshot], async () => { throw Error('offline'); });
  assert.equal(artifactOwner(card, project, [snapshot], failed), null);
  console.log('Workstation document ownership, parent fallback, project isolation and reused-address checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
