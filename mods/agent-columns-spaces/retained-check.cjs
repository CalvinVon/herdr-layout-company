const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const node = () => ({ children: [], child(child) { this.children.push(child); return this; } });
const source = fs.readFileSync(path.join(__dirname, 'retained-parts.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
const RetainedParts = new Function('View', 'div', `${source}\nreturn RetainedParts;`)(class {}, node);
let parentNotifications = 0, creations = 0, releases = 0;
const renders = { body: 0, sweep: 0, pulse: 0, time: 0 };
const cachedMounts = [];
const cx = {
  new(Part, props) {
    creations++;
    const view = new Part(); view.init(props);
    return { view, cached() { cachedMounts.push(props.key); return { cached: true, view }; }, release() { releases++; } };
  },
  notify(target) { if (target) target.view.render(); else parentNotifications++; },
};
const parts = new RetainedParts(), other = new RetainedParts();
let label = 'initial', elapsed = 0;
const style = element => ({ wrapper: element, width: '100%', height: 28,
  child(child) { this.wrapper.child(child); return this; } });
const frame = signature => {
  parts.begin(signature);
  return node()
    .child(parts.element('body', 'body', () => { renders.body++; return label; }, style))
    .child(parts.element('sweep', 'sweep', entry => { renders.sweep++; return entry.phase; }, style, 'sweep:320:blue'))
    .child(parts.element('pulse', 'pulse', () => { renders.pulse++; return 'dot'; }, style, 'pulse:working:blue'))
    .child(parts.element('time', 'time', () => { renders.time++; return elapsed; }));
};
const initial = frame('initial');
assert.equal(initial.children[0].wrapper.children[0], 'initial', 'new rows render immediately');
assert.equal(creations, 0, 'render must never create views');
parts.sync(cx);
assert.equal(creations, 4);
assert.equal(parentNotifications, 1, 'new retained parts require one mount');
const stable = frame('initial');
assert.equal(stable.children[0].wrapper.cached, true, 'static body has a real cached boundary');
assert.equal(stable.children[1].wrapper.cached, true, 'motion is a cached sibling of the body');
assert.equal(stable.children[2].wrapper.cached, true, 'pulse is outside the static body');
assert.equal(stable.children[3], parts.entries.get('time').handle, 'time mounts the intrinsic retained entity directly');
assert.deepEqual(cachedMounts, ['body', 'sweep', 'pulse'], 'only fixed-size siblings invoke cached mounting');
const sweepHandle = parts.entries.get('sweep').handle;
parts.mounted('sweep', parts.entries.get('sweep').mountToken, cx);
parts.setSweepPhase(1, cx);
const hoverFrame = frame('hovered');
assert.equal(hoverFrame.children[1].wrapper.view, sweepHandle.view, 'mid-travel hover keeps the same mounted sweep');
assert.equal(hoverFrame.children[2].wrapper.cached, true, 'hover keeps the working pulse mounted');
assert.equal(parts.entries.get('sweep').phase, 1, 'hover must not reset motion phase');
parts.setSweepPhase(2, cx);
assert.equal(parts.entries.get('sweep').phase, 2, 'the mounted sweep receives reversal after hover');
assert.equal(frame('hovered').children[1].wrapper.view, sweepHandle.view);
parts.sync(cx);
assert.equal(parentNotifications, 2, 'changed body content mounts once without replacing motion');
const bodyRenders = renders.body;
for (let i = 0; i < 8; i++) { elapsed++; parts.setSweepPhase(i % 4, cx); parts.notify('time', cx); }
assert.equal(renders.body, bodyRenders, 'timer notifications must not execute the static body');
assert.equal(parentNotifications, 2, 'animation must not notify the sidebar');
label = 'renamed / done / different role';
const changed = frame('changed');
assert.equal(changed.children[0].wrapper.children[0], label, 'changed data is visible before task synchronization');
parts.sync(cx);
assert.equal(frame('changed').children[0].wrapper.cached, true);
assert.equal(parentNotifications, 3);
other.begin('changed');
other.element('body', 'body', () => 'floating instance', style);
other.sync(cx);
assert.notEqual(parts.entries.get('body').handle, other.entries.get('body').handle, 'fixed and floating instances must own separate entities');
parts.begin('closed');
parts.sync(cx);
assert.equal(parts.entries.size, 0);
assert.equal(releases, 4, 'closed rows release every retained part');
assert.equal(other.entries.size, 1);

// A row appearing immediately before reversal starts in its existing phase,
// then receives the pending phase only after its retained subtree first lays out.
const fresh = new RetainedParts();
fresh.begin('empty');
fresh.setSweepPhase(1, cx);
fresh.begin('new working row');
const freshBuild = (entry, mountToken) => ({ phase: entry.phase,
  onSize: mountToken ? () => fresh.mounted('fresh-sweep', mountToken, cx) : undefined });
const inlineSweep = fresh.element('fresh-sweep', 'sweep', freshBuild, style, 'fresh:320:blue').wrapper.children[0];
assert.equal(inlineSweep.phase, 1);
assert.equal(inlineSweep.onSize, undefined, 'inline rendering must not install the retained-mount handshake');
fresh.mounted('fresh-sweep', undefined, cx);
assert.equal(fresh.entries.get('fresh-sweep').mounted, undefined, 'inline layout cannot acknowledge an uncreated entity');
fresh.setSweepPhase(2, cx);
const freshEntry = fresh.entries.get('fresh-sweep'), freshHandle = freshEntry.handle;
assert.equal(freshEntry.phase, 1, 'creation must materialize the pre-reversal position');
assert.equal(freshEntry.pendingPhase, 2);
fresh.mounted('fresh-sweep', undefined, cx);
fresh.mounted('fresh-sweep', {}, cx);
assert.equal(freshEntry.mounted, undefined, 'late inline and stale-generation callbacks must not acknowledge the new handle');
assert.equal(freshEntry.phase, 1, 'late inline acknowledgement cannot advance the pre-reversal position');
assert.equal(freshEntry.handle.view.render().phase, 1);
assert.equal(fresh.element('fresh-sweep', 'sweep', freshBuild, style, 'fresh:320:blue').wrapper.view, freshHandle.view);
freshEntry.handle.view.render().onSize();
assert.equal(freshEntry.handle.view.render().phase, 2, 'first layout delivers the queued reversal');
fresh.setSweepPhase(3, cx);
assert.equal(freshEntry.phase, 3, 'later phases go directly to the same mounted entity');
assert.equal(fresh.element('fresh-sweep', 'sweep', freshBuild, style, 'fresh:400:teal').wrapper.view, freshHandle.view, 'width/color changes keep the existing sweep entity mounted');
fresh.sync(cx);
assert.equal(freshEntry.ready, 'fresh:400:teal', 'metadata changes synchronize through the task');
assert.equal(freshEntry.phase, 3);

const timingSource = fs.readFileSync(path.join(__dirname, 'session-time.js'), 'utf8').replace(/^export /gm, '');
const { projectActive, staleSession } = new Function(`${timingSource}\nreturn { projectActive, staleSession };`)();
const clockParts = new RetainedParts(), timestamp = 10 * 86400000;
let now = timestamp + 86400000 - 30000;
const idlePane = { pane: 'idle', tab: 'idle-tab', terminal: 'idle-terminal' };
const idleSpace = { tabs: [{ id: 'idle-tab' }] };
const clockFrame = () => {
  clockParts.begin(`minute:${Math.floor(now / 60000)}`);
  return node()
    .child(clockParts.element('idle-body', 'body', () => ({
      emphasized: projectActive(idleSpace, [idlePane], new Map([['idle', 'idle']]), new Map([['idle-terminal', { status_ms: timestamp }]]), () => null, now),
      stale: staleSession(timestamp, now),
    }), style))
    .child(clockParts.element('working-sweep', 'sweep', entry => entry.phase, style, 'working:320:blue'));
};
assert.equal(clockFrame().children[0].wrapper.children[0].emphasized, true);
clockParts.sync(cx);
clockParts.mounted('working-sweep', clockParts.entries.get('working-sweep').mountToken, cx);
const clockSweepHandle = clockParts.entries.get('working-sweep').handle;
clockParts.setSweepPhase(1, cx);
now += 60000;
const dayBoundary = clockFrame();
assert.equal(dayBoundary.children[0].wrapper.children[0].emphasized, false, 'an unrelated working row must not freeze the idle project at the 24h boundary');
assert.equal(dayBoundary.children[1].wrapper.view, clockSweepHandle.view, 'minute refresh keeps the travelling sweep mounted');
now += 86400000;
assert.equal(clockFrame().children[0].wrapper.children[0].stale, true, 'idle content refreshes when it crosses the 48h stale boundary');
assert.equal(clockParts.entries.get('working-sweep').phase, 1, 'clock refresh must not reset motion');
console.log('Retained parts passed: real sibling cache mounts, intrinsic time, immediate data updates, stable synchronization, targeted notifications, instance isolation and release.');
