'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const home = process.env.HERDR_APP_HOME || path.join(os.homedir(), '.config', 'herdr-app');
const directory = path.join(home, 'agent-office-publications');
const idPattern = /^agent-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const terminal = process.env.HC_TERMINAL_ID || '';

function value(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || value.includes('\0')) throw new Error(`Invalid ${label}`);
  return value;
}

function argumentsFor(args, allowed) {
  const options = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(options, key) || i + 1 >= args.length || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${key}`);
    options[key] = args[i + 1];
  }
  return options;
}

function resolveRoom() {
  value(terminal, 'HC_TERMINAL_ID', 1024);
  let groups;
  try {
    groups = JSON.parse(fs.readFileSync(path.join(home, 'shared.json'), 'utf8'))['workspace.office-groups'];
  } catch (error) {
    throw new Error(`Cannot read office groups: ${error.message}`);
  }
  if (!Array.isArray(groups)) throw new Error('Office groups are unavailable');
  const visited = new Set();
  let current = terminal;
  while (current) {
    if (visited.has(current)) throw new Error('Terminal parent chain contains a cycle');
    visited.add(current);
    const rooms = new Set(groups.filter(group => group && !group.machine && typeof group.projectKey === 'string' && group.projectKey && Array.isArray(group.members) && group.members.some(member => member?.terminal === current)).map(group => group.projectKey));
    if (rooms.size > 1) throw new Error(`Terminal ${current} belongs to multiple rooms`);
    if (rooms.size === 1) return [...rooms][0];
    const result = spawnSync('hc', ['get', current, '--json'], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Cannot resolve terminal ${current}: ${result.error?.message || result.stderr?.trim() || 'hc get failed'}`);
    let data;
    try { data = JSON.parse(result.stdout); } catch { throw new Error(`Invalid hc get response for ${current}`); }
    current = data?.parent;
    if (current != null && (typeof current !== 'string' || !current)) throw new Error('Invalid terminal parent');
  }
  throw new Error(`No office room found for terminal ${terminal}`);
}

