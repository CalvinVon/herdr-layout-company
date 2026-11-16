const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, 'move-terminal.js'), 'utf8');
  const { moveTerminal } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const request = { terminal: 'agent', pane: 'p1', tab: 't1', space: 's1', machine: null, name: 'Review (Codex)', destination: null, direction: 'right' };
  function fixture(mode = 'success') {
    const commands = [];
    const space = { id: 's1', machine: null, active: true, tabs: [{ id: 't1' }, { id: 't2', name: 'Existing', named: true }, { id: 't3', name: 'Other' }] };
    let panes = [{ pane: 'p1', tab: 't1', terminal: 'agent' }, { pane: 'p2', tab: 't1', terminal: 'other' }, { pane: 'p3', tab: 't2', terminal: 'target' }, { pane: 'p4', tab: 't3', terminal: 'else' }];
    let focus = { space: 's1', tab: 't1', pane: 'p1' };
    return { commands, space, api: {
      spaces: () => [space], panes: () => panes, terminals: () => ['agent', 'other', 'target', 'else'].map(address => ({ address, state: 'live' })),
      machines: () => [{ name: null, layout: 'ready' }], focused: () => focus, sleep: async () => {},
      run(command, args) {
        commands.push([command, args]);
        if (command === 'terminal.park' && mode !== 'park-timeout') {
          panes = panes.filter(p => p.pane !== 'p1');
          if (mode === 'switch') space.active = false;
          if (mode === 'target-gone') panes = panes.filter(p => p.tab !== 't2');
        }
        if (command === 'tab.select' && mode !== 'focus-fails') focus = { ...focus, tab: args.id };
        if (command === 'pane.focus' && mode !== 'focus-fails') focus = { ...focus, pane: args.pane };
        if (command === 'terminal.keep' && mode !== 'keep-timeout') {
          const tab = args.place === 'tab' ? 't4' : mode === 'wrong-target' ? 't3' : focus.tab;
          if (args.place === 'tab') space.tabs.push({ id: tab, name: '4', named: false });
          panes.push({ pane: 'p5', tab, terminal: 'agent' });
        }
        if (command === 'tab.rename' && mode !== 'rename-fails') Object.assign(space.tabs.find(t => t.id === args.id), { name: args.name, named: true });
      }
    } };
  }
  const fresh = fixture();
  await moveTerminal(fresh.api, request);
  assert.deepEqual(fresh.commands, [['terminal.park', { terminal: 'agent' }], ['terminal.keep', { terminal: 'agent', place: 'tab' }], ['tab.rename', { id: 't4', name: 'Review (Codex)' }]]);
  assert.equal(fresh.space.tabs.find(t => t.id === 't4').name, request.name);
  for (const direction of ['right', 'down']) {
    const split = fixture();
    await moveTerminal(split.api, { ...request, destination: 't2', direction });
    assert.deepEqual(split.commands, [['terminal.park', { terminal: 'agent' }], ['tab.select', { id: 't2' }], ['pane.focus', { pane: 'p3' }], ['terminal.keep', { terminal: 'agent', place: direction }]]);
    assert.equal(split.space.tabs.find(t => t.id === 't2').name, 'Existing');
  }
  for (const mode of ['park-timeout', 'switch', 'keep-timeout', 'rename-fails']) {
    await assert.rejects(moveTerminal(fixture(mode).api, request));
  }
  for (const mode of ['target-gone', 'focus-fails', 'wrong-target']) {
    const sample = fixture(mode);
    await assert.rejects(moveTerminal(sample.api, { ...request, destination: 't2' }));
    if (mode !== 'wrong-target') assert.equal(sample.commands.some(([command]) => command === 'terminal.keep'), false);
    assert.equal(sample.commands.some(([command]) => command === 'tab.rename'), false);
  }
  for (const destination of ['t1', 'missing']) {
    const sample = fixture();
    await assert.rejects(moveTerminal(sample.api, { ...request, destination }));
    assert.deepEqual(sample.commands, []);
  }
  const unavailable = fixture();
  unavailable.api.machines = () => [];
  await assert.rejects(moveTerminal(unavailable.api, request));
  assert.deepEqual(unavailable.commands, []);
  console.log('move-terminal checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
