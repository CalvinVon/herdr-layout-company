import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const script = new URL('./pi-session.cjs', import.meta.url).pathname;
test('Pi session lookup requires one current title in the matching project', () => {
  const root = mkdtempSync(join(tmpdir(), 'pi-session-'));
  const directory = join(root, 'sessions', '--test-project--');
  mkdirSync(directory, { recursive: true });
  const id = '01234567-89ab-cdef-0123-456789abcdef';
  const file = (name, sessionId, entries) => writeFileSync(join(directory, name), [
    JSON.stringify({ type: 'session', id: sessionId, cwd: '/test/project' }),
    ...entries.map(name => JSON.stringify({ type: 'session_info', name })),
  ].join('\n'));
  const lookup = title => execFileSync(process.execPath, [script, '/test/project', title], { env: { ...process.env, PI_CODING_AGENT_DIR: root }, encoding: 'utf8' }).trim();
  try {
    file('one.jsonl', id, ['old', '1117']);
    assert.equal(lookup('1117'), id);
    assert.equal(lookup('old'), '');
    file('two.jsonl', '11234567-89ab-cdef-0123-456789abcdef', ['1117']);
    assert.equal(lookup('1117'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