function terminalInfo(address) {
  value(address, 'terminal address', 1024);
  if (address.includes('/')) throw new Error('File publications support local terminals only');
  const result = spawnSync('hc', ['get', address, '--json'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Cannot verify terminal ${address}: ${result.error?.message || result.stderr?.trim() || 'hc get failed'}`);
  const info = JSON.parse(result.stdout);
  if (info?.state !== 'live' || !Number.isSafeInteger(info.created_ms) || info.created_ms < 0 || (info.address && info.address !== address)) throw new Error(`Invalid terminal identity: ${address}`);
  return info;
}

function fileContext(roomOverride) {
  if (!terminal && roomOverride) return { roomKey: roomOverride, origin: 'local' };
  const authorInfo = terminalInfo(terminal);
  const author = { terminal, createdMs: authorInfo.created_ms };
  let groups;
  try { groups = JSON.parse(fs.readFileSync(path.join(home, 'shared.json'), 'utf8'))['workspace.office-groups']; }
  catch (error) { if (!roomOverride) throw error; }
  if (!Array.isArray(groups)) {
    if (!roomOverride) throw new Error('Office groups are unavailable');
    return { roomKey: roomOverride, author, origin: 'local' };
  }
  const visited = new Set();
  let address = terminal, info = authorInfo;
  while (address) {
    if (visited.has(address)) throw new Error('Terminal parent chain contains a cycle');
    visited.add(address);
    const matches = groups.filter(group => group && !group.machine && group.projectKey && group.members?.some(member => member?.terminal === address));
    if (new Set(matches.map(group => group.projectKey)).size > 1) throw new Error(`Terminal ${address} belongs to multiple rooms`);
    const group = matches[0];
    if (group && (!roomOverride || group.projectKey === roomOverride)) {
      const workstation = matches.length === 1 && typeof group.id === 'string'
        ? { terminal: address, createdMs: info.created_ms, space: group.id } : undefined;
      return { roomKey: roomOverride || group.projectKey, author, origin: 'local', ...(workstation ? { workstation } : {}) };
    }
    address = info.parent;
    if (address != null && (typeof address !== 'string' || !address)) throw new Error('Invalid terminal parent');
    if (address) info = terminalInfo(address);
  }
  if (roomOverride) return { roomKey: roomOverride, author, origin: 'local' };
  throw new Error(`No office room found for terminal ${terminal}`);
}

function validIdentity(identity) {
  return identity && typeof identity.terminal === 'string' && !!identity.terminal && !identity.terminal.includes('/')
    && Number.isSafeInteger(identity.createdMs) && identity.createdMs >= 0;
}

function validRecord(record, id) {
  return record && typeof record === 'object' && !Array.isArray(record) && record.version === 1 && record.id === id && idPattern.test(id)
    && typeof record.roomKey === 'string' && !!record.roomKey.trim() && record.roomKey.length <= 1024
    && typeof record.name === 'string' && !!record.name.trim() && record.name.length <= 256
    && record.url === '' && typeof record.source === 'string' && record.source.startsWith('Agent · ') && record.published === true
    && (record.origin === undefined || record.origin === 'local')
    && (record.author === undefined || validIdentity(record.author))
    && (record.workstation === undefined || validIdentity(record.workstation) && typeof record.workstation.space === 'string')
    && ((record.kind === 'note' && typeof record.text === 'string' && !!record.text.trim() && record.text.length <= 65536 && !Object.hasOwn(record, 'path'))
      || (record.kind === 'file' && typeof record.path === 'string' && path.isAbsolute(record.path) && !Object.hasOwn(record, 'text')));
}

function readRecord(id) {
  let record;
  try { record = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), 'utf8')); }
  catch (error) { throw new Error(`Cannot read publication ${id}: ${error.message}`); }
  if (!validRecord(record, id)) throw new Error(`Invalid publication record: ${id}`);
  return record;
}

function pin(args) {
  const options = argumentsFor(args, ['--title', '--text', '--file', '--room']);
  const name = value(options['--title'], 'title', 256);
  if (Object.hasOwn(options, '--text') === Object.hasOwn(options, '--file')) throw new Error('Provide exactly one of --text or --file');
  const roomOverride = options['--room'] === undefined ? undefined : value(options['--room'], 'room', 1024);
  let content, context;
  if (Object.hasOwn(options, '--text')) content = { kind: 'note', text: value(options['--text'], 'text', 65536) };
  else {
    const input = value(options['--file'], 'file', 4096);
    if (/^(?:[a-z][a-z\d+.-]*:\/\/|[^/\\]+@[^:]+:|\\\\|\/\/)/i.test(input)) throw new Error('Publication file must be local');
    const file = fs.realpathSync(path.resolve(input));
    if (!fs.statSync(file).isFile()) throw new Error('Publication file must be a regular file');
    content = { kind: 'file', path: file };
    context = fileContext(roomOverride);
  }
  context ??= { roomKey: roomOverride ?? resolveRoom() };
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = `agent-${randomUUID()}`;
  const record = { version: 1, id, ...context, kind: content.kind, name, url: '', ...content, source: `Agent · ${terminal || 'unknown'}`, published: true };
  const temporary = path.join(directory, `.${id}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    // Linking publishes atomically without replacing an existing record.
    fs.linkSync(temporary, path.join(directory, `${id}.json`));
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function list(args) {
  argumentsFor(args, []);
  let entries;
  try { entries = fs.readdirSync(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const rooms = Object.create(null);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const id = entry.slice(0, -5);
    if (!idPattern.test(id)) throw new Error(`Invalid publication filename: ${entry}`);
    const record = readRecord(id);
    (rooms[record.roomKey] ||= []).push(record);
  }
  process.stdout.write(`${JSON.stringify({ rooms })}\n`);
}

function remove(args) {
  const options = argumentsFor(args, ['--room', '--id']);
  const room = value(options['--room'], 'room', 1024);
  const id = value(options['--id'], 'id', 64);
  if (!idPattern.test(id)) throw new Error('Invalid publication ID');
  if (readRecord(id).roomKey !== room) throw new Error('Publication does not belong to that room');
  fs.unlinkSync(path.join(directory, `${id}.json`));
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pin') pin(args);
  else if (command === 'list') list(args);
  else if (command === 'remove') remove(args);
  else throw new Error('Usage: agent-publish.cjs pin|list|remove');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
